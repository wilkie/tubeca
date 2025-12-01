import { Media, MediaType } from '@prisma/client';

// Type-safe Video type
export type Video = Omit<Media, 'type'> & {
  type: typeof MediaType.Video
}

// Type-safe Audio type
export type Audio = Omit<Media, 'type'> & {
  type: typeof MediaType.Audio
}

// Union type for all media types
export type MediaUnion = Video | Audio

// Type guards for runtime type checking
export function isVideo(media: Media): media is Video {
  return media.type === MediaType.Video;
}

export function isAudio(media: Media): media is Audio {
  return media.type === MediaType.Audio;
}

// Helper type for creating new media items (required fields only)
export type CreateVideoInput = {
  type: typeof MediaType.Video
  path: string
  duration: number
  name: string
  thumbnails?: string | null
  collectionId?: string | null
}

export type CreateAudioInput = {
  type: typeof MediaType.Audio
  path: string
  duration: number
  name: string
  thumbnails?: string | null
  collectionId?: string | null
}
