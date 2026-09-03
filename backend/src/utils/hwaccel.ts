import { execFile, execSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Render node used for VAAPI. Overridable because a box with two GPUs, or one
 * where the render node is not the first, needs a different path.
 */
export const VAAPI_DEVICE = process.env.TUBECA_VAAPI_DEVICE || '/dev/dri/renderD128';

export interface HardwareEncoder {
  name: string;
  encoder: string;
  type: 'hardware' | 'software';
  priority: number; // Lower is better
}

// Encoder options in priority order (lower number = higher priority)
const ENCODER_OPTIONS: HardwareEncoder[] = [
  { name: 'NVIDIA NVENC', encoder: 'h264_nvenc', type: 'hardware', priority: 1 },
  { name: 'Intel Quick Sync', encoder: 'h264_qsv', type: 'hardware', priority: 2 },
  { name: 'AMD VCE', encoder: 'h264_amf', type: 'hardware', priority: 3 },
  { name: 'VAAPI', encoder: 'h264_vaapi', type: 'hardware', priority: 4 },
  { name: 'VideoToolbox', encoder: 'h264_videotoolbox', type: 'hardware', priority: 5 },
  { name: 'x264 (Software)', encoder: 'libx264', type: 'software', priority: 100 },
];

/** The always-available fallback, used whenever hardware is off or unusable. */
export const SOFTWARE_ENCODER: HardwareEncoder = {
  name: 'x264 (Software)',
  encoder: 'libx264',
  type: 'software',
  priority: 100,
};

// Cache the detected encoder
let detectedEncoder: HardwareEncoder | null = null;
let detectionDone = false;
let detectionInFlight: Promise<HardwareEncoder> | null = null;

/** Parse the encoder table `ffmpeg -encoders` prints. */
export function parseEncoderList(output: string): Set<string> {
  const encoders = new Set<string>();
  for (const line of output.split('\n')) {
    // Encoder lines look like: " V..... libx264 ..."
    const match = line.match(/^\s*V[\w.]+\s+(\w+)/);
    if (match) {
      encoders.add(match[1]);
    }
  }
  return encoders;
}

/**
 * Get list of available H.264 encoders from FFmpeg
 */
function getAvailableEncoders(): Set<string> {
  try {
    const output = execSync('ffmpeg -encoders 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return parseEncoderList(output);
  } catch {
    console.warn('Failed to query FFmpeg encoders, falling back to libx264');
    return new Set(['libx264']);
  }
}

/**
 * FFmpeg arguments for a one-frame test encode with this encoder.
 *
 * Built from the same helpers the real encodes use, so an encoder that passes
 * the test is one whose full argument set works: VAAPI in particular fails
 * without its device and upload filter, and used to be rejected for that
 * reason rather than for a missing GPU.
 */
export function testEncodeArgs(encoder: string): string[] {
  const candidate = ENCODER_OPTIONS.find((o) => o.encoder === encoder) ?? {
    name: encoder,
    encoder,
    type: 'hardware' as const,
    priority: 50,
  };
  return [
    ...getEncoderInputArgs(candidate),
    '-f', 'lavfi',
    '-i', 'color=black:s=64x64:d=0.1',
    ...getEncoderArgs(candidate, 500, 64, 64),
    '-frames:v', '1',
    '-f', 'null',
    '-',
  ];
}

/**
 * Test if a hardware encoder actually works
 * Some encoders may be listed but fail without proper hardware/drivers
 */
function testEncoder(encoder: string): boolean {
  if (encoder === 'libx264') {
    // Software encoder always works
    return true;
  }

  try {
    execSync(`ffmpeg ${testEncodeArgs(encoder).join(' ')} 2>&1`, { timeout: 10000, encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** Async twin of `testEncoder`, so detection can run off the event loop. */
async function testEncoderAsync(encoder: string): Promise<boolean> {
  if (encoder === 'libx264') return true;
  try {
    await execFileAsync('ffmpeg', testEncodeArgs(encoder), { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the best available H.264 encoder
 * Checks for hardware encoders first, falls back to software
 */
export function detectBestEncoder(): HardwareEncoder {
  if (detectionDone && detectedEncoder) {
    return detectedEncoder;
  }

  console.log('🔍 Detecting available video encoders...');
  const availableEncoders = getAvailableEncoders();

  // Sort by priority and find first working encoder
  const sortedOptions = [...ENCODER_OPTIONS].sort((a, b) => a.priority - b.priority);

  for (const option of sortedOptions) {
    if (availableEncoders.has(option.encoder)) {
      console.log(`  Checking ${option.name} (${option.encoder})...`);
      if (testEncoder(option.encoder)) {
        console.log(`✅ Using ${option.name} (${option.encoder})`);
        detectedEncoder = option;
        detectionDone = true;
        return option;
      } else {
        console.log(`  ❌ ${option.name} not functional`);
      }
    }
  }

  // Fallback to libx264 (should always work)
  console.log('⚠️ No hardware encoder available, using software encoding (libx264)');
  detectedEncoder = ENCODER_OPTIONS.find(e => e.encoder === 'libx264')!;
  detectionDone = true;
  return detectedEncoder;
}

/**
 * Detect the best available encoder without blocking the event loop.
 *
 * Same result as `detectBestEncoder`, sharing the same one-shot cache, but it
 * spawns FFmpeg asynchronously. The server calls this once it is listening so
 * boot is not held up by up to five 10 s test encodes. Concurrent callers
 * share one detection run.
 */
export async function detectBestEncoderAsync(): Promise<HardwareEncoder> {
  if (detectionDone && detectedEncoder) {
    return detectedEncoder;
  }
  if (detectionInFlight) {
    return detectionInFlight;
  }

  detectionInFlight = (async () => {
    console.log('🔍 Detecting available video encoders...');
    let available: Set<string>;
    try {
      const { stdout } = await execFileAsync('ffmpeg', ['-encoders'], { timeout: 5000 });
      available = parseEncoderList(stdout);
    } catch {
      console.warn('Failed to query FFmpeg encoders, falling back to libx264');
      available = new Set(['libx264']);
    }

    const sortedOptions = [...ENCODER_OPTIONS].sort((a, b) => a.priority - b.priority);
    for (const option of sortedOptions) {
      if (!available.has(option.encoder)) continue;
      console.log(`  Checking ${option.name} (${option.encoder})...`);
      if (await testEncoderAsync(option.encoder)) {
        console.log(`✅ Using ${option.name} (${option.encoder})`);
        return option;
      }
      console.log(`  ❌ ${option.name} not functional`);
    }

    console.log('⚠️ No hardware encoder available, using software encoding (libx264)');
    return ENCODER_OPTIONS.find((e) => e.encoder === 'libx264')!;
  })()
    .then((encoder) => {
      detectedEncoder = encoder;
      detectionDone = true;
      return encoder;
    })
    .finally(() => {
      detectionInFlight = null;
    });

  return detectionInFlight;
}

/** Encoder ids an admin may choose between, in preference order. */
export function listEncoderOptions(): HardwareEncoder[] {
  return [...ENCODER_OPTIONS].sort((a, b) => a.priority - b.priority);
}

/** Verified results for admin-chosen encoders, so each is tested at most once. */
const verifiedEncoders = new Map<string, HardwareEncoder | null>();

/**
 * Resolve an admin's chosen encoder, or null when this machine cannot run it.
 *
 * A stored preference can outlive the hardware it was set for (a moved disk, a
 * dropped GPU), so the choice is confirmed with the same one-frame test encode
 * detection uses before any real work is handed to it.
 */
export async function resolvePreferredEncoder(encoderId: string): Promise<HardwareEncoder | null> {
  const cached = verifiedEncoders.get(encoderId);
  if (cached !== undefined) return cached;

  const option = ENCODER_OPTIONS.find((o) => o.encoder === encoderId) ?? null;
  const verified = option && (await testEncoderAsync(option.encoder)) ? option : null;
  verifiedEncoders.set(encoderId, verified);
  if (!verified) {
    console.warn(`⚠️ Preferred encoder '${encoderId}' is not usable here; using the detected encoder instead`);
  }
  return verified;
}

/**
 * Arguments that must appear before `-i`.
 *
 * VAAPI needs its render node opened before the filter graph can upload
 * frames to it; every other encoder needs nothing here.
 */
export function getEncoderInputArgs(encoder: HardwareEncoder): string[] {
  if (encoder.encoder === 'h264_vaapi') {
    return ['-vaapi_device', VAAPI_DEVICE];
  }
  return [];
}

/**
 * Get FFmpeg arguments for the detected encoder
 */
export function getEncoderArgs(
  encoder: HardwareEncoder,
  videoBitrate: number,
  width: number,
  height: number
): string[] {
  const args: string[] = [];

  // Common rate control settings
  const maxrate = Math.round(videoBitrate * 1.5);
  const bufsize = videoBitrate * 2;

  switch (encoder.encoder) {
    case 'h264_nvenc':
      args.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p4',  // Balanced preset (p1=fastest, p7=slowest)
        '-tune', 'hq',
        '-rc', 'vbr',
        '-b:v', `${videoBitrate}k`,
        '-maxrate', `${maxrate}k`,
        '-bufsize', `${bufsize}k`,
        '-profile:v', 'high',
        '-level', '4.1'
      );
      break;

    case 'h264_qsv':
      args.push(
        '-c:v', 'h264_qsv',
        '-preset', 'faster',
        '-b:v', `${videoBitrate}k`,
        '-maxrate', `${maxrate}k`,
        '-bufsize', `${bufsize}k`,
        '-profile:v', 'high'
      );
      break;

    case 'h264_amf':
      args.push(
        '-c:v', 'h264_amf',
        '-quality', 'balanced',
        '-rc', 'vbr_peak',
        '-b:v', `${videoBitrate}k`,
        '-maxrate', `${maxrate}k`,
        '-bufsize', `${bufsize}k`
      );
      break;

    case 'h264_vaapi':
      args.push(
        '-c:v', 'h264_vaapi',
        '-b:v', `${videoBitrate}k`,
        '-maxrate', `${maxrate}k`,
        '-bufsize', `${bufsize}k`,
        '-profile:v', 'high'
      );
      break;

    case 'h264_videotoolbox':
      args.push(
        '-c:v', 'h264_videotoolbox',
        '-b:v', `${videoBitrate}k`,
        '-maxrate', `${maxrate}k`,
        '-bufsize', `${bufsize}k`,
        '-profile:v', 'high'
      );
      break;

    case 'libx264':
    default:
      args.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',  // Much faster than 'fast', still good quality
        '-tune', 'zerolatency', // Optimized for streaming
        '-b:v', `${videoBitrate}k`,
        '-maxrate', `${maxrate}k`,
        '-bufsize', `${bufsize}k`,
        '-profile:v', 'high',
        '-level', '4.1',
        // Threading optimization
        '-threads', '0',  // Auto-detect threads
        '-x264-params', 'threads=auto:sliced-threads=1'
      );
      break;
  }

  // Scale and letterbox in software, which every encoder can take as input.
  let filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;

  // VAAPI encodes from GPU memory, so the scaled frames have to be converted
  // to a format it accepts and uploaded. Without this the encoder errors out,
  // which is why VAAPI-only machines used to fall back to software.
  if (encoder.encoder === 'h264_vaapi') {
    filter += ',format=nv12,hwupload';
  }

  args.push('-vf', filter);

  return args;
}

/**
 * Get the cached encoder or detect if not yet done
 */
export function getEncoder(): HardwareEncoder {
  if (!detectionDone) {
    return detectBestEncoder();
  }
  return detectedEncoder!;
}

/**
 * Check if hardware acceleration is being used
 */
export function isHardwareAccelerated(): boolean {
  const encoder = getEncoder();
  return encoder.type === 'hardware';
}
