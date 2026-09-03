import { prisma } from '../config/database';
import type { TranscodingSettings } from '@prisma/client';
import {
  detectBestEncoderAsync,
  listEncoderOptions,
  resolvePreferredEncoder,
  SOFTWARE_ENCODER,
  type HardwareEncoder,
} from '../utils/hwaccel';
import { getHlsCachePath } from '../config/appConfig';
import { purgeAllSegments } from './hlsCache';

export interface TranscodingSettingsData {
  enableHardwareAccel: boolean;
  preferredEncoder: string | null;
  preset: string;
  enableLowLatency: boolean;
  threadCount: number;
  maxConcurrentTranscodes: number;
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
  /** Every encoder an admin may pin, whether or not this machine can run it. */
  availableEncoders: HardwareEncoder[];
}

// Available FFmpeg presets (fastest to slowest)
const AVAILABLE_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'];

// Cache for settings to avoid repeated DB queries
let settingsCache: TranscodingSettings | null = null;
let cacheTimestamp = 0;
// Bumped whenever settings change so other caches (HlsService) can invalidate immediately.
let settingsVersion = 0;
export function getTranscodingSettingsVersion(): number {
  return settingsVersion;
}
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
  const detectedEncoder = await detectBestEncoderAsync();

  // Determine active encoder based on settings
  let activeEncoder = detectedEncoder;
  if (!settings.enableHardwareAccel && detectedEncoder.type === 'hardware') {
    // Hardware disabled, fall back to software
    activeEncoder = SOFTWARE_ENCODER;
  } else if (settings.preferredEncoder && settings.preferredEncoder !== detectedEncoder.encoder) {
    const preferred = await resolvePreferredEncoder(settings.preferredEncoder);
    if (preferred) activeEncoder = preferred;
  }

  return {
    id: settings.id,
    enableHardwareAccel: settings.enableHardwareAccel,
    preferredEncoder: settings.preferredEncoder,
    preset: settings.preset,
    enableLowLatency: settings.enableLowLatency,
    threadCount: settings.threadCount,
    maxConcurrentTranscodes: settings.maxConcurrentTranscodes,
    segmentDuration: settings.segmentDuration,
    prefetchSegments: settings.prefetchSegments,
    bitrate1080p: settings.bitrate1080p,
    bitrate720p: settings.bitrate720p,
    bitrate480p: settings.bitrate480p,
    bitrate360p: settings.bitrate360p,
    detectedEncoder,
    activeEncoder,
    availablePresets: AVAILABLE_PRESETS,
    availableEncoders: listEncoderOptions(),
  };
}

/** A rejected field and why, for a 400 response. */
export interface SettingsValidationError {
  field: string
  message: string
}

interface NumericBound {
  min: number
  max: number
  unit?: string
}

const NUMERIC_BOUNDS: Record<string, NumericBound> = {
  threadCount: { min: 0, max: 64 },
  maxConcurrentTranscodes: { min: 1, max: 16 },
  segmentDuration: { min: 1, max: 30, unit: 'seconds' },
  prefetchSegments: { min: 0, max: 10 },
  bitrate1080p: { min: 100, max: 100000, unit: 'kbps' },
  bitrate720p: { min: 100, max: 100000, unit: 'kbps' },
  bitrate480p: { min: 100, max: 100000, unit: 'kbps' },
  bitrate360p: { min: 100, max: 100000, unit: 'kbps' },
};

const BOOLEAN_FIELDS = ['enableHardwareAccel', 'enableLowLatency'] as const;

/**
 * Check an incoming settings body and return only the fields it may change.
 *
 * These values go straight into FFmpeg arguments and playlist arithmetic, so a
 * string where a number belongs, or a negative segment duration, would produce
 * a library that will not play rather than an error at the point of the
 * mistake. Unknown fields are ignored; absent fields are left as they are.
 */
export function validateTranscodingSettings(body: unknown): {
  data: Partial<TranscodingSettingsData>
  errors: SettingsValidationError[]
} {
  const errors: SettingsValidationError[] = [];
  const data: Partial<TranscodingSettingsData> = {};
  const input = (body ?? {}) as Record<string, unknown>;

  for (const field of BOOLEAN_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      errors.push({ field, message: 'must be true or false' });
      continue;
    }
    data[field] = value;
  }

  for (const [field, bound] of Object.entries(NUMERIC_BOUNDS)) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < bound.min || value > bound.max) {
      const unit = bound.unit ? ` ${bound.unit}` : '';
      errors.push({ field, message: `must be a whole number between ${bound.min} and ${bound.max}${unit}` });
      continue;
    }
    (data as Record<string, number>)[field] = value;
  }

  if (input.preset !== undefined) {
    if (typeof input.preset !== 'string' || !AVAILABLE_PRESETS.includes(input.preset)) {
      errors.push({ field: 'preset', message: `must be one of: ${AVAILABLE_PRESETS.join(', ')}` });
    } else {
      data.preset = input.preset;
    }
  }

  if (input.preferredEncoder !== undefined) {
    const value = input.preferredEncoder;
    // An empty choice means "let detection decide".
    if (value === null || value === '') {
      data.preferredEncoder = null;
    } else if (typeof value !== 'string' || !listEncoderOptions().some((o) => o.encoder === value)) {
      errors.push({
        field: 'preferredEncoder',
        message: `must be null or one of: ${listEncoderOptions().map((o) => o.encoder).join(', ')}`,
      });
    } else {
      data.preferredEncoder = value;
    }
  }

  return { data, errors };
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
      ...(data.maxConcurrentTranscodes !== undefined && { maxConcurrentTranscodes: data.maxConcurrentTranscodes }),
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
  settingsVersion++;

  // Playlists are computed from the segment duration, so every cached segment
  // now covers the wrong span of the timeline. Drop them rather than serve a
  // playlist whose segments do not line up with it.
  if (data.segmentDuration !== undefined && data.segmentDuration !== settings.segmentDuration) {
    const purged = purgeAllSegments(getHlsCachePath());
    console.log(
      `🧹 Segment duration changed ${settings.segmentDuration}s → ${data.segmentDuration}s; purged ${purged} cached segment(s)`
    );
  }

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
  settingsVersion++;
}
