import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Writable } from 'stream';
import { spawn, type ChildProcess } from 'child_process';
import { loadAppConfig, getHlsCacheConfig } from '../config/appConfig';
import { MediaService } from './mediaService';
import {
  detectBestEncoderAsync,
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
  private audioCopyCache = new Map<string, { copyable: boolean; expires: number }>();

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
    totalDuration: number,
    quality: string,
    segmentIndex: number,
    audioTrack: string,
    variantPath: string,
    priority: SegmentPriority = 'live',
    /** When given, the encode is written here as it is produced. */
    sink?: Writable,
    session?: string
  ): Promise<void> {
    const segmentPath = path.join(variantPath, `${segmentIndex}.ts`);
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
      totalDuration,
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
  getVariantCachePath(mediaId: string, quality: string, audioTrack: string = 'default'): string {
    return path.join(this.cachePath, mediaId, `a${audioTrack}`, quality);
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
      // For native formats, we can offer original quality
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=20000000,RESOLUTION=native,NAME="Original"`);
      lines.push(`${ORIGINAL_QUALITY}.m3u8?audioTrack=${audioTrackStr}${auth}`);
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

    const segmentDuration = await this.getSegmentDuration();
    const duration = media.duration || 0;
    const segmentCount = Math.ceil(duration / segmentDuration);

    const lines: string[] = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${segmentDuration + 1}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
    ];

    for (let i = 0; i < segmentCount; i++) {
      const segmentDur = Math.min(segmentDuration, duration - (i * segmentDuration));
      lines.push(`#EXTINF:${segmentDur.toFixed(3)},`);
      // Include quality in segment URL path so it resolves correctly
      const carried =
        (token ? `&token=${encodeURIComponent(token)}` : '') +
        (session ? `&session=${encodeURIComponent(session)}` : '');
      lines.push(`${quality}/${i}.ts?audioTrack=${audioTrack}${carried}`);
    }

    lines.push('#EXT-X-ENDLIST');

    // Trigger initial segment prefetch (non-blocking)
    // This ensures the first few segments are ready when the player requests them
    this.prefetchInitialSegments(media.path, duration, quality, audioTrack, mediaId);

    return lines.join('\n');
  }

  /**
   * Prefetch the initial segments when a playlist is first requested
   * This significantly reduces initial buffering time
   */
  private async prefetchInitialSegments(
    videoPath: string,
    totalDuration: number,
    quality: string,
    audioTrack: string,
    mediaId: string
  ): Promise<void> {
    const settings = await this.getSettings();
    const prefetchCount = settings.prefetchSegments || 2;
    const variantPath = this.getVariantCachePath(mediaId, quality, audioTrack);

    // Generate initial segments (0, 1, 2, ...) in parallel
    for (let i = 0; i < prefetchCount; i++) {
      this.ensureSegment(videoPath, totalDuration, quality, i, audioTrack, variantPath, 'prefetch').catch((err) => {
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
    session?: string
  ): Promise<SegmentDelivery> {
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) return { kind: 'missing' };

    const variantPath = this.getVariantCachePath(mediaId, quality, audioTrack);
    const segmentPath = path.join(variantPath, `${segmentIndex}.ts`);
    const settings = await this.getSettings();

    // The player has told us where it is; anything still encoding behind it is
    // wasted work holding a transcode slot.
    this.cancelStalePrefetches(variantPath, segmentIndex, settings.prefetchSegments || 2, session);

    const prefetchNext = () =>
      this.prefetchSegments(
        media.path,
        media.duration || 0,
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
        media.duration || 0,
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
    audioTrack: string = 'default'
  ): Promise<string | null> {
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) {
      return null;
    }

    const variantPath = this.getVariantCachePath(mediaId, quality, audioTrack);
    const segmentPath = path.join(variantPath, `${segmentIndex}.ts`);

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
        this.prefetchSegments(media.path, media.duration || 0, quality, segmentIndex, audioTrack, variantPath);

        return segmentPath;
      }
      // Empty file - delete and regenerate
      fs.unlinkSync(segmentPath);
    }

    try {
      await this.ensureSegment(media.path, media.duration || 0, quality, segmentIndex, audioTrack, variantPath);
    } catch (error) {
      console.error(`Segment generation failed for ${mediaId} ${quality}/${segmentIndex}:`, error);
      return null;
    }

    if (fs.existsSync(segmentPath)) {
      // Trigger prefetch for upcoming segments
      this.prefetchSegments(media.path, media.duration || 0, quality, segmentIndex, audioTrack, variantPath);
      return segmentPath;
    }

    return null;
  }

  /**
   * Prefetch upcoming segments in the background
   */
  private async prefetchSegments(
    videoPath: string,
    totalDuration: number,
    quality: string,
    currentIndex: number,
    audioTrack: string,
    variantPath: string,
    session?: string
  ): Promise<void> {
    const settings = await this.getSettings();
    const prefetchCount = settings.prefetchSegments || 2;
    const segmentDuration = settings.segmentDuration || this.defaultSegmentDuration;
    const maxSegment = Math.ceil(totalDuration / segmentDuration) - 1;

    // Prefetch next N segments
    for (let i = 1; i <= prefetchCount; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex > maxSegment) break;

      this.ensureSegment(
        videoPath,
        totalDuration,
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
    totalDuration: number,
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
    const configuredSegmentDuration = settings.segmentDuration || this.defaultSegmentDuration;

    const startTime = segmentIndex * configuredSegmentDuration;
    const segmentDuration = Math.min(configuredSegmentDuration, totalDuration - startTime);

    if (segmentDuration <= 0) {
      throw new Error(`Invalid segment index: ${segmentIndex}`);
    }

    const outputPath = path.join(outputDir, `${segmentIndex}.ts`);
    const isOriginal = quality === ORIGINAL_QUALITY;
    const qualityPreset = isOriginal ? null : presets[quality];

    const ffmpegArgs: string[] = [];

    // Anything the encoder needs before the input, such as VAAPI's render node.
    if (!isOriginal && qualityPreset) {
      ffmpegArgs.push(...getEncoderInputArgs(encoder));
    }

    // For stream copy, we need accurate seeking, so use -ss after -i
    // For transcoding, we can use -ss before -i for faster seeking
    if (!isOriginal && startTime > 0) {
      // Fast seek before input for transcoding
      ffmpegArgs.push('-ss', startTime.toString());
    }

    ffmpegArgs.push('-i', videoPath);

    if (isOriginal && startTime > 0) {
      // Accurate seek after input for stream copy
      ffmpegArgs.push('-ss', startTime.toString());
    }

    // Duration limit
    ffmpegArgs.push('-t', segmentDuration.toString());

    // Map video stream
    ffmpegArgs.push('-map', '0:v:0');

    // Map audio stream
    if (audioTrack !== 'default') {
      ffmpegArgs.push('-map', `0:${audioTrack}`);
    } else {
      ffmpegArgs.push('-map', '0:a:0?');
    }

    if (isOriginal) {
      // The picture is copied either way: that is the whole point of this rung
      // and the bulk of the CPU. Only the sound is re-encoded, and only when a
      // browser could not have played it.
      ffmpegArgs.push('-c:v', 'copy');
      if (await this.canCopyAudio(videoPath, audioTrack)) {
        ffmpegArgs.push('-c:a', 'copy');
      } else {
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
      }
      // For stream copy, keep original timestamps and let mpegts handle them
      ffmpegArgs.push('-copyts');
      // Set the output timestamp offset to match expected segment position
      ffmpegArgs.push('-output_ts_offset', startTime.toString());
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

      // Audio encoding
      ffmpegArgs.push(
        '-c:a', 'aac',
        '-b:a', `${qualityPreset.audioBitrate}k`,
        '-ac', '2'
      );

      // Force keyframe at segment boundaries for clean switching
      ffmpegArgs.push('-force_key_frames', `expr:gte(t,n_forced*${configuredSegmentDuration})`);

      // For transcoding, reset timestamps and offset to expected position
      ffmpegArgs.push('-output_ts_offset', startTime.toString());
    }

    // Output format settings for HLS segments
    ffmpegArgs.push(
      '-f', 'mpegts',
      '-mpegts_copyts', '1',
      '-avoid_negative_ts', 'disabled'
    );

    // Streaming writes to a pipe and the cache file is assembled alongside it;
    // a prefetch, which nobody is waiting for, writes straight to the file.
    const streaming = Boolean(sink);
    const tempPath = `${outputPath}.part-${randomUUID().slice(0, 8)}`;
    if (streaming) {
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
      const tempFile = streaming ? fs.createWriteStream(tempPath) : null;
      // A write stream with no error listener throws out of the event loop, so
      // a full disk would take the process down rather than one segment.
      tempFile?.on('error', (error) => {
        console.warn(`Could not write the cache copy of segment ${segmentIndex}:`, error);
      });
      if (streaming && ffmpeg.stdout) {
        ffmpeg.stdout.on('data', (chunk: Buffer) => {
          if (tempFile && !tempFile.destroyed) tempFile.write(chunk);
          // Deliberately not awaiting backpressure from the sink: a client that
          // stalls must not stall the encode, and one segment is small enough
          // to hold. The cache write is the one that has to finish.
          if (sink && !sink.destroyed) sink.write(chunk);
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
