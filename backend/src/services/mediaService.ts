import { prisma } from '../config/database';
import { NotFoundError } from './errors';
import { MediaType } from '@prisma/client';
import { Video, Audio } from '../types/media';
import { contentDeletionService } from './contentDeletionService';

export class MediaService {
  // Get media by ID with type checking and details
  async getMediaById(id: string) {
    return await prisma.media.findUnique({
      where: { id },
      include: {
        collection: {
          select: {
            id: true,
            name: true,
            collectionType: true,
            images: {
              where: { imageType: 'Backdrop', isPrimary: true },
              take: 1,
            },
            parent: {
              select: {
                id: true,
                name: true,
                collectionType: true,
                images: {
                  where: { imageType: 'Backdrop', isPrimary: true },
                  take: 1,
                },
              },
            },
            library: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        images: true,
        streams: {
          orderBy: [
            { streamType: 'asc' },
            { streamIndex: 'asc' },
          ],
        },
        videoDetails: {
          include: {
            credits: {
              orderBy: { order: 'asc' },
              include: {
                person: {
                  include: {
                    images: {
                      where: { isPrimary: true, imageType: 'Photo' },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
        audioDetails: true,
      },
    });
  }

  // Get media by ID and ensure it's a video
  async getVideoById(id: string): Promise<Video | null> {
    const media = await prisma.media.findUnique({
      where: { id, type: MediaType.Video },
    });
    return media as Video | null;
  }

  // Get media by ID and ensure it's audio
  async getAudioById(id: string): Promise<Audio | null> {
    const media = await prisma.media.findUnique({
      where: { id, type: MediaType.Audio },
    });
    return media as Audio | null;
  }

  /** Delete a media row and its artwork files. */
  async deleteMedia(id: string): Promise<void> {
    const deleted = await contentDeletionService.deleteMedia(id);
    if (!deleted) {
      throw new NotFoundError('Media not found');
    }
  }
}
