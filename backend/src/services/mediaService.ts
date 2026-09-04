import { prisma } from '../config/database';
import { NotFoundError } from './errors';
import { Media, MediaType } from '@prisma/client';
import { Video, Audio, CreateVideoInput, CreateAudioInput, isVideo, isAudio } from '../types/media';
import { contentDeletionService } from './contentDeletionService';

export class MediaService {
  // Create a new video
  async createVideo(data: Omit<CreateVideoInput, 'type'>): Promise<Video> {
    return await prisma.media.create({
      data: {
        ...data,
        type: MediaType.Video,
      },
    }) as Video;
  }

  // Create a new audio file
  async createAudio(data: Omit<CreateAudioInput, 'type'>): Promise<Audio> {
    return await prisma.media.create({
      data: {
        ...data,
        type: MediaType.Audio,
      },
    }) as Audio;
  }

  // Get all videos
  async getAllVideos(): Promise<Video[]> {
    return await prisma.media.findMany({
      where: { type: MediaType.Video },
      orderBy: { createdAt: 'desc' },
    }) as Video[];
  }

  // Get all audio files
  async getAllAudio(): Promise<Audio[]> {
    return await prisma.media.findMany({
      where: { type: MediaType.Audio },
      orderBy: { createdAt: 'desc' },
    }) as Audio[];
  }

  // Get all media (both videos and audio)
  async getAllMedia(): Promise<Media[]> {
    return await prisma.media.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

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

  // Update media
  async updateMedia(id: string, data: Partial<Omit<Media, 'id' | 'type' | 'createdAt' | 'updatedAt'>>): Promise<Media> {
    return await prisma.media.update({
      where: { id },
      data,
    });
  }

  // Delete media with all associated images
  /** Delete a media row and its artwork files. */
  async deleteMedia(id: string): Promise<void> {
    const deleted = await contentDeletionService.deleteMedia(id);
    if (!deleted) {
      throw new NotFoundError('Media not found');
    }
  }

  // Search media by name
  async searchMedia(query: string, type?: MediaType): Promise<Media[]> {
    return await prisma.media.findMany({
      where: {
        AND: [
          type ? { type } : {},
          { name: { contains: query } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Example of working with media and type guards
  async processMedia(id: string): Promise<string> {
    const media = await this.getMediaById(id);

    if (!media) {
      throw new Error('Media not found');
    }

    // Use type guards for type-safe handling
    if (isVideo(media)) {
      return `Processing video: ${media.name} (${media.duration}s)`;
    } else if (isAudio(media)) {
      return `Processing audio: ${media.name} (${media.duration}s)`;
    }

    return 'Unknown media type';
  }
}
