import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

/**
 * Which subtitle codecs can become WebVTT.
 *
 * The rest — `hdmv_pgs_subtitle`, `dvd_subtitle`, `xsub` — are pictures, and
 * turning a picture into text needs OCR rather than a remux. Offering them
 * gives a viewer a track that produces nothing and says nothing about why.
 */
const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'webvtt',
  'vtt',
  'mov_text',
  'text',
  'stl',
  'subviewer',
  'microdvd',
]);

export function isTextSubtitle(codec: string | null | undefined): boolean {
  if (!codec) return true; // Unknown: let FFmpeg decide rather than hide the track.
  return TEXT_SUBTITLE_CODECS.has(codec.toLowerCase());
}

/** Where an extracted track is kept, beside the segments of the same media. */
export function subtitleCachePath(cacheRoot: string, mediaId: string, streamIndex: number): string {
  // A negative index is a sidecar file; `-` is not a path character worth
  // arguing with.
  const name = streamIndex < 0 ? `ext${Math.abs(streamIndex)}` : `${streamIndex}`;
  return path.join(cacheRoot, mediaId, 'subtitles', `${name}.vtt`);
}

/**
 * Extract one subtitle track as WebVTT, keeping a copy.
 *
 * Extraction reads the container from the start — on a 40 GB remux that is not
 * free, and it happened on every toggle of the subtitle menu. The result is a
 * few kilobytes, so it is cached beside the media's segments and swept with
 * them.
 */
export async function extractSubtitle(options: {
  sourcePath: string
  mapArgs: string[]
  cachePath: string
  timeoutMs?: number
}): Promise<{ path: string } | { error: string }> {
  const { sourcePath, mapArgs, cachePath, timeoutMs = 60_000 } = options;

  if (fs.existsSync(cachePath)) {
    return { path: cachePath };
  }

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  // Written under a temporary name so a killed extraction cannot leave a
  // half-file that later looks like a complete one.
  const tempPath = `${cachePath}.part-${randomUUID().slice(0, 8)}`;

  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', sourcePath,
      ...mapArgs,
      '-c:s', 'webvtt',
      '-f', 'webvtt',
      '-y', tempPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
    }, timeoutMs);

    const fail = (error: string) => {
      clearTimeout(timeout);
      fs.rmSync(tempPath, { force: true });
      resolve({ error });
    };

    ffmpeg.on('error', (error) => fail(error.message));

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.warn(`Subtitle extraction failed for ${sourcePath}:\n${stderr.slice(-500)}`);
        fail('Subtitle extraction failed');
        return;
      }
      try {
        fs.renameSync(tempPath, cachePath);
        resolve({ path: cachePath });
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Could not cache the subtitle');
      }
    });
  });
}
