import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getImageStoragePath, getTrickplayConfig, loadAppConfig } from '../config/appConfig';

export interface TrickplayLayout {
  interval: number
  width: number
  columns: number
  rows: number
}

/**
 * Where a media item's sprites live.
 *
 * Not beside the video: a library is often a read-only mount, and sprites are
 * ours rather than the library's. Not in the HLS cache either — that is swept
 * by age and size, and a sprite sheet costs a full decode to rebuild.
 */
export function trickplayRoot(mediaId: string, storageRoot = getImageStoragePath()): string {
  return path.join(storageRoot, 'trickplay', mediaId);
}

/** The folder name the serving route parses: "320 - 10x10". */
export function layoutFolder(layout: TrickplayLayout): string {
  return `${layout.width} - ${layout.columns}x${layout.rows}`;
}

/** Sprites already generated for this media, by layout folder. */
export function hasTrickplay(mediaId: string, storageRoot?: string): boolean {
  const root = trickplayRoot(mediaId, storageRoot);
  if (!fs.existsSync(root)) return false;
  return fs
    .readdirSync(root, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && fs.readdirSync(path.join(root, entry.name)).length > 0);
}

/** Remove a media item's sprites, e.g. when the media itself goes. */
export function removeTrickplay(mediaId: string, storageRoot?: string): void {
  fs.rmSync(trickplayRoot(mediaId, storageRoot), { recursive: true, force: true });
}

export interface TrickplayResult {
  /** The folder to record on `Media.thumbnails`. */
  path: string
  spriteCount: number
  layout: TrickplayLayout
}

/**
 * Generate hover-scrub sprites for one video.
 *
 * One FFmpeg pass samples a frame every `interval` seconds, scales it and
 * packs `columns x rows` of them into each sheet, which is the layout the
 * trickplay routes already read and the player already indexes into. Audio and
 * subtitles are skipped, and the pass is a full decode: this is minutes of CPU
 * for a film, which is why nothing calls it without being asked.
 */
export async function generateTrickplay(options: {
  mediaId: string
  sourcePath: string
  layout?: TrickplayLayout
  storageRoot?: string
  timeoutMs?: number
  signal?: { cancelled: boolean }
}): Promise<TrickplayResult> {
  const layout = options.layout ?? getTrickplayConfig(loadAppConfig());
  const root = trickplayRoot(options.mediaId, options.storageRoot);
  const target = path.join(root, layoutFolder(layout));

  if (!fs.existsSync(options.sourcePath)) {
    throw new Error(`No file at ${options.sourcePath}`);
  }

  // Built somewhere else and moved into place, so a killed run cannot leave a
  // half-finished set that the serving route would happily read.
  const staging = `${target}.building`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  const args = [
    '-i', options.sourcePath,
    '-an', '-sn',
    '-vf', `fps=1/${layout.interval},scale=${layout.width}:-2,tile=${layout.columns}x${layout.rows}`,
    '-qscale:v', '5',
    // The route reads 0.jpg, 1.jpg, ...; FFmpeg counts from one unless told.
    '-start_number', '0',
    path.join(staging, '%d.jpg'),
  ];

  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });

    const timeout = options.timeoutMs
      ? setTimeout(() => ffmpeg.kill('SIGKILL'), options.timeoutMs)
      : undefined;
    const cancelCheck = options.signal
      ? setInterval(() => {
          if (options.signal?.cancelled) ffmpeg.kill('SIGKILL');
        }, 1000)
      : undefined;

    const done = () => {
      if (timeout) clearTimeout(timeout);
      if (cancelCheck) clearInterval(cancelCheck);
    };

    ffmpeg.on('error', (error) => {
      done();
      reject(error);
    });

    ffmpeg.on('close', (code) => {
      done();
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`));
    });
  }).catch((error) => {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  });

  const sprites = fs.readdirSync(staging).filter((name) => /^\d+\.jpg$/.test(name));
  if (sprites.length === 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error('FFmpeg produced no sprites');
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);

  return { path: root, spriteCount: sprites.length, layout };
}
