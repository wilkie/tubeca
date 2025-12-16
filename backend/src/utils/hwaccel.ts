import { execSync } from 'child_process';

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

// Cache the detected encoder
let detectedEncoder: HardwareEncoder | null = null;
let detectionDone = false;

/**
 * Get list of available H.264 encoders from FFmpeg
 */
function getAvailableEncoders(): Set<string> {
  try {
    const output = execSync('ffmpeg -encoders 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const encoders = new Set<string>();
    const lines = output.split('\n');

    for (const line of lines) {
      // Encoder lines look like: " V..... libx264 ..."
      const match = line.match(/^\s*V[\w.]+\s+(\w+)/);
      if (match) {
        encoders.add(match[1]);
      }
    }

    return encoders;
  } catch {
    console.warn('Failed to query FFmpeg encoders, falling back to libx264');
    return new Set(['libx264']);
  }
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
    // Try to encode a tiny test frame
    // Use lavfi to generate a test pattern, encode 1 frame
    const cmd = `ffmpeg -f lavfi -i color=black:s=64x64:d=0.1 -c:v ${encoder} -frames:v 1 -f null - 2>&1`;
    execSync(cmd, { timeout: 10000, encoding: 'utf-8' });
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
        '-bufsize', `${bufsize}k`
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

  // Scale filter (works with all encoders)
  args.push(
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
  );

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
