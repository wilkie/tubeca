import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Writable } from 'stream';
import { spawn, type ChildProcess } from 'child_process';
import { loadAppConfig, getHlsCacheConfig } from '../config/appConfig';
import { MediaService } from './mediaService';
import {
  detectBestEncoderAsync,
  getDecoderInputArgs,
  getEncoderArgs,
  getEncoderInputArgs,
  resolvePreferredEncoder,
  SOFTWARE_ENCODER,
  type HardwareEncoder,
} from '../utils/hwaccel';
import { getTranscodingSettings, getTranscodingSettingsVersion } from './transcodingSettingsService';
import { prisma } from '../config/database';
import {
  collectCacheStats,
  enforceCacheSize,
  evictMediaCache,
  isAudioCopyable,
  isVideoCopyable,
  sweepExpiredSegments,
} from './hlsCache';
import type { TranscodingSettings } from '@prisma/client';
import { codecStringsFromInit, Fmp4Splitter } from './fmp4';
import { hasPreparedAudio, prepareAudio, preparedAudioPath } from './preparedAudio';
import {
  ensureKeyframes,
  gridLayout,
  isGridLayoutId,
  keyframeLayout,
  longestSegment,
  segmentCount,
  segmentLength,
  segmentStart,
  storedKeyframes,
  type SegmentLayout,
} from './keyframes';

// Quality presets for transcoding (default values, overridden by settings)
export interface QualityPreset {
  name: string;
  width: number;
  height: number;
  videoBitrate: number;  // kbps
  audioBitrate: number;  // kbps
  label: string;         // Human-readable label
}

// Default quality presets (bitrates will be overridden by settings)
export const DEFAULT_QUALITY_PRESETS: Record<string, QualityPreset> = {
  '1080p': { name: '1080p', width: 1920, height: 1080, videoBitrate: 8000, audioBitrate: 192, label: '1080p' },
  '720p': { name: '720p', width: 1280, height: 720, videoBitrate: 5000, audioBitrate: 128, label: '720p' },
  '480p': { name: '480p', width: 854, height: 480, videoBitrate: 2500, audioBitrate: 128, label: '480p' },
  '360p': { name: '360p', width: 640, height: 360, videoBitrate: 1000, audioBitrate: 96, label: '360p' },
};

// For backwards compatibility
export const QUALITY_PRESETS = DEFAULT_QUALITY_PRESETS;

// Original quality uses stream copy (no transcoding)
export const ORIGINAL_QUALITY = 'original';

/**
 * The `original` rung is fragmented MP4 (CMAF) rather than MPEG-TS. MPEG-TS
 * cannot carry HEVC or AV1 to a browser, and even for H.264 it means repacking
 * every byte into 188-byte packets for no gain; fMP4 carries the source's own
 * samples, which is what "copy the picture" was supposed to mean. The
 * transcode rungs stay on MPEG-TS: they produce H.264 either way.
 */
export function isFmp4Quality(quality: string): boolean {
  return quality === ORIGINAL_QUALITY;
}

/** Cache and URL name of a segment, which differs by container. */
export function segmentFileName(quality: string, index: number): string {
  return isFmp4Quality(quality) ? `${index}.m4s` : `${index}.ts`;
}

/** The `#EXT-X-MAP` initialisation segment shared by every segment of a variant. */
export const INIT_SEGMENT_NAME = 'init.mp4';

/**
 * Codecs no browser is required to decode, so a rung carrying one must say so
 * or a player has no way to skip it.
 */
const NEEDS_DECLARED_CODECS = new Set(['hevc', 'av1']);

/**
 * How long a master playlist will wait for the header it reads codecs from.
 * The header costs one FFmpeg run, which normally takes a moment but queues
 * behind transcodes on a busy machine, and nobody should wait on the queue
 * just to be told what a file contains.
 */
const CODEC_PROBE_TIMEOUT_MS = 5000;

/**
 * How far before a copied segment the input seek aims, leaving the rest to an
 * output seek that is exact.
 *
 * Only the accuracy of the sum matters, so this could be almost anything; it
 * is the demuxing between the two that costs, and ten seconds of it is under a
 * tenth of a second on the files measured here.
 */
const COPY_SEEK_PRE_ROLL = 10;

/**
 * How far past its slot a segment whose audio is *copied* is allowed to run.
 *
 * A copy cannot split a frame, so `-t` rounds down and the segment stops a few
 * milliseconds short — 9ms measured on a real slot, which is a gap of silence
 * between it and the next segment. Rounding up instead makes consecutive
 * segments overlap, and an overlap of the same encoded frames is nothing: MSE
 * overwrites it with itself. One AAC frame is 21.3ms and one MPEG-1 layer III
 * frame at 44.1kHz is 26.1ms, so this covers either with room to spare while
 * staying under a single video frame at 24fps.
 */
const AUDIO_COPY_PAD = 0.03;

/** The audio bitrate of the copy rung, which has no preset of its own. */
const ORIGINAL_AUDIO_BITRATE = 192;

export interface SegmentInfo {
  path: string;
  index: number;
  duration: number;
  exists: boolean;
}

export interface PlaylistInfo {
  path: string;
  exists: boolean;
  segmentCount: number;
  totalDuration: number;
}

/**
 * Why a segment is being encoded. A player waiting on a segment beats a
 * prefetch for a segment nobody has asked for yet, both for a transcode slot
 * and when deciding what to abandon after a seek.
 */
export type SegmentPriority = 'live' | 'prefetch'

/**
 * How a segment request was answered.
 *
 * `file` is the cached case, and the caller serves it with a Content-Length.
 * `streamed` means the bytes were written to the sink as FFmpeg produced
 * them, so there is nothing left to send. `missing` means it could not be
 * produced at all.
 */
export type SegmentDelivery =
  | { kind: 'file'; path: string }
  | { kind: 'streamed' }
  | { kind: 'missing' }

/** Thrown when a prefetch is abandoned because the player moved elsewhere. */
export class SegmentCancelledError extends Error {
  readonly cancelled = true;
  constructor(index: number) {
    super(`Segment ${index} encode cancelled`);
    this.name = 'SegmentCancelledError';
  }
}

/** True for the error a cancelled prefetch rejects with. */
function isCancellation(error: unknown): boolean {
  return error instanceof SegmentCancelledError;
}

/** One in-flight segment encode, shared by every caller that wants it. */
interface SegmentJob {
  promise: Promise<void>
  variantPath: string
  index: number
  /** Starts as the requester's priority; upgraded to live if a player joins. */
  priority: SegmentPriority
  cancelled: boolean
  /** Set once FFmpeg is running, so a cancel can kill it. */
  child: ChildProcess | null
  /**
   * Which viewer asked for this, when they said.
   *
   * Two people watching one file are two viewers of the same variant, and one
   * seeking must not throw away the other's prefetches. A request without a
   * session belongs to nobody, and is only ever cancelled by another such
   * request — the behaviour before sessions existed.
   */
  session?: string
}

export class HlsService {
  private mediaService: MediaService;
  private cachePath: string;
  private defaultSegmentDuration: number;
  // Track in-progress segment generations to prevent concurrent generation of same segment
  /** Whether a file's audio can be copied, by path and track; see `canCopyAudio`. */
  /** `CODECS` for the original rung, keyed by `<mediaId>:<audioTrack>`. */
  private codecStringCache = new Map<string, string | null>();

  private audioCopyCache = new Map<
    string,
    { copyable: boolean; codec?: string | null; expires: number }
  >();

  /** Where each file's segments are cut, by media id; see `keyframes.ts`. */
  private layoutCache = new Map<string, { layout: SegmentLayout; target: number; expires: number }>();

  /** In-flight segment encodes keyed by `<variantPath>:<index>`, shared by player requests and prefetch. */
  private generatingSegments: Map<string, SegmentJob> = new Map();
  /** FFmpeg children still running, so they can be killed on shutdown. */
  private activeProcesses: Set<ChildProcess> = new Set();
  private readonly segmentTimeoutMs: number;
  // Detected video encoder (detected once at startup)
  /** Resolved on first use, or earlier by `warmEncoderDetection()` after boot. */
  private detectedEncoder: HardwareEncoder | null = null;
  // Settings cache
  private settingsCache: TranscodingSettings | null = null;
  private settingsCacheTime: number = 0;
  private settingsVersionSeen: number = -1;
  private readonly SETTINGS_CACHE_TTL = 30000; // 30 seconds
  // Concurrency control for FFmpeg processes
  private activeTranscodes: number = 0;
  private waitingQueue: Array<{ job: SegmentJob; start: () => void }> = [];

  constructor(options: { segmentTimeoutMs?: number } = {}) {
    this.segmentTimeoutMs = options.segmentTimeoutMs ?? 120000;
    this.mediaService = new MediaService();
    const appConfig = loadAppConfig();
    const hlsConfig = getHlsCacheConfig(appConfig);
    this.cachePath = hlsConfig.path;
    this.defaultSegmentDuration = hlsConfig.segmentDuration;
  }

  /**
   * Resolve which encoder to use, detecting on first call.
   *
   * Detection spawns FFmpeg several times, so it is neither done in the
   * constructor (which runs at import time) nor synchronously; the server
   * warms it after it starts listening and the first segment request would
   * otherwise pay for it.
   */
  private async getDetectedEncoder(): Promise<HardwareEncoder> {
    if (!this.detectedEncoder) {
      this.detectedEncoder = await detectBestEncoderAsync();
    }
    return this.detectedEncoder;
  }

  /**
   * Acquire a slot for transcoding, waiting if necessary.
   * Returns a release function to call when done.
   */
  private async acquireTranscodeSlot(job: SegmentJob): Promise<() => void> {
    const settings = await this.getSettings();
    const maxConcurrent = settings.maxConcurrentTranscodes || 2;

    // If we have capacity, acquire immediately
    if (this.activeTranscodes < maxConcurrent) {
      this.activeTranscodes++;
      return () => this.releaseTranscodeSlot();
    }

    // Otherwise, wait in queue
    return new Promise((resolve) => {
      this.waitingQueue.push({
        job,
        start: () => {
          this.activeTranscodes++;
          resolve(() => this.releaseTranscodeSlot());
        },
      });
    });
  }

  /**
   * Release a transcoding slot and wake the next waiter.
   *
   * A player that is waiting on a segment goes ahead of any prefetch, so a
   * seek does not sit behind two speculative encodes for the old position.
   * Priority is read at wake-up time, so a prefetch that a player has since
   * joined is promoted while it waits.
   */
  private releaseTranscodeSlot(): void {
    this.activeTranscodes--;
    if (this.waitingQueue.length === 0) return;

    let index = this.waitingQueue.findIndex((w) => w.job.priority === 'live');
    if (index === -1) index = 0;
    const [next] = this.waitingQueue.splice(index, 1);
    next.start();
  }

  /**
   * Get transcoding settings (with caching)
   */
  private async getSettings(): Promise<TranscodingSettings> {
    const version = getTranscodingSettingsVersion();
    if (
      this.settingsCache &&
      this.settingsVersionSeen === version &&
      Date.now() - this.settingsCacheTime < this.SETTINGS_CACHE_TTL
    ) {
      return this.settingsCache;
    }
    this.settingsCache = await getTranscodingSettings();
    this.settingsCacheTime = Date.now();
    this.settingsVersionSeen = version;
    return this.settingsCache;
  }

  /**
   * Get the active encoder based on settings
   */
  private async getActiveEncoder(): Promise<HardwareEncoder> {
    const settings = await this.getSettings();
    const detected = await this.getDetectedEncoder();

    // If hardware accel is disabled and detected encoder is hardware, fall back to software
    if (!settings.enableHardwareAccel && detected.type === 'hardware') {
      return SOFTWARE_ENCODER;
    }

    // An admin's explicit choice wins over detection, but only once it has
    // been confirmed to work on this machine.
    if (settings.preferredEncoder && settings.preferredEncoder !== detected.encoder) {
      const preferred = await resolvePreferredEncoder(settings.preferredEncoder);
      if (preferred && (settings.enableHardwareAccel || preferred.type === 'software')) {
        return preferred;
      }
    }

    return detected;
  }

  /**
   * Get quality presets with bitrates from settings
   */
  private async getQualityPresets(): Promise<Record<string, QualityPreset>> {
    const settings = await this.getSettings();

    return {
      '1080p': { ...DEFAULT_QUALITY_PRESETS['1080p'], videoBitrate: settings.bitrate1080p, label: `1080p (${Math.round(settings.bitrate1080p / 1000)} Mbps)` },
      '720p': { ...DEFAULT_QUALITY_PRESETS['720p'], videoBitrate: settings.bitrate720p, label: `720p (${Math.round(settings.bitrate720p / 1000)} Mbps)` },
      '480p': { ...DEFAULT_QUALITY_PRESETS['480p'], videoBitrate: settings.bitrate480p, label: `480p (${settings.bitrate480p / 1000} Mbps)` },
      '360p': { ...DEFAULT_QUALITY_PRESETS['360p'], videoBitrate: settings.bitrate360p, label: `360p (${settings.bitrate360p / 1000} Mbps)` },
    };
  }

  /**
   * Get segment duration from settings
   */
  private async getSegmentDuration(): Promise<number> {
    const settings = await this.getSettings();
    return settings.segmentDuration || this.defaultSegmentDuration;
  }

  /**
   * Where this file's segments are cut, as of now.
   *
   * A file whose keyframes have not been read yet is cut on the even grid,
   * which is what every file did before keyframes were read at all. Held
   * briefly so that four rungs of one master playlist ask the database once.
   */
  private async currentLayout(mediaId: string, duration: number): Promise<SegmentLayout> {
    const target = await this.getSegmentDuration();
    const cached = this.layoutCache.get(mediaId);
    if (cached && cached.target === target && cached.expires > Date.now()) return cached.layout;

    const stored = await storedKeyframes(mediaId);
    const layout =
      stored && stored.times.length > 0
        ? keyframeLayout(stored.times, duration, target)
        : gridLayout(duration, target);

    // Short, because a probe finishing should reach the next viewer to press
    // play rather than the next viewer to restart the server.
    this.layoutCache.set(mediaId, { layout, target, expires: Date.now() + 30_000 });
    return layout;
  }

  /**
   * The layout a segment request belongs to.
   *
   * Players carry the layout their playlist was built from, because a probe
   * that finishes mid-stream changes where the cuts are and a player asking
   * for segment 40 of the old layout must not be handed segment 40 of the new
   * one. An even grid is entirely described by its name, so that case is
   * answered without touching the database at all.
   *
   * A probed layout that is no longer the file's — which means the file itself
   * changed, since the cuts name the layout — falls through to the current
   * one. Everything cached for the old file is wrong by then anyway.
   */
  private async layoutFor(
    mediaId: string,
    duration: number,
    requestedId?: string
  ): Promise<SegmentLayout> {
    if (requestedId && isGridLayoutId(requestedId)) {
      const target = Number(requestedId.slice(1));
      if (Number.isFinite(target) && target > 0) return gridLayout(duration, target);
    }
    return this.currentLayout(mediaId, duration);
  }

  /**
   * Read this file's keyframes, unless they are already known, so that the
   * next playlist for it is cut where they are.
   *
   * Deliberately not awaited. Probing means reading the whole file, which for
   * a large episode on a network share takes half a minute; nobody waits that
   * long to start watching, and the even grid plays perfectly well meanwhile.
   */
  private async learnKeyframes(mediaId: string, videoPath: string): Promise<void> {
    if (await storedKeyframes(mediaId)) return;
    void ensureKeyframes(mediaId, videoPath).catch((error) => {
      console.warn(`Could not read the keyframes of ${videoPath}:`, error);
    });
  }

  /**
   * Encode this file's audio once, so the segments after this play can copy it
   * instead of each running the AAC encoder over their own few seconds and
   * each beginning with its priming delay (`preparedAudio.ts`).
   *
   * Only for `original`, and only when the source audio cannot simply be
   * copied. The transcode rungs each want a different bitrate, so one prepared
   * track cannot serve them without quietly raising 360p's audio from 96k to
   * 192k — which is the last thing a viewer on a thin connection needs.
   *
   * Deliberately not awaited: this costs minutes, and the viewer who triggered
   * it is watching now.
   */
  private async prepareRungAudio(
    mediaId: string,
    videoPath: string,
    quality: string,
    audioTrack: string
  ): Promise<void> {
    const presets = await this.getQualityPresets();
    const bitrate = presets[quality]?.audioBitrate ?? ORIGINAL_AUDIO_BITRATE;

    const audioTrackDir = this.getAudioTrackPath(mediaId, audioTrack);
    if (hasPreparedAudio(audioTrackDir, bitrate)) return;
    // The copy rung with sound a browser already takes never re-encodes, so it
    // has nothing to gain. Every other rung does.
    if (quality === ORIGINAL_QUALITY && (await this.canCopyAudio(videoPath, audioTrack))) return;

    void prepareAudio({ videoPath, audioTrack, audioTrackDir, bitrate }).catch((error) => {
      console.warn(`Could not prepare the audio of ${videoPath}:`, error);
    });
  }

  /**
   * Whether `original` can be offered: the video can be copied.
   *
   * The audio is a separate question. If it cannot be copied it is re-encoded
   * to AAC while the picture is still copied, which costs a thirtieth of the
   * CPU of re-encoding both and is what nearly half of a real library needs.
   */
  async canDirectPlay(mediaId: string, filePath: string): Promise<boolean> {
    return isVideoCopyable(await this.streamsOf(mediaId), filePath);
  }

  private async streamsOf(mediaId: string) {
    return prisma.mediaStream.findMany({
      where: { mediaId },
      select: { streamType: true, codec: true, streamIndex: true },
      orderBy: { streamIndex: 'asc' },
    });
  }

  /** The video codec of the file FFmpeg is about to read, memoised like the audio answer. */
  private async videoCodecOf(videoPath: string): Promise<string | null> {
    const key = `video:${videoPath}`;
    const cached = this.audioCopyCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.codec ?? null;

    const media = await prisma.media.findUnique({
      where: { path: videoPath },
      select: { id: true },
    });
    const streams = media ? await this.streamsOf(media.id) : [];
    const codec = streams.find((stream) => stream.streamType === 'Video')?.codec ?? null;

    this.audioCopyCache.set(key, { copyable: false, codec, expires: Date.now() + 30_000 });
    return codec;
  }

  /**
   * Whether the audio of this file can be copied, by the path FFmpeg reads.
   *
   * Answered from `Media.path`, which is unique, because the segment builder
   * knows the file rather than the media id. Memoised briefly: it is asked once
   * per segment and the answer only changes when a file is re-probed.
   */
  private async canCopyAudio(videoPath: string, audioTrack: string): Promise<boolean> {
    const key = `${videoPath}:${audioTrack}`;
    const cached = this.audioCopyCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.copyable;

    const media = await prisma.media.findUnique({
      where: { path: videoPath },
      select: { id: true },
    });
    const streams = media ? await this.streamsOf(media.id) : [];
    const index = audioTrack === 'default' ? undefined : Number(audioTrack);
    const copyable = isAudioCopyable(streams, Number.isFinite(index) ? index : undefined);

    this.audioCopyCache.set(key, { copyable, expires: Date.now() + 30_000 });
    return copyable;
  }

  /**
   * Generate a segment unless it already exists or is already being generated.
   * One key per (variant, index) regardless of whether a player or a prefetch
   * asked for it, so the same segment is never encoded twice concurrently.
   */
  private ensureSegment(
    videoPath: string,
    layout: SegmentLayout,
    quality: string,
    segmentIndex: number,
    audioTrack: string,
    variantPath: string,
    priority: SegmentPriority = 'live',
    /** When given, the encode is written here as it is produced. */
    sink?: Writable,
    session?: string
  ): Promise<void> {
    const segmentPath = path.join(variantPath, segmentFileName(quality, segmentIndex));
    try {
      if (fs.statSync(segmentPath).size > 0) return Promise.resolve();
    } catch {
      // Not cached yet
    }
    const key = `${variantPath}:${segmentIndex}`;
    const existing = this.generatingSegments.get(key);
    if (existing) {
      // A player is now waiting on what began as a prefetch: promote it so it
      // is neither queued behind live work nor abandoned by a later seek.
      if (priority === 'live') existing.priority = 'live';
      return existing.promise;
    }

    const job: SegmentJob = {
      promise: Promise.resolve(),
      variantPath,
      index: segmentIndex,
      priority,
      cancelled: false,
      child: null,
      session,
    };
    job.promise = this.generateSegment(
      videoPath,
      layout,
      quality,
      segmentIndex,
      audioTrack,
      variantPath,
      job,
      sink
    ).finally(() => {
      // Only clear our own entry: a cancelled job may already have been
      // replaced by a fresh request for the same segment.
      if (this.generatingSegments.get(key) === job) {
        this.generatingSegments.delete(key);
      }
    });
    this.generatingSegments.set(key, job);
    return job.promise;
  }

  /**
   * Abandon the prefetches this viewer has moved away from.
   *
   * Called whenever a player asks for a segment: anything still encoding for
   * this viewer outside the window they are about to consume is work nobody
   * will watch, and it is holding a transcode slot the seek needs.
   *
   * Only this viewer's, though. Two people watching the same file share a
   * variant, and until 2026-09-04 either one's seek cancelled the other's
   * prefetches — so two viewers a few minutes apart in the same film spent
   * their time cancelling each other and re-encoding what they had just
   * thrown away. Encodes a player is waiting on are never cancelled.
   */
  private cancelStalePrefetches(
    variantPath: string,
    liveIndex: number,
    prefetchCount: number,
    session?: string
  ): void {
    for (const [key, job] of this.generatingSegments) {
      if (job.variantPath !== variantPath) continue;
      if (job.priority !== 'prefetch') continue;
      // Someone else's work, or work from before sessions were carried.
      if (job.session !== session) continue;
      if (job.index >= liveIndex && job.index <= liveIndex + prefetchCount) continue;

      job.cancelled = true;
      job.child?.kill('SIGKILL');
      this.generatingSegments.delete(key);
    }
  }

  /** Kill every running FFmpeg child. Called on server shutdown. */
  shutdown(): void {
    for (const child of this.activeProcesses) {
      child.kill('SIGKILL');
    }
    this.activeProcesses.clear();
  }

  /** Number of FFmpeg children currently running (for tests and diagnostics). */
  get runningProcessCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Get the cache directory path for a specific media/quality/audioTrack combination
   */
  /**
   * Where a media item's audio tracks and their variants live. The prepared
   * audio track sits here rather than inside a variant, because it does not
   * depend on the quality or on where the segments are cut.
   */
  getAudioTrackPath(mediaId: string, audioTrack: string): string {
    return path.join(this.cachePath, mediaId, `a${audioTrack}`);
  }

  getVariantCachePath(
    mediaId: string,
    quality: string,
    audioTrack: string,
    /**
     * Which cut of the file these segments are. Two layouts of one rung are
     * different sets of bytes covering different spans, so they cannot share a
     * directory; naming the directory after the layout also means the segments
     * of a layout nobody uses any more simply age out of the cache.
     */
    layoutId: string
  ): string {
    return path.join(this.getAudioTrackPath(mediaId, audioTrack), `${quality}-${layoutId}`);
  }

  /**
   * Generate master playlist listing all available qualities
   */
  async generateMasterPlaylist(
    mediaId: string,
    audioTrack?: number,
    token?: string,
    session?: string
  ): Promise<string> {
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) {
      throw new Error('Media not found');
    }

    const presets = await this.getQualityPresets();
    const audioTrackStr = audioTrack !== undefined ? audioTrack.toString() : 'default';
    // A player that cannot set headers — Safari's native HLS, an AirPlay
    // receiver, anything embedding the URL — follows these URIs with nothing
    // but what they carry. Whatever authenticated this request goes with them,
    // and so does the viewer session, so that segment requests say who is
    // asking and one viewer's seek does not cancel another's prefetches.
    const auth =
      (token ? `&token=${encodeURIComponent(token)}` : '') +
      (session ? `&session=${encodeURIComponent(session)}` : '');
    const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];

    // Add original quality (stream copy) first, when the codecs allow it
    if (await this.canDirectPlay(media.id, media.path)) {
      const videoCodec = (await this.videoCodecOf(media.path)) ?? '';
      // A player that cannot decode HEVC or AV1 — hls.js on Chrome or Firefox,
      // for two — can only avoid this rung if the playlist says what is in it.
      // Without that, offering it means offering a failure, so those files wait
      // for the header the codecs are read from. H.264 does not: every browser
      // decodes it, so the playlist goes out at once and says so next time.
      const needsCodecs = NEEDS_DECLARED_CODECS.has(videoCodec);
      const codecs = await this.originalCodecs(media.id, audioTrackStr, needsCodecs);
      if (codecs || !needsCodecs) {
        const attributes = [
          'BANDWIDTH=20000000',
          'RESOLUTION=native',
          ...(codecs ? [`CODECS="${codecs}"`] : []),
          'NAME="Original"',
        ];
        lines.push(`#EXT-X-STREAM-INF:${attributes.join(',')}`);
        lines.push(`${ORIGINAL_QUALITY}.m3u8?audioTrack=${audioTrackStr}${auth}`);
      }
    }

    // Add transcoded quality options (highest to lowest)
    const qualities = ['1080p', '720p', '480p', '360p'];
    for (const quality of qualities) {
      const preset = presets[quality];
      const bandwidth = (preset.videoBitrate + preset.audioBitrate) * 1000; // Convert to bps
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${preset.width}x${preset.height},NAME="${preset.label}"`);
      lines.push(`${quality}.m3u8?audioTrack=${audioTrackStr}${auth}`);
    }

    return lines.join('\n');
  }

  /**
   * The `CODECS` attribute for the original rung, or null when it cannot be
   * had in time. Read from the initialisation segment's sample entries rather
   * than derived from a codec name, since only the sample entry says which
   * profile and level a player is being asked for.
   *
   * Producing the header means one FFmpeg run, so the answer is remembered and
   * the wait is bounded: a machine whose transcode slots are all busy answers
   * without the rung rather than making the viewer wait for it.
   */
  private async originalCodecs(
    mediaId: string,
    audioTrack: string,
    wait: boolean
  ): Promise<string | null> {
    const key = `${mediaId}:${audioTrack}`;
    const cached = this.codecStringCache.get(key);
    if (cached !== undefined) return cached;

    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) return null;
    const layout = await this.currentLayout(mediaId, media.duration || 0);
    const variantPath = this.getVariantCachePath(mediaId, ORIGINAL_QUALITY, audioTrack, layout.id);
    const cachedInit = path.join(variantPath, INIT_SEGMENT_NAME);
    const readFrom = (initPath: string): string | null => {
      try {
        const codecs = codecStringsFromInit(fs.readFileSync(initPath));
        const value = codecs.length > 0 ? codecs.join(',') : null;
        this.codecStringCache.set(key, value);
        return value;
      } catch {
        return null;
      }
    };

    try {
      if (fs.statSync(cachedInit).size > 0) return readFrom(cachedInit);
    } catch {
      // Not produced yet
    }

    const pending = this.getInitSegment(mediaId, ORIGINAL_QUALITY, audioTrack, layout.id);
    if (!wait) {
      // Nothing depends on the answer, so let the header be built in the
      // background and say nothing about codecs this time.
      void pending.catch(() => {});
      return null;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const initPath = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CODEC_PROBE_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    // A timeout is not an answer: the encode continues, and the next play of
    // this file will find the header cached.
    return initPath ? readFrom(initPath) : null;
  }

  /**
   * Generate or get variant playlist for a specific quality
   * Also triggers initial segment prefetching for smoother playback start
   */
  async generateVariantPlaylist(
    mediaId: string,
    quality: string,
    audioTrack: string = 'default',
    token?: string,
    session?: string
  ): Promise<string> {
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) {
      throw new Error('Media not found');
    }

    const duration = media.duration || 0;
    const layout = await this.currentLayout(media.id, duration);
    const count = segmentCount(layout);

    // The first play of a file is what pays for reading its keyframes and for
    // encoding its audio, and it pays nothing: both of these return at once,
    // and this viewer is carried by the grid and by per-segment audio exactly
    // as they were before either existed.
    void this.learnKeyframes(media.id, media.path);
    void this.prepareRungAudio(media.id, media.path, quality, audioTrack);

    const carried =
      (token ? `&token=${encodeURIComponent(token)}` : '') +
      (session ? `&session=${encodeURIComponent(session)}` : '');
    const fmp4 = isFmp4Quality(quality);

    const lines: string[] = [
      '#EXTM3U',
      // Version 7 is what `#EXT-X-MAP` on a media playlist requires.
      `#EXT-X-VERSION:${fmp4 ? 7 : 3}`,
      // Segments cut at keyframes are as long as the gaps between them, so
      // this is measured rather than assumed; a player sizes its buffer from it.
      `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(longestSegment(layout)))}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
    ];

    if (fmp4) {
      // Fragments carry no header of their own; this is where the player gets
      // the track descriptions it needs before the first segment means anything.
      lines.push(
        `#EXT-X-MAP:URI="${quality}/${INIT_SEGMENT_NAME}?audioTrack=${audioTrack}&layout=${layout.id}${carried}"`
      );
    }

    for (let i = 0; i < count; i++) {
      lines.push(`#EXTINF:${segmentLength(layout, i).toFixed(3)},`);
      // The layout goes with the URL so that this playlist keeps working for
      // as long as the player holds it, whatever is probed in the meantime.
      lines.push(
        `${quality}/${segmentFileName(quality, i)}?audioTrack=${audioTrack}&layout=${layout.id}${carried}`
      );
    }

    lines.push('#EXT-X-ENDLIST');

    // Trigger initial segment prefetch (non-blocking)
    // This ensures the first few segments are ready when the player requests them
    this.prefetchInitialSegments(media.path, layout, quality, audioTrack, mediaId);

    return lines.join('\n');
  }

  /**
   * Prefetch the initial segments when a playlist is first requested
   * This significantly reduces initial buffering time
   */
  private async prefetchInitialSegments(
    videoPath: string,
    layout: SegmentLayout,
    quality: string,
    audioTrack: string,
    mediaId: string
  ): Promise<void> {
    const settings = await this.getSettings();
    const prefetchCount = settings.prefetchSegments || 2;
    const variantPath = this.getVariantCachePath(mediaId, quality, audioTrack, layout.id);

    // Generate initial segments (0, 1, 2, ...) in parallel
    for (let i = 0; i < prefetchCount; i++) {
      this.ensureSegment(videoPath, layout, quality, i, audioTrack, variantPath, 'prefetch').catch((err) => {
        if (!isCancellation(err)) console.error(`Initial prefetch failed for segment ${i}:`, err);
      });
    }
  }

  /**
   * Get or generate a segment file
   * Returns the path to the segment file, generating it if needed
   * Also triggers prefetching of upcoming segments
   */
  /**
   * Answer a player's request for a segment, streaming it if it has to be
   * encoded first.
   *
   * The segment is written to `sink` as FFmpeg produces it, so the first byte
   * arrives after the muxer's first packets rather than after a whole segment
   * of video. On a slow encoder that is the difference between a seek costing
   * a fraction of a second and costing six.
   *
   * A cached segment is reported back as a file so the caller can serve it
   * with a Content-Length; only a fresh encode streams. A request arriving
   * while the same segment is already being encoded waits for it and then
   * gets the file, rather than starting a second encode of the same thing.
   */
  async serveSegment(
    mediaId: string,
    quality: string,
    segmentIndex: number,
    audioTrack: string,
    sink: Writable,
    /** Which viewer is asking; see `cancelStalePrefetches`. */
    session?: string,
    /** Which cut of the file the player's playlist describes. */
    layoutId?: string
  ): Promise<SegmentDelivery> {
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) return { kind: 'missing' };

    const layout = await this.layoutFor(mediaId, media.duration || 0, layoutId);
    const variantPath = this.getVariantCachePath(mediaId, quality, audioTrack, layout.id);
    const segmentPath = path.join(variantPath, segmentFileName(quality, segmentIndex));
    const settings = await this.getSettings();

    // The player has told us where it is; anything still encoding behind it is
    // wasted work holding a transcode slot.
    this.cancelStalePrefetches(variantPath, segmentIndex, settings.prefetchSegments || 2, session);

    const prefetchNext = () =>
      this.prefetchSegments(
        media.path,
        layout,
        quality,
        segmentIndex,
        audioTrack,
        variantPath,
        session
      );

    if (fs.existsSync(segmentPath)) {
      if (fs.statSync(segmentPath).size > 0) {
        this.touchFile(segmentPath);
        prefetchNext();
        return { kind: 'file', path: segmentPath };
      }
      // A zero-byte file is an interrupted encode.
      fs.unlinkSync(segmentPath);
    }

    // Already being encoded, by a prefetch or another viewer: wait for it
    // rather than running FFmpeg over the same seconds twice.
    const existing = this.generatingSegments.get(`${variantPath}:${segmentIndex}`);
    if (existing) {
      existing.priority = 'live';
      try {
        await existing.promise;
      } catch {
        return { kind: 'missing' };
      }
      if (fs.existsSync(segmentPath)) {
        prefetchNext();
        return { kind: 'file', path: segmentPath };
      }
      return { kind: 'missing' };
    }

    try {
      await this.ensureSegment(
        media.path,
        layout,
        quality,
        segmentIndex,
        audioTrack,
        variantPath,
        'live',
        sink
      );
    } catch (error) {
      console.error(`Segment generation failed for ${mediaId} ${quality}/${segmentIndex}:`, error);
      // A failure after the first bytes went out has already cut the response;
      // one before it (a segment past the end of the file, a missing input)
      // has not, and the caller still owes the client an answer.
      return sink.destroyed || sink.writableEnded ? { kind: 'streamed' } : { kind: 'missing' };
    }

    prefetchNext();
    return { kind: 'streamed' };
  }

  async getSegment(
    mediaId: string,
    quality: string,
    segmentIndex: number,
    audioTrack: string = 'default',
    layoutId?: string
  ): Promise<string | null> {
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) {
      return null;
    }

    const layout = await this.layoutFor(mediaId, media.duration || 0, layoutId);
    const variantPath = this.getVariantCachePath(mediaId, quality, audioTrack, layout.id);
    const segmentPath = path.join(variantPath, segmentFileName(quality, segmentIndex));

    // The player has told us where it is. Anything still encoding for a part
    // of this variant it has left behind (a seek, or a jump backwards) is
    // wasted work holding a transcode slot.
    const settings = await this.getSettings();
    this.cancelStalePrefetches(variantPath, segmentIndex, settings.prefetchSegments || 2);

    // Check if segment already exists and has content
    if (fs.existsSync(segmentPath)) {
      const stat = fs.statSync(segmentPath);
      if (stat.size > 0) {
        // Update access time for cache management
        this.touchFile(segmentPath);

        // Trigger prefetch for upcoming segments (non-blocking)
        this.prefetchSegments(media.path, layout, quality, segmentIndex, audioTrack, variantPath);

        return segmentPath;
      }
      // Empty file - delete and regenerate
      fs.unlinkSync(segmentPath);
    }

    try {
      await this.ensureSegment(media.path, layout, quality, segmentIndex, audioTrack, variantPath);
    } catch (error) {
      console.error(`Segment generation failed for ${mediaId} ${quality}/${segmentIndex}:`, error);
      return null;
    }

    if (fs.existsSync(segmentPath)) {
      // Trigger prefetch for upcoming segments
      this.prefetchSegments(media.path, layout, quality, segmentIndex, audioTrack, variantPath);
      return segmentPath;
    }

    return null;
  }

  /**
   * Prefetch upcoming segments in the background
   */
  private async prefetchSegments(
    videoPath: string,
    layout: SegmentLayout,
    quality: string,
    currentIndex: number,
    audioTrack: string,
    variantPath: string,
    session?: string
  ): Promise<void> {
    const settings = await this.getSettings();
    const prefetchCount = settings.prefetchSegments || 2;
    const maxSegment = segmentCount(layout) - 1;

    // Prefetch next N segments
    for (let i = 1; i <= prefetchCount; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex > maxSegment) break;

      this.ensureSegment(
        videoPath,
        layout,
        quality,
        nextIndex,
        audioTrack,
        variantPath,
        'prefetch',
        undefined,
        session
      ).catch(
        (err) => {
          if (!isCancellation(err)) console.error(`Prefetch failed for segment ${nextIndex}:`, err);
        }
      );
    }
  }

  /**
   * Generate a specific segment using FFmpeg
   */
  private async generateSegment(
    videoPath: string,
    layout: SegmentLayout,
    quality: string,
    segmentIndex: number,
    audioTrack: string,
    outputDir: string,
    job: SegmentJob = { promise: Promise.resolve(), variantPath: outputDir, index: segmentIndex, priority: 'live', cancelled: false, child: null },
    /**
     * When given, FFmpeg writes to a pipe and every chunk goes here as well as
     * to the cache file, so the player gets its first bytes after the muxer's
     * first packets rather than after the whole segment.
     */
    sink?: Writable
  ): Promise<void> {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get settings and encoder
    const settings = await this.getSettings();
    const encoder = await this.getActiveEncoder();
    const presets = await this.getQualityPresets();

    // Where this segment starts and how long it runs comes from the layout,
    // not from arithmetic on an index: on a probed file the segments are of
    // different lengths, because the file's keyframes are unevenly spaced.
    const startTime = segmentStart(layout, segmentIndex);
    const segmentDuration = segmentLength(layout, segmentIndex);

    if (segmentDuration <= 0) {
      throw new Error(`Invalid segment index: ${segmentIndex}`);
    }

    const outputPath = path.join(outputDir, segmentFileName(quality, segmentIndex));
    const isOriginal = quality === ORIGINAL_QUALITY;
    const fmp4 = isFmp4Quality(quality);
    const qualityPreset = isOriginal ? null : presets[quality];

    const ffmpegArgs: string[] = [];

    // Anything the encoder needs before the input, such as VAAPI's render node,
    // and the accelerator's decoder when it can take this codec.
    if (!isOriginal && qualityPreset) {
      ffmpegArgs.push(...getEncoderInputArgs(encoder));
      ffmpegArgs.push(...getDecoderInputArgs(encoder, await this.videoCodecOf(videoPath)));
    }

    // Where the seek goes decides both what the segment contains and how long
    // it takes to produce, and the two rungs want different things.
    //
    // A transcode seeks before the input: fast, and exact, because the frames
    // are decoded and re-encoded so the cut can fall anywhere.
    //
    // A copy cannot cut between keyframes, and FFmpeg's two seeks fail it in
    // opposite directions. Before the input, it lands on a keyframe at or
    // before the target and includes everything from there, mislabelled — on a
    // real episode here, a 6s slot came back holding 10.7s starting 4.5s
    // early. After the input it is exact, but it demuxes the file from the
    // beginning to get there: 14.2 seconds to produce a 5.9 second segment
    // from the middle of that episode, so playback stalled at every boundary
    // and only kept up if the viewer paused long enough to build a buffer.
    //
    // Doing both is exact *and* fast. The input seek gets somewhere close for
    // nothing, the output seek covers the rest — and because a seek before the
    // input rebases the timeline onto the point that was asked for rather than
    // the point it reached, the two add up whatever keyframe it actually
    // landed on. Same bytes as the output seek alone, measured: 0.35s instead
    // of 14.2.
    // How this segment gets its sound. Copying from the source is best and
    // needs nothing; failing that, copying from one encode of the whole track
    // avoids the per-segment priming delay (`preparedAudio.ts`); failing that,
    // it is re-encoded here, which is what every segment did before and what
    // the first play of a file still does while the track is being prepared.
    const audioTrackDir = path.dirname(outputDir);
    const audioBitrate = qualityPreset?.audioBitrate ?? ORIGINAL_AUDIO_BITRATE;
    const copyFromSource = isOriginal && (await this.canCopyAudio(videoPath, audioTrack));
    // Every rung that would otherwise run the encoder over its own few seconds,
    // which is all of them but a copy rung with playable sound. The transcode
    // rungs are not a special case here: a browser choosing for itself lands on
    // one of them far more often than on `original`.
    const copyFromPrepared = !copyFromSource && hasPreparedAudio(audioTrackDir, audioBitrate);
    const copyingAudio = copyFromSource || copyFromPrepared;
    // The TTL sweep keys on access time, and a track being copied into every
    // segment of a film nobody has finished would otherwise look untouched.
    if (copyFromPrepared) this.touchFile(preparedAudioPath(audioTrackDir, audioBitrate));

    if (startTime > 0) {
      const preRoll = isOriginal ? Math.min(startTime, COPY_SEEK_PRE_ROLL) : 0;
      const before = startTime - preRoll;
      if (before > 0) ffmpegArgs.push('-ss', before.toString());
      ffmpegArgs.push('-i', videoPath);
      // The prepared track is a second input, seeked to the same instant so
      // that the one output seek below cuts both of them in the same place.
      if (copyFromPrepared) {
        if (before > 0) ffmpegArgs.push('-ss', before.toString());
        ffmpegArgs.push('-i', preparedAudioPath(audioTrackDir, audioBitrate));
      }
      if (preRoll > 0) ffmpegArgs.push('-ss', preRoll.toString());
    } else {
      ffmpegArgs.push('-i', videoPath);
      if (copyFromPrepared) {
        ffmpegArgs.push('-i', preparedAudioPath(audioTrackDir, audioBitrate));
      }
    }

    // Duration limit, rounded up rather than down when the audio is copied.
    ffmpegArgs.push(
      '-t',
      (copyingAudio ? segmentDuration + AUDIO_COPY_PAD : segmentDuration).toString()
    );

    // Map video stream
    ffmpegArgs.push('-map', '0:v:0');

    // Map audio stream
    if (copyFromPrepared) {
      // The track was chosen when it was prepared, so it is the only one here.
      ffmpegArgs.push('-map', '1:a:0');
    } else if (audioTrack !== 'default') {
      ffmpegArgs.push('-map', `0:${audioTrack}`);
    } else {
      ffmpegArgs.push('-map', '0:a:0?');
    }

    if (isOriginal) {
      // The picture is copied either way: that is the whole point of this rung
      // and the bulk of the CPU. Only the sound is re-encoded, and only when a
      // browser could not have played it.
      ffmpegArgs.push('-c:v', 'copy');
      if (copyingAudio) {
        ffmpegArgs.push('-c:a', 'copy');
      } else {
        ffmpegArgs.push('-c:a', 'aac', `-b:a`, `${ORIGINAL_AUDIO_BITRATE}k`, '-ac', '2');
      }
      // Apple's players want the sample entry spelled `hvc1`, not `hev1`, and
      // a copied HEVC stream keeps whichever tag the source file used.
      if ((await this.videoCodecOf(videoPath)) === 'hevc') {
        ffmpegArgs.push('-tag:v', 'hvc1');
      }
      // Timestamps run from zero within this segment; `Fmp4Splitter` puts it
      // back on the file's timeline by rewriting the fragments' decode times,
      // because FFmpeg numbers every fragment run from zero and each segment
      // is its own FFmpeg process.
    } else if (qualityPreset) {
      // Add encoder-specific arguments
      const encoderArgs = getEncoderArgs(
        encoder,
        qualityPreset.videoBitrate,
        qualityPreset.width,
        qualityPreset.height
      );

      // For software encoder, apply additional settings
      if (encoder.encoder === 'libx264') {
        // Override preset from settings
        const presetIndex = encoderArgs.indexOf('-preset');
        if (presetIndex !== -1) {
          encoderArgs[presetIndex + 1] = settings.preset || 'veryfast';
        }

        // Add low latency tuning if enabled
        if (settings.enableLowLatency) {
          const tuneIndex = encoderArgs.indexOf('-tune');
          if (tuneIndex === -1) {
            encoderArgs.push('-tune', 'zerolatency');
          }
        }

        // Thread configuration
        if (settings.threadCount > 0) {
          const threadIndex = encoderArgs.indexOf('-threads');
          if (threadIndex !== -1) {
            encoderArgs[threadIndex + 1] = settings.threadCount.toString();
          } else {
            encoderArgs.push('-threads', settings.threadCount.toString());
          }
        }
      }

      ffmpegArgs.push(...encoderArgs);

      // Audio encoding, unless the whole track has already been encoded at
      // this rung's bitrate and can simply be copied.
      if (copyFromPrepared) {
        ffmpegArgs.push('-c:a', 'copy');
      } else {
        ffmpegArgs.push('-c:a', 'aac', '-b:a', `${qualityPreset.audioBitrate}k`, '-ac', '2');
      }

      // Force keyframe at segment boundaries for clean switching
      // One at the start of the segment, so a player switching rungs mid-file
      // finds a keyframe exactly where the copy rung has one.
      ffmpegArgs.push('-force_key_frames', `expr:gte(t,n_forced*${segmentDuration})`);

      // For transcoding, reset timestamps and offset to expected position
      ffmpegArgs.push('-output_ts_offset', startTime.toString());
    }

    // Output format settings for HLS segments
    if (fmp4) {
      ffmpegArgs.push(
        '-f', 'mp4',
        // `empty_moov` puts the header up front so the output can be written to
        // a pipe at all; `frag_keyframe` closes a fragment at each keyframe so
        // bytes leave the muxer during the segment rather than at the end of it.
        '-movflags', '+empty_moov+default_base_moof+frag_keyframe'
      );
    } else {
      ffmpegArgs.push(
        '-f', 'mpegts',
        '-mpegts_copyts', '1',
        '-avoid_negative_ts', 'disabled'
      );
    }

    // A fragmented segment always goes through the pipe: its header has to be
    // peeled off and its decode times rewritten before anything is stored or
    // sent. Otherwise streaming writes to a pipe and the cache file is
    // assembled alongside it, and a prefetch, which nobody is waiting for,
    // writes straight to the file.
    const piped = fmp4 || Boolean(sink);
    const tempPath = `${outputPath}.part-${randomUUID().slice(0, 8)}`;
    if (piped) {
      ffmpegArgs.push('pipe:1');
    } else {
      ffmpegArgs.push('-y', outputPath);
    }

    // Acquire a transcode slot (waits if at max concurrency)
    const releaseSlot = await this.acquireTranscodeSlot(job);

    // The player may have moved on while this waited for a slot.
    if (job.cancelled) {
      releaseSlot();
      throw new SegmentCancelledError(segmentIndex);
    }

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      job.child = ffmpeg;
      this.activeProcesses.add(ffmpeg);

      // The cache copy is written under a temporary name and renamed only on
      // a clean exit, so a truncated encode can never be served as complete.
      const tempFile = piped ? fs.createWriteStream(tempPath) : null;
      // A write stream with no error listener throws out of the event loop, so
      // a full disk would take the process down rather than one segment.
      tempFile?.on('error', (error) => {
        console.warn(`Could not write the cache copy of segment ${segmentIndex}:`, error);
      });
      const emit = (chunk: Buffer) => {
        if (tempFile && !tempFile.destroyed) tempFile.write(chunk);
        // Deliberately not awaiting backpressure from the sink: a client that
        // stalls must not stall the encode, and one segment is small enough
        // to hold. The cache write is the one that has to finish.
        if (sink && !sink.destroyed) sink.write(chunk);
      };

      // A fragmented segment is two things on one pipe: the initialisation
      // segment every segment of this variant shares, written once beside them,
      // and this segment's own fragments, rebased onto the file's timeline.
      const splitter = fmp4
        ? new Fmp4Splitter({
            startSeconds: startTime,
            onInit: (init) => this.storeInitSegment(outputDir, init),
            onMedia: emit,
          })
        : null;

      if (piped && ffmpeg.stdout) {
        ffmpeg.stdout.on('data', (chunk: Buffer) => {
          if (splitter) splitter.write(chunk);
          else emit(chunk);
        });
      }

      let stderr = '';
      let timedOut = false;
      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // A segment that takes this long is stuck (unreadable source, hung encoder);
      // kill it so the slot is freed and the player gets an error instead of a hang.
      const timer = setTimeout(() => {
        timedOut = true;
        ffmpeg.kill('SIGKILL');
      }, this.segmentTimeoutMs);

      const finish = () => {
        clearTimeout(timer);
        job.child = null;
        this.activeProcesses.delete(ffmpeg);
        releaseSlot();
      };

      /** Drop the half-written cache copy and cut the response short. */
      const abandon = (error: Error) => {
        if (tempFile) {
          // A write stream opens its file asynchronously, so a segment
          // abandoned in its first moments can be unlinked before the file
          // exists and then have it appear afterwards, stranding a `.part-`
          // file in the cache. Wait for the stream to close first.
          tempFile.destroy();
          if (tempFile.closed) {
            fs.rmSync(tempPath, { force: true });
          } else {
            tempFile.once('close', () => fs.rmSync(tempPath, { force: true }));
          }
        }
        fs.rmSync(outputPath, { force: true });
        sink?.destroy(error);
        reject(error);
      };

      ffmpeg.on('close', (code) => {
        finish();
        splitter?.end();

        if (code !== 0 || job.cancelled) {
          if (job.cancelled) {
            abandon(new SegmentCancelledError(segmentIndex));
          } else if (timedOut) {
            abandon(new Error(`FFmpeg timed out after ${this.segmentTimeoutMs}ms generating segment ${segmentIndex}`));
          } else {
            console.error(`FFmpeg segment generation failed:\n${stderr}`);
            abandon(new Error(`FFmpeg exited with code ${code}`));
          }
          return;
        }

        if (!tempFile) {
          resolve();
          return;
        }

        // Only now is the file complete, so give it the name the cache uses.
        tempFile.end(() => {
          try {
            fs.renameSync(tempPath, outputPath);
          } catch (error) {
            console.warn(`Could not cache segment ${segmentIndex}:`, error);
            fs.rmSync(tempPath, { force: true });
          }
          sink?.end();
          resolve();
        });
      });

      ffmpeg.on('error', (err) => {
        finish();
        abandon(err);
      });
    });
  }

  /**
   * Write the initialisation segment beside the media segments of its variant.
   * Every segment's FFmpeg run produces an identical one, so the first to
   * arrive wins and the rest are ignored; the write is via a temporary name so
   * a reader never sees a half-written header.
   */
  private storeInitSegment(variantPath: string, init: Buffer): void {
    const initPath = path.join(variantPath, INIT_SEGMENT_NAME);
    try {
      if (fs.existsSync(initPath) && fs.statSync(initPath).size > 0) return;
      const tempPath = `${initPath}.part-${randomUUID().slice(0, 8)}`;
      fs.writeFileSync(tempPath, init);
      fs.renameSync(tempPath, initPath);
    } catch (error) {
      console.warn('Could not cache the initialisation segment:', error);
    }
  }

  /**
   * The initialisation segment for a variant, generating it if it is not
   * cached. The player asks for this before any media segment, so it cannot
   * wait for one; when nothing is cached yet, a short FFmpeg run produces the
   * header and its media fragments are thrown away.
   */
  async getInitSegment(
    mediaId: string,
    quality: string,
    audioTrack: string = 'default',
    layoutId?: string
  ): Promise<string | null> {
    if (!isFmp4Quality(quality)) return null;
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) return null;

    const layout = await this.layoutFor(mediaId, media.duration || 0, layoutId);
    const variantPath = this.getVariantCachePath(mediaId, quality, audioTrack, layout.id);
    const initPath = path.join(variantPath, INIT_SEGMENT_NAME);
    try {
      if (fs.statSync(initPath).size > 0) {
        this.touchFile(initPath);
        return initPath;
      }
    } catch {
      // Not cached yet
    }

    try {
      // The first segment is what a player asks for next anyway, so generating
      // it now is not wasted work.
      await this.ensureSegment(media.path, layout, quality, 0, audioTrack, variantPath);
    } catch (error) {
      console.error(`Could not produce an initialisation segment for ${mediaId}:`, error);
      return null;
    }

    return fs.existsSync(initPath) ? initPath : null;
  }

  /**
   * Update file access time for cache management
   */
  private touchFile(filePath: string): void {
    try {
      const now = new Date();
      fs.utimesSync(filePath, now, now);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get available qualities for a media item
   * Returns all quality presets plus original (if native format)
   */
  async getAvailableQualities(mediaId: string): Promise<string[]> {
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) {
      return [];
    }

    const qualities: string[] = [];

    // Original (stream copy) only when the probed codecs are browser-playable
    if (await this.canDirectPlay(media.id, media.path)) {
      qualities.push(ORIGINAL_QUALITY);
    }

    // Add all quality presets (highest to lowest)
    qualities.push('1080p', '720p', '480p', '360p');

    return qualities;
  }

  /**
   * Clean up cache for a specific media item
   */
  async cleanupMediaCache(mediaId: string): Promise<void> {
    this.layoutCache.delete(mediaId);
    if (evictMediaCache(mediaId, this.cachePath)) {
      console.log(`Cleaned up HLS cache for media: ${mediaId}`);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{ totalSize: number; mediaCount: number; segmentCount: number }> {
    return collectCacheStats(this.cachePath);
  }

  /**
   * Clean up old segments based on TTL
   */
  async cleanupOldSegments(ttlHours: number): Promise<number> {
    return sweepExpiredSegments(this.cachePath, ttlHours);
  }

  /** Evict least-recently-used segments until the cache is under `maxSizeGB`. */
  async enforceCacheSize(maxSizeGB: number): Promise<{ deleted: number; freedBytes: number }> {
    return enforceCacheSize(this.cachePath, maxSizeGB * 1024 * 1024 * 1024);
  }
}

let sharedInstance: HlsService | null = null;

/** Process-wide instance; created on first use so encoder detection runs once. */
export function getHlsService(): HlsService {
  if (!sharedInstance) sharedInstance = new HlsService();
  return sharedInstance;
}

/** Kill running encodes if the shared instance exists (server shutdown). */
export function shutdownHlsService(): void {
  sharedInstance?.shutdown();
}
