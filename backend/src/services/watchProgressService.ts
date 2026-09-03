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

export class WatchProgressService {
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
