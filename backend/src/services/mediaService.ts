import * as fs from 'fs'
import * as path from 'path'
import { prisma } from '../config/database'
import { Media, MediaType } from '@prisma/client'
import { Video, Audio, CreateVideoInput, CreateAudioInput, isVideo, isAudio } from '../types/media'
import { addTranscodeJob, addThumbnailJob, addAnalyzeJob } from '../queues/videoQueue'
import type { TranscodeJobData, ThumbnailJobData, AnalyzeJobData } from '../queues/videoQueue'
import { getImageStoragePath } from '../config/appConfig'

export class MediaService {
  // Create a new video
  async createVideo(data: Omit<CreateVideoInput, 'type'>): Promise<Video> {
    return await prisma.media.create({
      data: {
        ...data,
        type: MediaType.Video,
      },
    }) as Video
  }

  // Create a new audio file
  async createAudio(data: Omit<CreateAudioInput, 'type'>): Promise<Audio> {
    return await prisma.media.create({
      data: {
        ...data,
        type: MediaType.Audio,
      },
    }) as Audio
  }

  // Get all videos
  async getAllVideos(): Promise<Video[]> {
    return await prisma.media.findMany({
      where: { type: MediaType.Video },
      orderBy: { createdAt: 'desc' },
    }) as Video[]
  }

  // Get all audio files
  async getAllAudio(): Promise<Audio[]> {
    return await prisma.media.findMany({
      where: { type: MediaType.Audio },
      orderBy: { createdAt: 'desc' },
    }) as Audio[]
  }

  // Get all media (both videos and audio)
  async getAllMedia(): Promise<Media[]> {
    return await prisma.media.findMany({
      orderBy: { createdAt: 'desc' },
    })
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
    })
  }

  // Get media by ID and ensure it's a video
  async getVideoById(id: string): Promise<Video | null> {
    const media = await prisma.media.findUnique({
      where: { id, type: MediaType.Video },
    })
    return media as Video | null
  }

  // Get media by ID and ensure it's audio
  async getAudioById(id: string): Promise<Audio | null> {
    const media = await prisma.media.findUnique({
      where: { id, type: MediaType.Audio },
    })
    return media as Audio | null
  }

  // Update media
  async updateMedia(id: string, data: Partial<Omit<Media, 'id' | 'type' | 'createdAt' | 'updatedAt'>>): Promise<Media> {
    return await prisma.media.update({
      where: { id },
      data,
    })
  }

  // Delete media with all associated images
  async deleteMedia(id: string): Promise<void> {
    const imageStoragePath = getImageStoragePath()

    // Get media with all images and credit images
    const media = await prisma.media.findUnique({
      where: { id },
      include: {
        images: true,
        videoDetails: {
          include: {
            credits: {
              include: {
                images: true,
              },
            },
          },
        },
      },
    })

    if (!media) {
      throw new Error('Media not found')
    }

    // Helper to delete image file from disk
    const deleteImageFile = (imagePath: string) => {
      try {
        const fullPath = path.join(imageStoragePath, imagePath)
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath)
          // Try to remove parent directory if empty
          const parentDir = path.dirname(fullPath)
          if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
            fs.rmdirSync(parentDir)
          }
        }
      } catch (error) {
        console.warn(`Failed to delete image file: ${imagePath}`, error)
      }
    }

    // Delete media images from disk
    for (const image of media.images) {
      deleteImageFile(image.path)
    }

    // Delete credit images from disk
    if (media.videoDetails?.credits) {
      for (const credit of media.videoDetails.credits) {
        for (const image of credit.images) {
          deleteImageFile(image.path)
        }
      }
    }

    // Delete media (cascades to images, videoDetails, audioDetails, credits in DB)
    await prisma.media.delete({
      where: { id },
    })
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
    })
  }

  // Example of working with media and type guards
  async processMedia(id: string): Promise<string> {
    const media = await this.getMediaById(id)

    if (!media) {
      throw new Error('Media not found')
    }

    // Use type guards for type-safe handling
    if (isVideo(media)) {
      return `Processing video: ${media.name} (${media.duration}s)`
    } else if (isAudio(media)) {
      return `Processing audio: ${media.name} (${media.duration}s)`
    }

    return 'Unknown media type'
  }

  // Queue a transcode job for a video
  async queueTranscode(data: TranscodeJobData) {
    const media = await this.getMediaById(data.mediaId)
    if (!media) {
      throw new Error('Media not found')
    }
    if (!isVideo(media)) {
      throw new Error('Media is not a video')
    }
    return await addTranscodeJob(data)
  }

  // Queue a thumbnail generation job
  async queueThumbnail(data: ThumbnailJobData) {
    const media = await this.getMediaById(data.mediaId)
    if (!media) {
      throw new Error('Media not found')
    }
    if (!isVideo(media)) {
      throw new Error('Media is not a video')
    }
    return await addThumbnailJob(data)
  }

  // Queue a video analysis job
  async queueAnalyze(data: AnalyzeJobData) {
    const media = await this.getMediaById(data.mediaId)
    if (!media) {
      throw new Error('Media not found')
    }
    if (!isVideo(media)) {
      throw new Error('Media is not a video')
    }
    return await addAnalyzeJob(data)
  }
}
