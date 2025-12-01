import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// FFprobe JSON output types
interface FFprobeStream {
  index: number
  codec_name?: string
  codec_long_name?: string
  codec_type: 'video' | 'audio' | 'subtitle' | 'data' | 'attachment'

  // Audio properties
  channels?: number
  channel_layout?: string
  sample_rate?: string
  bit_rate?: string

  // Video properties
  width?: number
  height?: number
  r_frame_rate?: string  // Frame rate as fraction (e.g., "24000/1001")
  avg_frame_rate?: string

  // Tags
  tags?: {
    language?: string
    title?: string
    [key: string]: string | undefined
  }

  // Disposition flags
  disposition?: {
    default?: number
    forced?: number
    [key: string]: number | undefined
  }
}

interface FFprobeFormat {
  duration?: string
  bit_rate?: string
}

interface FFprobeOutput {
  streams?: FFprobeStream[]
  format?: FFprobeFormat
}

// Normalized stream info for our application
export interface StreamInfo {
  streamIndex: number
  streamType: 'Video' | 'Audio' | 'Subtitle'
  codec: string | null
  codecLong: string | null
  language: string | null
  title: string | null
  isDefault: boolean
  isForced: boolean
  // Audio-specific
  channels: number | null
  channelLayout: string | null
  sampleRate: number | null
  bitRate: number | null
  // Video-specific
  width: number | null
  height: number | null
  frameRate: number | null
}

export interface MediaProbeResult {
  duration: number
  streams: StreamInfo[]
}

/**
 * Parse frame rate from FFprobe fraction string (e.g., "24000/1001" -> 23.976)
 */
function parseFrameRate(rateStr: string | undefined): number | null {
  if (!rateStr) return null;

  const parts = rateStr.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    if (den !== 0) {
      return Math.round((num / den) * 1000) / 1000;  // Round to 3 decimal places
    }
  }

  const parsed = parseFloat(rateStr);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Map FFprobe codec_type to our StreamType
 */
function mapCodecType(codecType: string): 'Video' | 'Audio' | 'Subtitle' | null {
  switch (codecType) {
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'subtitle':
      return 'Subtitle';
    default:
      return null;
  }
}

/**
 * Probe a media file using ffprobe to extract duration and stream information
 */
export async function probeMediaFile(filePath: string): Promise<MediaProbeResult> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);

    const data: FFprobeOutput = JSON.parse(stdout);

    // Extract duration
    const duration = data.format?.duration
      ? Math.round(parseFloat(data.format.duration))
      : 0;

    // Extract streams
    const streams: StreamInfo[] = [];

    for (const stream of data.streams ?? []) {
      const streamType = mapCodecType(stream.codec_type);

      // Skip unsupported stream types (data, attachment, etc.)
      if (!streamType) continue;

      const streamInfo: StreamInfo = {
        streamIndex: stream.index,
        streamType,
        codec: stream.codec_name ?? null,
        codecLong: stream.codec_long_name ?? null,
        language: stream.tags?.language ?? null,
        title: stream.tags?.title ?? null,
        isDefault: stream.disposition?.default === 1,
        isForced: stream.disposition?.forced === 1,
        // Audio properties
        channels: stream.channels ?? null,
        channelLayout: stream.channel_layout ?? null,
        sampleRate: stream.sample_rate ? parseInt(stream.sample_rate, 10) : null,
        bitRate: stream.bit_rate ? parseInt(stream.bit_rate, 10) : null,
        // Video properties
        width: stream.width ?? null,
        height: stream.height ?? null,
        frameRate: parseFrameRate(stream.r_frame_rate) ?? parseFrameRate(stream.avg_frame_rate),
      };

      streams.push(streamInfo);
    }

    return { duration, streams };
  } catch (error) {
    console.error(`Failed to probe media file ${filePath}:`, error);
    return { duration: 0, streams: [] };
  }
}

/**
 * Get just the duration of a media file (legacy function for compatibility)
 */
export async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch (error) {
    console.error(`Failed to get duration for ${filePath}:`, error);
    return 0;
  }
}
