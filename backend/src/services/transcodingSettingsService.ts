import { prisma } from '../config/database';
import type { TranscodingSettings } from '@prisma/client';
import { detectBestEncoder, type HardwareEncoder } from '../utils/hwaccel';

export interface TranscodingSettingsData {
  enableHardwareAccel: boolean;
  preferredEncoder: string | null;
  preset: string;
  enableLowLatency: boolean;
  threadCount: number;
  segmentDuration: number;
  prefetchSegments: number;
  bitrate1080p: number;
  bitrate720p: number;
  bitrate480p: number;
  bitrate360p: number;
}

export interface TranscodingSettingsWithInfo extends TranscodingSettingsData {
  id: string;
  detectedEncoder: HardwareEncoder;
  activeEncoder: HardwareEncoder;
  availablePresets: string[];
}

// Available FFmpeg presets (fastest to slowest)
const AVAILABLE_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'];

// Cache for settings to avoid repeated DB queries
let settingsCache: TranscodingSettings | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 seconds

/**
 * Get transcoding settings, creating default if not exists
 */
export async function getTranscodingSettings(): Promise<TranscodingSettings> {
  // Check cache
  if (settingsCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return settingsCache;
  }

  // Try to find existing settings
  let settings = await prisma.transcodingSettings.findFirst();

  // Create default if not exists
  if (!settings) {
    settings = await prisma.transcodingSettings.create({
      data: {},
    });
  }

  // Update cache
  settingsCache = settings;
  cacheTimestamp = Date.now();

  return settings;
}

/**
 * Get transcoding settings with additional runtime info
 */
export async function getTranscodingSettingsWithInfo(): Promise<TranscodingSettingsWithInfo> {
  const settings = await getTranscodingSettings();
  const detectedEncoder = detectBestEncoder();

  // Determine active encoder based on settings
  let activeEncoder = detectedEncoder;
  if (!settings.enableHardwareAccel && detectedEncoder.type === 'hardware') {
    // Hardware disabled, fall back to software
    activeEncoder = {
      name: 'x264 (Software)',
      encoder: 'libx264',
      type: 'software',
      priority: 100,
    };
  }

  return {
    id: settings.id,
    enableHardwareAccel: settings.enableHardwareAccel,
    preferredEncoder: settings.preferredEncoder,
    preset: settings.preset,
    enableLowLatency: settings.enableLowLatency,
    threadCount: settings.threadCount,
    segmentDuration: settings.segmentDuration,
    prefetchSegments: settings.prefetchSegments,
    bitrate1080p: settings.bitrate1080p,
    bitrate720p: settings.bitrate720p,
    bitrate480p: settings.bitrate480p,
    bitrate360p: settings.bitrate360p,
    detectedEncoder,
    activeEncoder,
    availablePresets: AVAILABLE_PRESETS,
  };
}

/**
 * Update transcoding settings
 */
export async function updateTranscodingSettings(
  data: Partial<TranscodingSettingsData>
): Promise<TranscodingSettings> {
  const settings = await getTranscodingSettings();

  const updated = await prisma.transcodingSettings.update({
    where: { id: settings.id },
    data: {
      ...(data.enableHardwareAccel !== undefined && { enableHardwareAccel: data.enableHardwareAccel }),
      ...(data.preferredEncoder !== undefined && { preferredEncoder: data.preferredEncoder }),
      ...(data.preset !== undefined && { preset: data.preset }),
      ...(data.enableLowLatency !== undefined && { enableLowLatency: data.enableLowLatency }),
      ...(data.threadCount !== undefined && { threadCount: data.threadCount }),
      ...(data.segmentDuration !== undefined && { segmentDuration: data.segmentDuration }),
      ...(data.prefetchSegments !== undefined && { prefetchSegments: data.prefetchSegments }),
      ...(data.bitrate1080p !== undefined && { bitrate1080p: data.bitrate1080p }),
      ...(data.bitrate720p !== undefined && { bitrate720p: data.bitrate720p }),
      ...(data.bitrate480p !== undefined && { bitrate480p: data.bitrate480p }),
      ...(data.bitrate360p !== undefined && { bitrate360p: data.bitrate360p }),
    },
  });

  // Invalidate cache
  settingsCache = null;

  return updated;
}

/**
 * Get quality presets with configured bitrates
 */
export async function getQualityPresets(): Promise<Record<string, { videoBitrate: number; audioBitrate: number }>> {
  const settings = await getTranscodingSettings();

  return {
    '1080p': { videoBitrate: settings.bitrate1080p, audioBitrate: 192 },
    '720p': { videoBitrate: settings.bitrate720p, audioBitrate: 128 },
    '480p': { videoBitrate: settings.bitrate480p, audioBitrate: 128 },
    '360p': { videoBitrate: settings.bitrate360p, audioBitrate: 96 },
  };
}

/**
 * Invalidate the settings cache (call when settings are updated externally)
 */
export function invalidateSettingsCache(): void {
  settingsCache = null;
}
