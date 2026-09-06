import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../config/database';
import { getImageStoragePath } from '../config/appConfig';
import { evictMediaCache } from './hlsCache';
import { searchIndexService } from './searchIndexService';
import { removeTrickplay } from './trickplayService';
import { collectInChunks, inChunks } from '../utils/chunk';

/**
 * Remove an image file (and its directory if that leaves it empty). Errors are
 * logged, never thrown: a missing file must not block a delete.
 */
export function deleteImageFile(imageStoragePath: string, imagePath: string): void {
  try {
    const fullPath = path.join(imageStoragePath, imagePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      const parentDir = path.dirname(fullPath);
      if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
        fs.rmdirSync(parentDir);
      }
    }
  } catch (error) {
    console.warn(`Failed to delete image file: ${imagePath}`, error);
  }
}

/**
 * Deletes content together with the artwork files it owns. The database
 * cascades take care of rows; this service exists because `Image.path` files
 * on disk are not covered by any cascade, and because `Media.collectionId` is
 * `SetNull` on collection delete, so media must be removed explicitly or it
 * survives as an orphan.
 */
export class ContentDeletionService {
  constructor(private readonly imageStoragePath?: string) {}

  private get storageRoot(): string {
    return this.imageStoragePath ?? getImageStoragePath();
  }

  /** A collection id plus every descendant id, breadth first. */
  async collectTreeIds(rootId: string): Promise<string[]> {
    const ids = [rootId];
    let frontier = [rootId];
    while (frontier.length > 0) {
      // A tree one level wide — every show under one root — is more ids than
      // SQLite will bind, even though the depth is small.
      const children = await collectInChunks(frontier, (batch) =>
        prisma.collection.findMany({ where: { parentId: { in: batch } }, select: { id: true } })
      );
      frontier = children.map((c) => c.id);
      ids.push(...frontier);
    }
    return ids;
  }

  /**
   * Relative paths of every image owned by these collections/media or their
   * credits. Deleting a library passes every id it owns, which is far more than
   * SQLite will bind, so each half is asked for in chunks.
   */
  async imagePathsFor(collectionIds: string[], mediaIds: string[]): Promise<string[]> {
    const byCollection = await collectInChunks(collectionIds, (batch) =>
      prisma.image.findMany({
        where: {
          OR: [
            { collectionId: { in: batch } },
            { showCredit: { showDetails: { collectionId: { in: batch } } } },
            { filmCredit: { filmDetails: { collectionId: { in: batch } } } },
          ],
        },
        select: { path: true },
      })
    );
    const byMedia = await collectInChunks(mediaIds, (batch) =>
      prisma.image.findMany({
        where: {
          OR: [
            { mediaId: { in: batch } },
            { credit: { videoDetails: { mediaId: { in: batch } } } },
          ],
        },
        select: { path: true },
      })
    );
    // The two halves can name the same file, since a credit belongs to both.
    return [...new Set([...byCollection, ...byMedia].map((i) => i.path))];
  }

  /**
   * Delete every image row for a collection, and its file on disk.
   *
   * Used by Identify, which throws the old title's artwork away so the new
   * one is downloaded. The rows used to be deleted on their own, leaving the
   * files behind with nothing pointing at them.
   */
  async deleteCollectionImages(collectionId: string): Promise<number> {
    const files = await this.imagePathsFor([collectionId], []);
    for (const file of files) deleteImageFile(this.storageRoot, file);

    const removed = await prisma.image.deleteMany({ where: { collectionId } });
    return removed.count;
  }

  /** Delete one media row and its artwork files. Returns false if it did not exist. */
  async deleteMedia(mediaId: string): Promise<boolean> {
    const exists = await prisma.media.findUnique({ where: { id: mediaId }, select: { id: true } });
    if (!exists) return false;
    const files = await this.imagePathsFor([], [mediaId]);
    for (const file of files) deleteImageFile(this.storageRoot, file);
    evictMediaCache(mediaId);
    // Generated preview sprites are ours, and nothing else refers to them.
    removeTrickplay(mediaId, this.storageRoot);
    await prisma.media.delete({ where: { id: mediaId } });
    await searchIndexService.remove(mediaId);
    return true;
  }

  /**
   * Delete a collection, all descendant collections, every media item inside
   * the tree, and all of their artwork files. Returns what was removed.
   */
  async deleteCollectionTree(rootId: string): Promise<{ collections: number; media: number } | null> {
    const exists = await prisma.collection.findUnique({ where: { id: rootId }, select: { id: true } });
    if (!exists) return null;

    const collectionIds = await this.collectTreeIds(rootId);
    const media = await collectInChunks(collectionIds, (batch) =>
      prisma.media.findMany({ where: { collectionId: { in: batch } }, select: { id: true } })
    );
    const mediaIds = media.map((m) => m.id);

    const files = await this.imagePathsFor(collectionIds, mediaIds);
    for (const file of files) deleteImageFile(this.storageRoot, file);
    for (const id of mediaIds) evictMediaCache(id);

    // Not one transaction any more: a library's worth of ids will not bind in
    // a single statement. The media go first, in chunks, and the collection
    // delete that cascades the rest is last, so an interruption leaves rows
    // that a rescan reconciles rather than a tree with no root.
    await inChunks(mediaIds, (batch) =>
      prisma.media.deleteMany({ where: { id: { in: batch } } }).then(() => undefined)
    );
    // Children cascade from the root in the database.
    await prisma.collection.delete({ where: { id: rootId } });

    // The search index has no foreign keys to cascade through.
    for (const id of [...collectionIds, ...mediaIds]) await searchIndexService.remove(id);

    return { collections: collectionIds.length, media: mediaIds.length };
  }

  /** Delete every root collection tree in a library (the library row itself is left to the caller). */
  async deleteLibraryContents(libraryId: string): Promise<{ collections: number; media: number }> {
    const roots = await prisma.collection.findMany({
      where: { libraryId, parentId: null },
      select: { id: true },
    });
    const totals = { collections: 0, media: 0 };
    for (const root of roots) {
      const removed = await this.deleteCollectionTree(root.id);
      if (removed) {
        totals.collections += removed.collections;
        totals.media += removed.media;
      }
    }
    return totals;
  }
}

export const contentDeletionService = new ContentDeletionService();
