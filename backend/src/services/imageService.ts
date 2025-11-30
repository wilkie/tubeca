import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { prisma } from '../config/database'
import { getImageStoragePath } from '../config/appConfig'
import type { ImageType } from '@prisma/client'

export interface SaveImageInput {
  imageType: ImageType
  mediaId?: string
  collectionId?: string
  showCreditId?: string
  creditId?: string
  sourceUrl?: string
  scraperId?: string
  isPrimary?: boolean
}

export interface DownloadImageResult {
  success: boolean
  path?: string
  width?: number
  height?: number
  format?: string
  fileSize?: number
  error?: string
}

export class ImageService {
  /**
   * Get all images for a media item
   */
  async getImagesForMedia(mediaId: string, imageType?: ImageType) {
    return prisma.image.findMany({
      where: {
        mediaId,
        ...(imageType && { imageType }),
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    })
  }

  /**
   * Get all images for a collection
   */
  async getImagesForCollection(collectionId: string, imageType?: ImageType) {
    return prisma.image.findMany({
      where: {
        collectionId,
        ...(imageType && { imageType }),
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    })
  }

  /**
   * Get the primary image of a specific type for an entity
   */
  async getPrimaryImage(
    entityId: string,
    entityType: 'media' | 'collection' | 'showCredit' | 'credit',
    imageType: ImageType
  ) {
    const where: Record<string, unknown> = { imageType, isPrimary: true }

    switch (entityType) {
      case 'media':
        where.mediaId = entityId
        break
      case 'collection':
        where.collectionId = entityId
        break
      case 'showCredit':
        where.showCreditId = entityId
        break
      case 'credit':
        where.creditId = entityId
        break
    }

    return prisma.image.findFirst({ where })
  }

  /**
   * Get an image by ID
   */
  async getImageById(id: string) {
    return prisma.image.findUnique({ where: { id } })
  }

  /**
   * Download an image from a URL and save it locally
   */
  async downloadAndSaveImage(
    url: string,
    input: SaveImageInput
  ): Promise<DownloadImageResult> {
    try {
      // Determine the entity type and ID for folder structure
      let entityFolder: string
      let entityId: string

      if (input.mediaId) {
        entityFolder = 'media'
        entityId = input.mediaId
      } else if (input.collectionId) {
        entityFolder = 'collections'
        entityId = input.collectionId
      } else if (input.showCreditId) {
        entityFolder = 'people'
        entityId = input.showCreditId
      } else if (input.creditId) {
        entityFolder = 'people'
        entityId = input.creditId
      } else {
        return { success: false, error: 'No entity ID provided' }
      }

      // Fetch the image
      const response = await fetch(url)
      if (!response.ok) {
        return { success: false, error: `Failed to fetch image: ${response.status}` }
      }

      const contentType = response.headers.get('content-type') || ''
      const buffer = Buffer.from(await response.arrayBuffer())
      const fileSize = buffer.length

      // Determine format from content type or URL
      let format = 'jpg'
      if (contentType.includes('png')) {
        format = 'png'
      } else if (contentType.includes('webp')) {
        format = 'webp'
      } else if (contentType.includes('gif')) {
        format = 'gif'
      } else {
        // Try to get from URL
        const urlExt = path.extname(new URL(url).pathname).toLowerCase().slice(1)
        if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(urlExt)) {
          format = urlExt === 'jpeg' ? 'jpg' : urlExt
        }
      }

      // Build the file path
      const imageStoragePath = getImageStoragePath()
      const entityDir = path.join(imageStoragePath, entityFolder, entityId)

      // Create directory if needed
      if (!fs.existsSync(entityDir)) {
        fs.mkdirSync(entityDir, { recursive: true })
      }

      // Generate filename based on image type
      const filename = `${input.imageType.toLowerCase()}.${format}`
      const filePath = path.join(entityDir, filename)

      // Write the file
      fs.writeFileSync(filePath, buffer)

      // Extract image dimensions using sharp
      let width: number | undefined
      let height: number | undefined
      try {
        const metadata = await sharp(buffer).metadata()
        width = metadata.width
        height = metadata.height
      } catch (sharpError) {
        console.warn('Failed to extract image dimensions:', sharpError)
      }

      // Calculate relative path for storage in database
      const relativePath = path.relative(imageStoragePath, filePath)

      // Save to database
      await this.saveImage({
        ...input,
        path: relativePath,
        format,
        width,
        height,
        fileSize,
        sourceUrl: url,
      })

      return {
        success: true,
        path: relativePath,
        width,
        height,
        format,
        fileSize,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  }

  /**
   * Save an image record to the database
   */
  async saveImage(data: SaveImageInput & {
    path: string
    format?: string
    width?: number
    height?: number
    fileSize?: number
  }) {
    // If this is set as primary, unset any existing primary for this entity+type
    if (data.isPrimary) {
      const where: Record<string, unknown> = { imageType: data.imageType }
      if (data.mediaId) where.mediaId = data.mediaId
      if (data.collectionId) where.collectionId = data.collectionId
      if (data.showCreditId) where.showCreditId = data.showCreditId
      if (data.creditId) where.creditId = data.creditId

      await prisma.image.updateMany({
        where,
        data: { isPrimary: false },
      })
    }

    // Check if an image of this type already exists for this entity
    const existing = await prisma.image.findFirst({
      where: {
        imageType: data.imageType,
        mediaId: data.mediaId,
        collectionId: data.collectionId,
        showCreditId: data.showCreditId,
        creditId: data.creditId,
      },
    })

    if (existing) {
      // Update existing image
      return prisma.image.update({
        where: { id: existing.id },
        data: {
          path: data.path,
          format: data.format,
          width: data.width,
          height: data.height,
          fileSize: data.fileSize,
          sourceUrl: data.sourceUrl,
          scraperId: data.scraperId,
          isPrimary: data.isPrimary ?? existing.isPrimary,
        },
      })
    }

    // Create new image
    return prisma.image.create({
      data: {
        imageType: data.imageType,
        path: data.path,
        format: data.format,
        width: data.width,
        height: data.height,
        fileSize: data.fileSize,
        sourceUrl: data.sourceUrl,
        scraperId: data.scraperId,
        isPrimary: data.isPrimary ?? false,
        mediaId: data.mediaId,
        collectionId: data.collectionId,
        showCreditId: data.showCreditId,
        creditId: data.creditId,
      },
    })
  }

  /**
   * Delete an image by ID
   */
  async deleteImage(id: string) {
    const image = await prisma.image.findUnique({ where: { id } })
    if (!image) {
      throw new Error('Image not found')
    }

    // Delete the file
    const imageStoragePath = getImageStoragePath()
    const fullPath = path.join(imageStoragePath, image.path)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
    }

    // Delete from database
    return prisma.image.delete({ where: { id } })
  }

  /**
   * Get the full filesystem path for an image
   */
  getFullPath(image: { path: string }): string {
    const imageStoragePath = getImageStoragePath()
    return path.join(imageStoragePath, image.path)
  }

  /**
   * Get the API URL for serving an image
   */
  getImageUrl(imageId: string): string {
    return `/api/images/${imageId}/file`
  }
}
