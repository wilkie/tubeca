import { Prisma, type ImageType } from '@prisma/client';
import { prisma } from '../config/database';
import { LibraryService } from './libraryService';

/** Fraction of the duration after which a media item counts as watched. */
export const COMPLETION_THRESHOLD = 0.9;
/** Positions below this (seconds) are not worth resuming from. */
export const MIN_RESUME_POSITION = 30;

const libraryService = new LibraryService();

const artworkTypes: ImageType[] = ['Poster', 'Backdrop'];

const mediaCardInclude = {
  collection: {
    select: {
      id: true,
      name: true,
      collectionType: true,
      libraryId: true,
      images: { where: { imageType: { in: artworkTypes } } },
      parent: {
        select: {
          id: true,
          name: true,
          collectionType: true,
          images: { where: { imageType: { in: artworkTypes } } },
        },
      },
    },
  },
  videoDetails: { select: { season: true, episode: true, description: true } },
  images: true,
} satisfies Prisma.MediaInclude;

/** Decide whether a position marks the media as watched. */
export function isCompleted(position: number, duration: number): boolean {
  return duration > 0 && position / duration >= COMPLETION_THRESHOLD;
}

/** Per-collection roll-up used for badges on show, season and film cards. */
export interface CollectionWatchSummary {
  /** Media items in the collection and all its descendants */
  total: number
  /** Of those, how many the user has completed */
  watched: number
  /** How many are started but not finished */
  inProgress: number
  /** The most recently played unfinished item, for a resume bar on single-item collections */
  resume?: { mediaId: string; position: number; duration: number }
}

export class WatchProgressService {
  /** Progress rows for a set of media ids, keyed by media id (absent when never played). */
  async getProgressBatch(userId: string, mediaIds: string[]) {
    if (mediaIds.length === 0) return {};
    const rows = await prisma.watchProgress.findMany({ where: { userId, mediaId: { in: mediaIds } } });
    return Object.fromEntries(rows.map((row) => [row.mediaId, row]));
  }

  /**
   * Watched/total counts for each collection over its whole subtree. Collections
   * outside the user's accessible libraries are omitted from the result.
   */
  async getCollectionSummaries(
    userId: string,
    isAdmin: boolean,
    collectionIds: string[]
  ): Promise<Record<string, CollectionWatchSummary>> {
    if (collectionIds.length === 0) return {};

    const accessibleIds = isAdmin
      ? undefined
      : (await libraryService.getAccessibleLibraries(userId, false)).map((l) => l.id);
    const roots = await prisma.collection.findMany({
      where: { id: { in: collectionIds }, ...(accessibleIds ? { libraryId: { in: accessibleIds } } : {}) },
      select: { id: true, parentId: true },
    });
    const requested = new Set(roots.map((r) => r.id));

    // Discover every descendant of the requested collections and remember parent links,
    // so a media item can be credited to each requested ancestor (a season requested
    // together with its show counts toward both).
    const parentOf = new Map<string, string | null>(roots.map((r) => [r.id, r.parentId]));
    let frontier = roots.map((r) => r.id);
    while (frontier.length > 0) {
      const children = await prisma.collection.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true, parentId: true },
      });
      frontier = [];
      for (const child of children) {
        if (!parentOf.has(child.id)) {
          parentOf.set(child.id, child.parentId);
          frontier.push(child.id);
        }
      }
    }
    const requestedAncestors = (collectionId: string): string[] => {
      const found: string[] = [];
      let cursor: string | null | undefined = collectionId;
      while (cursor && parentOf.has(cursor)) {
        if (requested.has(cursor)) found.push(cursor);
        cursor = parentOf.get(cursor);
      }
      return found;
    };

    const media = await prisma.media.findMany({
      where: { collectionId: { in: [...parentOf.keys()] } },
      select: { id: true, collectionId: true },
    });
    const progress = await prisma.watchProgress.findMany({
      where: { userId, mediaId: { in: media.map((m) => m.id) } },
    });
    const progressByMedia = new Map(progress.map((p) => [p.mediaId, p]));

    const summaries: Record<string, CollectionWatchSummary> = {};
    for (const root of roots) summaries[root.id] = { total: 0, watched: 0, inProgress: 0 };
    const latest = new Map<string, Date>();
    for (const item of media) {
      const row = progressByMedia.get(item.id);
      for (const root of requestedAncestors(item.collectionId!)) {
        const summary = summaries[root];
        summary.total++;
        if (!row) continue;
        if (row.completed) {
          summary.watched++;
        } else if (row.position >= MIN_RESUME_POSITION) {
          summary.inProgress++;
          if (!latest.has(root) || row.updatedAt > latest.get(root)!) {
            latest.set(root, row.updatedAt);
            summary.resume = { mediaId: row.mediaId, position: row.position, duration: row.duration };
          }
        }
      }
    }
    return summaries;
  }

  async getProgress(userId: string, mediaId: string) {
    return prisma.watchProgress.findUnique({ where: { userId_mediaId: { userId, mediaId } } });
  }

  /**
   * Record a playback position. `duration` defaults to the media's stored
   * duration. Crossing the completion threshold marks the row completed; a
   * later report below the threshold (a rewatch) clears it again.
   */
  async recordProgress(userId: string, mediaId: string, position: number, duration?: number) {
    const media = await prisma.media.findUnique({ where: { id: mediaId }, select: { duration: true } });
    if (!media) return null;

    const effectiveDuration = duration && duration > 0 ? Math.round(duration) : media.duration;
    const safePosition = Math.max(0, Math.round(position));
    const completed = isCompleted(safePosition, effectiveDuration);

    return prisma.watchProgress.upsert({
      where: { userId_mediaId: { userId, mediaId } },
      create: { userId, mediaId, position: safePosition, duration: effectiveDuration, completed },
      update: { position: safePosition, duration: effectiveDuration, completed },
    });
  }

  /** Explicitly mark as watched (e.g. from an "ended" event or a menu action). */
  async markCompleted(userId: string, mediaId: string) {
    const media = await prisma.media.findUnique({ where: { id: mediaId }, select: { duration: true } });
    if (!media) return null;
    return prisma.watchProgress.upsert({
      where: { userId_mediaId: { userId, mediaId } },
      create: { userId, mediaId, position: media.duration, duration: media.duration, completed: true },
      update: { position: media.duration, duration: media.duration, completed: true },
    });
  }

  /** Forget the position and watched state ("mark as unwatched"). */
  async clearProgress(userId: string, mediaId: string) {
    await prisma.watchProgress.deleteMany({ where: { userId, mediaId } });
  }

  /**
   * In-progress items for the user, most recently played first, limited to
   * libraries the user may see.
   */
  async getContinueWatching(userId: string, isAdmin: boolean, limit = 20) {
    const accessibleIds = isAdmin
      ? undefined
      : (await libraryService.getAccessibleLibraries(userId, false)).map((l) => l.id);

    return prisma.watchProgress.findMany({
      where: {
        userId,
        completed: false,
        position: { gte: MIN_RESUME_POSITION },
        media: {
          collection: accessibleIds ? { libraryId: { in: accessibleIds } } : { isNot: null },
        },
      },
      include: { media: { include: mediaCardInclude } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }
}
