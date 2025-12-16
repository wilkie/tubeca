import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { loadAppConfig, getHlsCacheConfig } from '../config/appConfig';
import { MediaService } from './mediaService';
import { detectBestEncoder, getEncoderArgs, type HardwareEncoder } from '../utils/hwaccel';
import { getTranscodingSettings } from './transcodingSettingsService';
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
  private generatingSegments: Map<string, Promise<void>> = new Map();
  // Detected video encoder (detected once at startup)
  private detectedEncoder: HardwareEncoder;
  // Settings cache
  private settingsCache: TranscodingSettings | null = null;
  private settingsCacheTime: number = 0;
  private readonly SETTINGS_CACHE_TTL = 30000; // 30 seconds

  constructor() {
    this.mediaService = new MediaService();
    const appConfig = loadAppConfig();
    const hlsConfig = getHlsCacheConfig(appConfig);
    this.cachePath = hlsConfig.path;
    this.defaultSegmentDuration = hlsConfig.segmentDuration;
    // Detect best encoder at startup
    this.detectedEncoder = detectBestEncoder();
  }

  /**
   * Get transcoding settings (with caching)
   */
  private async getSettings(): Promise<TranscodingSettings> {
    if (this.settingsCache && Date.now() - this.settingsCacheTime < this.SETTINGS_CACHE_TTL) {
      return this.settingsCache;
    }
    this.settingsCache = await getTranscodingSettings();
    this.settingsCacheTime = Date.now();
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

    // Add original quality (stream copy) first
    const ext = path.extname(media.path).toLowerCase();
    const nativeFormat = ['.mp4', '.webm'].includes(ext);

    if (nativeFormat) {
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
    return lines.join('\n');
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

    // Create a unique key for this segment
    const segmentKey = `${mediaId}:${quality}:${audioTrack}:${segmentIndex}`;

    // Check if generation is already in progress
    const existingGeneration = this.generatingSegments.get(segmentKey);
    if (existingGeneration) {
      // Wait for the existing generation to complete
      await existingGeneration;
      if (fs.existsSync(segmentPath)) {
        // Trigger prefetch for upcoming segments
        this.prefetchSegments(media.path, media.duration || 0, quality, segmentIndex, audioTrack, variantPath);
        return segmentPath;
      }
      return null;
    }

    // Start generation and track it
    const generationPromise = this.generateSegment(
      media.path,
      media.duration || 0,
      quality,
      segmentIndex,
      audioTrack,
      variantPath
    );

    this.generatingSegments.set(segmentKey, generationPromise);

    try {
      await generationPromise;
    } finally {
      // Clean up tracking
      this.generatingSegments.delete(segmentKey);
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

      const segmentPath = path.join(variantPath, `${nextIndex}.ts`);

      // Skip if already exists
      if (fs.existsSync(segmentPath)) {
        const stat = fs.statSync(segmentPath);
        if (stat.size > 0) continue;
      }

      const segmentKey = `prefetch:${variantPath}:${nextIndex}`;

      // Skip if already being generated
      if (this.generatingSegments.has(segmentKey)) continue;

      // Generate in background (don't await)
      const generationPromise = this.generateSegment(
        videoPath,
        totalDuration,
        quality,
        nextIndex,
        audioTrack,
        variantPath
      ).catch((err) => {
        console.error(`Prefetch failed for segment ${nextIndex}:`, err);
      });

      this.generatingSegments.set(segmentKey, generationPromise);
      generationPromise.finally(() => {
        this.generatingSegments.delete(segmentKey);
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

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          console.error(`FFmpeg segment generation failed:\n${stderr}`);
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
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

    // Check if original quality is available (native format)
    const ext = path.extname(media.path).toLowerCase();
    const nativeFormat = ['.mp4', '.webm'].includes(ext);
    if (nativeFormat) {
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
    const mediaPath = path.join(this.cachePath, mediaId);
    if (fs.existsSync(mediaPath)) {
      fs.rmSync(mediaPath, { recursive: true, force: true });
      console.log(`Cleaned up HLS cache for media: ${mediaId}`);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalSize: number;
    mediaCount: number;
    segmentCount: number;
  }> {
    let totalSize = 0;
    let mediaCount = 0;
    let segmentCount = 0;

    if (!fs.existsSync(this.cachePath)) {
      return { totalSize, mediaCount, segmentCount };
    }

    const mediaDirs = fs.readdirSync(this.cachePath, { withFileTypes: true });
    for (const mediaDir of mediaDirs) {
      if (!mediaDir.isDirectory()) continue;
      mediaCount++;

      const countFiles = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            countFiles(fullPath);
          } else if (entry.name.endsWith('.ts')) {
            segmentCount++;
            const stat = fs.statSync(fullPath);
            totalSize += stat.size;
          }
        }
      };

      countFiles(path.join(this.cachePath, mediaDir.name));
    }

    return { totalSize, mediaCount, segmentCount };
  }

  /**
   * Clean up old segments based on TTL
   */
  async cleanupOldSegments(ttlHours: number): Promise<number> {
    const cutoffTime = Date.now() - (ttlHours * 60 * 60 * 1000);
    let deletedCount = 0;

    if (!fs.existsSync(this.cachePath)) {
      return deletedCount;
    }

    const cleanupDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let hasFiles = false;

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          cleanupDir(fullPath);
          // Remove empty directories
          try {
            const subEntries = fs.readdirSync(fullPath);
            if (subEntries.length === 0) {
              fs.rmdirSync(fullPath);
            } else {
              hasFiles = true;
            }
          } catch {
            // Ignore errors
          }
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.m3u8')) {
          const stat = fs.statSync(fullPath);
          if (stat.atimeMs < cutoffTime) {
            fs.unlinkSync(fullPath);
            deletedCount++;
          } else {
            hasFiles = true;
          }
        }
      }

      return hasFiles;
    };

    cleanupDir(this.cachePath);
    return deletedCount;
  }
}
