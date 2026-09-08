import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

/**
 * One AAC encode of a file's audio, shared by every segment of it.
 *
 * A segment is its own FFmpeg run, so when the source audio has to be
 * re-encoded — anything that is not already AAC or MP3, which on this library
 * is most of it — the AAC encoder starts fresh in every segment and its
 * 1024-sample priming delay lands at the head of each one. Measured on a real
 * episode: the first 256 samples of a segment have an RMS of 2 where the source
 * at the same instant has 309, and the segment's audio sits exactly 1024
 * samples (21.33ms) late. That is a dropout at every boundary, once every few
 * seconds, for the whole film.
 *
 * Encoding the track once and copying from it leaves one priming delay at the
 * start of the file instead of one per segment. The same measurement against
 * the same instant then comes out 96 samples (2ms) early, with no silence: the
 * residual is only the AAC frame the cut lands inside.
 *
 * It is not cheap — 2m40s wall, 1m28s of CPU and 62MB for a 45-minute episode
 * on the machine measured — so it is never on the path of a playback request.
 * The first play of a file re-encodes per segment exactly as before and starts
 * this in the background; the play after that is clean.
 */

/** The prepared track for a media item and audio track, beside its variants. */
export function preparedAudioPath(audioTrackDir: string): string {
  return path.join(audioTrackDir, 'audio.mp4');
}

/** Whether a prepared track is there and complete. */
export function hasPreparedAudio(audioTrackDir: string): boolean {
  try {
    return fs.statSync(preparedAudioPath(audioTrackDir)).size > 0;
  } catch {
    return false;
  }
}

export interface PrepareAudioOptions {
  /** The file to read the audio out of. */
  videoPath: string
  /** `default` for the file's first audio stream, or an FFmpeg stream index. */
  audioTrack: string
  /** The `a<audioTrack>` directory the track belongs beside. */
  audioTrackDir: string
  /** kbps, matching what the segments would otherwise have encoded. */
  bitrate: number
}

/**
 * One prepare per destination, however many segments ask for it, and one at a
 * time across the server: this reads a whole file off the same disk that is
 * serving the playback which asked for it.
 */
const inFlight = new Map<string, Promise<boolean>>();
let running = false;
const waiting: Array<() => void> = [];

async function acquire(): Promise<() => void> {
  if (running) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running = true;
  }
  return () => {
    const next = waiting.shift();
    if (next) next();
    else running = false;
  };
}

/**
 * Encode a file's audio to AAC once, unless it is already there or already
 * being encoded. Resolves true if the track is now available.
 */
export function prepareAudio(options: PrepareAudioOptions): Promise<boolean> {
  const target = preparedAudioPath(options.audioTrackDir);
  if (hasPreparedAudio(options.audioTrackDir)) return Promise.resolve(true);

  const existing = inFlight.get(target);
  if (existing) return existing;

  const work = (async () => {
    const release = await acquire();
    try {
      // Somebody else may have finished it while this waited its turn.
      if (hasPreparedAudio(options.audioTrackDir)) return true;
      return await encode(options, target);
    } finally {
      release();
      inFlight.delete(target);
    }
  })();

  inFlight.set(target, work);
  return work;
}

function encode(options: PrepareAudioOptions, target: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(options.audioTrackDir, { recursive: true });
    } catch {
      return resolve(false);
    }

    // Written under a temporary name and renamed only on a clean exit, so a
    // partial encode is never copied into a segment as if it were the track.
    const temp = `${target}.part-${randomUUID().slice(0, 8)}`;
    const stream =
      options.audioTrack === 'default' ? '0:a:0' : `0:${options.audioTrack}`;

    const ffmpeg = spawn('ffmpeg', [
      '-v', 'error',
      '-i', options.videoPath,
      '-map', stream,
      // Nothing but the sound: the picture is the expensive half and the
      // segments copy that straight from the source.
      '-vn', '-sn', '-dn',
      '-c:a', 'aac',
      '-b:a', `${options.bitrate}k`,
      '-ac', '2',
      '-y', temp,
    ]);

    let stderr = '';
    ffmpeg.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const fail = () => {
      fs.rmSync(temp, { force: true });
      resolve(false);
    };

    ffmpeg.on('error', fail);
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.warn(`Could not prepare the audio of ${options.videoPath}:\n${stderr}`);
        return fail();
      }
      try {
        fs.renameSync(temp, target);
        resolve(true);
      } catch (error) {
        console.warn(`Could not store the prepared audio of ${options.videoPath}:`, error);
        fail();
      }
    });
  });
}
