import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { loadAppConfig, getHlsCacheConfig } from '../config/appConfig';
import { MediaService } from './mediaService';
import { detectBestEncoder, getEncoderArgs, type HardwareEncoder } from '../utils/hwaccel';
import { getTranscodingSettings, getTranscodingSettingsVersion } from './transcodingSettingsService';
import { prisma } from '../config/database';
import {
  collectCacheStats,
  enforceCacheSize,
  evictMediaCache,
  isDirectPlayable,
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

export class HlsService {
  private mediaService: MediaService;
  private cachePath: string;
  private defaultSegmentDuration: number;
  // Track in-progress segment generations to prevent concurrent generation of same segment
  /** In-flight segment encodes keyed by `<variantPath>:<index>`, shared by player requests and prefetch. */
  private generatingSegments: Map<string, Promise<void>> = new Map();
  /** FFmpeg children still running, so they can be killed on shutdown. */
  private activeProcesses: Set<ChildProcess> = new Set();
  private readonly segmentTimeoutMs: number;
  // Detected video encoder (detected once at startup)
  private detectedEncoder: HardwareEncoder;
  // Settings cache
  private settingsCache: TranscodingSettings | null = null;
  private settingsCacheTime: number = 0;
  private settingsVersionSeen: number = -1;
  private readonly SETTINGS_CACHE_TTL = 30000; // 30 seconds
  // Concurrency control for FFmpeg processes
  private activeTranscodes: number = 0;
  private waitingQueue: Array<() => void> = [];

  constructor(options: { segmentTimeoutMs?: number } = {}) {
    this.segmentTimeoutMs = options.segmentTimeoutMs ?? 120000;
    this.mediaService = new MediaService();
    const appConfig = loadAppConfig();
    const hlsConfig = getHlsCacheConfig(appConfig);
    this.cachePath = hlsConfig.path;
    this.defaultSegmentDuration = hlsConfig.segmentDuration;
    // Detect best encoder at startup
    this.detectedEncoder = detectBestEncoder();
  }

  /**
   * Acquire a slot for transcoding, waiting if necessary
   * Returns a release function to call when done
   */
  private async acquireTranscodeSlot(): Promise<() => void> {
    const settings = await this.getSettings();
    const maxConcurrent = settings.maxConcurrentTranscodes || 2;

    // If we have capacity, acquire immediately
    if (this.activeTranscodes < maxConcurrent) {
      this.activeTranscodes++;
      return () => this.releaseTranscodeSlot();
    }

    // Otherwise, wait in queue
    return new Promise((resolve) => {
      this.waitingQueue.push(() => {
        this.activeTranscodes++;
        resolve(() => this.releaseTranscodeSlot());
      });
    });
  }

  /**
   * Release a transcoding slot and wake up next waiter if any
   */
  private releaseTranscodeSlot(): void {
    this.activeTranscodes--;
    const next = this.waitingQueue.shift();
    if (next) {
      next();
    }
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

    // If hardware accel is disabled and detected encoder is hardware, fall back to software
    if (!settings.enableHardwareAccel && this.detectedEncoder.type === 'hardware') {
      return {
        name: 'x264 (Software)',
        encoder: 'libx264',
        type: 'software',
        priority: 100,
      };
    }

    return this.detectedEncoder;
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

  /** Decide `original` eligibility from the probed stream codecs (see `isDirectPlayable`). */
  async canDirectPlay(mediaId: string, filePath: string): Promise<boolean> {
    const streams = await prisma.mediaStream.findMany({
      where: { mediaId },
      select: { streamType: true, codec: true },
      orderBy: { streamIndex: 'asc' },
    });
    return isDirectPlayable(streams, filePath);
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
    variantPath: string
  ): Promise<void> {
    const segmentPath = path.join(variantPath, `${segmentIndex}.ts`);
    try {
      if (fs.statSync(segmentPath).size > 0) return Promise.resolve();
    } catch {
      // Not cached yet
    }
    const key = `${variantPath}:${segmentIndex}`;
    const existing = this.generatingSegments.get(key);
    if (existing) return existing;

    const generation = this.generateSegment(videoPath, totalDuration, quality, segmentIndex, audioTrack, variantPath)
      .finally(() => {
        this.generatingSegments.delete(key);
      });
    this.generatingSegments.set(key, generation);
    return generation;
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
  async generateMasterPlaylist(mediaId: string, audioTrack?: number): Promise<string> {
    const media = await this.mediaService.getVideoById(mediaId);
    if (!media) {
      throw new Error('Media not found');
    }

    const presets = await this.getQualityPresets();
    const audioTrackStr = audioTrack !== undefined ? audioTrack.toString() : 'default';
    const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];

    // Add original quality (stream copy) first, when the codecs allow it
    if (await this.canDirectPlay(media.id, media.path)) {
      // For native formats, we can offer original quality
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=20000000,RESOLUTION=native,NAME="Original"`);
      lines.push(`${ORIGINAL_QUALITY}.m3u8?audioTrack=${audioTrackStr}`);
    }

    // Add transcoded quality options (highest to lowest)
    const qualities = ['1080p', '720p', '480p', '360p'];
    for (const quality of qualities) {
      const preset = presets[quality];
      const bandwidth = (preset.videoBitrate + preset.audioBitrate) * 1000; // Convert to bps
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${preset.width}x${preset.height},NAME="${preset.label}"`);
      lines.push(`${quality}.m3u8?audioTrack=${audioTrackStr}`);
    }

    return lines.join('\n');
  }

  /**
   * Generate or get variant playlist for a specific quality
   * Also triggers initial segment prefetching for smoother playback start
   */
  async generateVariantPlaylist(mediaId: string, quality: string, audioTrack: string = 'default'): Promise<string> {
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
      lines.push(`${quality}/${i}.ts?audioTrack=${audioTrack}`);
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
      this.ensureSegment(videoPath, totalDuration, quality, i, audioTrack, variantPath).catch((err) => {
        console.error(`Initial prefetch failed for segment ${i}:`, err);
      });
    }
  }

  /**
   * Get or generate a segment file
   * Returns the path to the segment file, generating it if needed
   * Also triggers prefetching of upcoming segments
   */
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
    variantPath: string
  ): Promise<void> {
    const settings = await this.getSettings();
    const prefetchCount = settings.prefetchSegments || 2;
    const segmentDuration = settings.segmentDuration || this.defaultSegmentDuration;
    const maxSegment = Math.ceil(totalDuration / segmentDuration) - 1;

    // Prefetch next N segments
    for (let i = 1; i <= prefetchCount; i++) {
      const nextIndex = currentIndex + i;
      if (nextIndex > maxSegment) break;

      this.ensureSegment(videoPath, totalDuration, quality, nextIndex, audioTrack, variantPath).catch((err) => {
        console.error(`Prefetch failed for segment ${nextIndex}:`, err);
      });
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
    outputDir: string
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
      // Stream copy for original quality
      ffmpegArgs.push('-c:v', 'copy');
      ffmpegArgs.push('-c:a', 'copy');
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
      '-avoid_negative_ts', 'disabled',
      '-y', // Overwrite output file if exists
      outputPath
    );

    // Acquire a transcode slot (waits if at max concurrency)
    const releaseSlot = await this.acquireTranscodeSlot();

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      this.activeProcesses.add(ffmpeg);

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
        this.activeProcesses.delete(ffmpeg);
        releaseSlot();
      };

      ffmpeg.on('close', (code) => {
        finish();
        if (code === 0) {
          resolve();
        } else {
          // Never leave a partial segment behind: a zero-length or truncated file
          // would be served as if complete.
          fs.rmSync(outputPath, { force: true });
          if (timedOut) {
            reject(new Error(`FFmpeg timed out after ${this.segmentTimeoutMs}ms generating segment ${segmentIndex}`));
          } else {
            console.error(`FFmpeg segment generation failed:\n${stderr}`);
            reject(new Error(`FFmpeg exited with code ${code}`));
          }
        }
      });

      ffmpeg.on('error', (err) => {
        finish();
        reject(err);
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
