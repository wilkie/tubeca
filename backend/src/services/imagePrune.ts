import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../config/database';
import { getImageStoragePath } from '../config/appConfig';
import { IMAGE_SIZES } from './imageService';

/**
 * Files in the image store that no `Image` row points at.
 *
 * Two things create them. A format change — a provider that served
 * `poster.jpg` and now serves `poster.png` writes a second file and the row
 * moves to it — and any deletion that removed rows without their files, which
 * `ContentDeletionService` now handles but older versions did not. Neither is
 * caught by anything else, so the store only grows.
 */

export interface OrphanReport {
  /** Paths relative to the image store */
  orphans: string[]
  /** Total bytes those files occupy */
  bytes: number
  /** How many files were examined */
  scanned: number
}

/**
 * Strip a size suffix, if the file is a generated variant.
 *
 * `getSizedPath` writes `poster-w400.jpg` beside `poster.jpg`, and no row
 * points at the variant. Treating one as an orphan would delete the whole
 * resize cache on every run — they would come back, but the sweep would report
 * thousands of orphans and throw away work for nothing.
 */
export function originalOf(relativePath: string): string {
  const extension = path.extname(relativePath);
  const withoutExtension = relativePath.slice(0, -extension.length || undefined);
  const lastDash = withoutExtension.lastIndexOf('-');
  if (lastDash === -1) return relativePath;

  const suffix = withoutExtension.slice(lastDash + 1);
  return suffix in IMAGE_SIZES ? `${withoutExtension.slice(0, lastDash)}${extension}` : relativePath;
}

/** Every file under `root`, as paths relative to it. */
function walk(root: string, current = root, found: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walk(root, full, found);
    else found.push(path.relative(root, full));
  }
  return found;
}

/**
 * Find the files nothing points at. Nothing is removed; `removeOrphans` does
 * that, so an admin can see the list first.
 */
export async function findOrphans(storageRoot = getImageStoragePath()): Promise<OrphanReport> {
  const rows = await prisma.image.findMany({ select: { path: true } });
  const known = new Set(rows.map((row) => row.path).filter(Boolean));

  const files = walk(storageRoot);
  const orphans: string[] = [];
  let bytes = 0;

  for (const file of files) {
    if (known.has(file) || known.has(originalOf(file))) continue;
    orphans.push(file);
    try {
      bytes += fs.statSync(path.join(storageRoot, file)).size;
    } catch {
      // Gone between the walk and the stat
    }
  }

  return { orphans, bytes, scanned: files.length };
}

/** Delete the given files from the store. Returns how many actually went. */
export function removeOrphans(orphans: string[], storageRoot = getImageStoragePath()): number {
  let removed = 0;
  for (const relative of orphans) {
    // A path from outside the store is not ours to delete, however it got here.
    const absolute = path.resolve(storageRoot, relative);
    if (!absolute.startsWith(path.resolve(storageRoot) + path.sep)) continue;
    try {
      // `unlink` rather than `rm({ force: true })`: a file already gone should
      // not be counted, or the number reported back means nothing.
      fs.unlinkSync(absolute);
      removed++;
    } catch {
      // Already gone, or not ours to remove
    }
  }
  return removed;
}
