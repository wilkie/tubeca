import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
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

/** The file that says what a set of sheets actually is. */
export const MANIFEST_NAME = 'manifest.json';

export interface TrickplayManifest {
  /** Seconds between frames. */
  interval: number
  width: number
  columns: number
  rows: number
  /** One tile, in pixels; recorded so the info route need not open a sheet. */
  tileWidth: number
  tileHeight: number
  spriteCount: number
}

/**
 * What a set of sheets is, from the file written beside them.
 *
 * Sheets that came with the library have no manifest — nothing wrote one — so
 * this returns null and the caller falls back to what it has always assumed.
 */
export function readManifest(folder: string): TrickplayManifest | null {
  try {
    const raw = fs.readFileSync(path.join(folder, MANIFEST_NAME), 'utf8');
    const parsed = JSON.parse(raw) as Partial<TrickplayManifest>;
    const numbers = [parsed.interval, parsed.width, parsed.columns, parsed.rows];
    if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      return null;
    }
    return parsed as TrickplayManifest;
  } catch {
    // Absent, unreadable, or not ours: the caller has a fallback.
    return null;
  }
}

const isSprite = (name: string) => /^\d+\.jpg$/.test(name);

/** Sprites already generated for this media, by layout folder. */
export function hasTrickplay(mediaId: string, storageRoot?: string): boolean {
  const root = trickplayRoot(mediaId, storageRoot);
  if (!fs.existsSync(root)) return false;
  return fs
    .readdirSync(root, { withFileTypes: true })
    .some(
      (entry) =>
        entry.isDirectory() && fs.readdirSync(path.join(root, entry.name)).some(isSprite)
    );
}

/** Remove a media item's sprites, e.g. when the media itself goes. */
export function removeTrickplay(mediaId: string, storageRoot?: string): void {
  fs.rmSync(trickplayRoot(mediaId, storageRoot), { recursive: true, force: true });
}

const byNumber = (a: string, b: string) => parseInt(a, 10) - parseInt(b, 10);

/**
 * One tile's size, measured from a sheet.
 *
 * FFmpeg pads a partial final sheet to the full grid, so any sheet divides
 * evenly; the first is measured because it is certainly complete.
 */
async function tileSize(
  spritePath: string,
  layout: TrickplayLayout
): Promise<{ tileWidth: number; tileHeight: number }> {
  try {
    const metadata = await sharp(spritePath).metadata();
    if (metadata.width && metadata.height) {
      return {
        tileWidth: Math.floor(metadata.width / layout.columns),
        tileHeight: Math.floor(metadata.height / layout.rows),
      };
    }
  } catch {
    // Fall through to the shape we asked FFmpeg for.
  }
  return { tileWidth: layout.width, tileHeight: Math.round((layout.width * 9) / 16) };
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

  const sprites = fs.readdirSync(staging).filter(isSprite);
  if (sprites.length === 0) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error('FFmpeg produced no sprites');
  }

  // What these sheets are, written beside them. Without it the serving route
  // has to assume an interval, and a preview lands at the wrong moment for any
  // interval but the one it assumed.
  const manifest: TrickplayManifest = {
    interval: layout.interval,
    width: layout.width,
    columns: layout.columns,
    rows: layout.rows,
    ...(await tileSize(path.join(staging, sprites.sort(byNumber)[0]), layout)),
    spriteCount: sprites.length,
  };
  fs.writeFileSync(path.join(staging, MANIFEST_NAME), JSON.stringify(manifest, null, 2));

  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);

  return { path: root, spriteCount: sprites.length, layout };
}
