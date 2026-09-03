import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../config/database';
import { getImageStoragePath } from '../config/appConfig';
import { evictMediaCache } from './hlsCache';
import { searchIndexService } from './searchIndexService';

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
      const children = await prisma.collection.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((c) => c.id);
      ids.push(...frontier);
    }
    return ids;
  }

  /** Relative paths of every image owned by these collections/media or their credits. */
  async imagePathsFor(collectionIds: string[], mediaIds: string[]): Promise<string[]> {
    if (collectionIds.length === 0 && mediaIds.length === 0) return [];
    const images = await prisma.image.findMany({
      where: {
        OR: [
          ...(collectionIds.length > 0
            ? [
                { collectionId: { in: collectionIds } },
                { showCredit: { showDetails: { collectionId: { in: collectionIds } } } },
                { filmCredit: { filmDetails: { collectionId: { in: collectionIds } } } },
              ]
            : []),
          ...(mediaIds.length > 0
            ? [
                { mediaId: { in: mediaIds } },
                { credit: { videoDetails: { mediaId: { in: mediaIds } } } },
              ]
            : []),
        ],
      },
      select: { path: true },
    });
    return images.map((i) => i.path);
  }

  /** Delete one media row and its artwork files. Returns false if it did not exist. */
  async deleteMedia(mediaId: string): Promise<boolean> {
    const exists = await prisma.media.findUnique({ where: { id: mediaId }, select: { id: true } });
    if (!exists) return false;
    const files = await this.imagePathsFor([], [mediaId]);
    for (const file of files) deleteImageFile(this.storageRoot, file);
    evictMediaCache(mediaId);
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
    const media = await prisma.media.findMany({
      where: { collectionId: { in: collectionIds } },
      select: { id: true },
    });
    const mediaIds = media.map((m) => m.id);

    const files = await this.imagePathsFor(collectionIds, mediaIds);
    for (const file of files) deleteImageFile(this.storageRoot, file);
    for (const id of mediaIds) evictMediaCache(id);

    await prisma.$transaction([
      prisma.media.deleteMany({ where: { id: { in: mediaIds } } }),
      // Children cascade from the root in the database.
      prisma.collection.delete({ where: { id: rootId } }),
    ]);

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
