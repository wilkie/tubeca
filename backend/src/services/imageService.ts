import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { prisma } from '../config/database';
import { getImageStoragePath } from '../config/appConfig';
import type { ImageType } from '@prisma/client';
import { safeFetch } from '../utils/safeFetch';

export interface SaveImageInput {
  imageType: ImageType
  mediaId?: string
  collectionId?: string
  showCreditId?: string
  creditId?: string
  personId?: string
  sourceUrl?: string
  scraperId?: string
  isPrimary?: boolean
  /**
   * Keep the file already on disk when the provider still points at the same
   * URL. A full library scan re-scrapes everything, and almost none of the
   * artwork has changed since last time.
   */
  reuseExisting?: boolean
  /**
   * Keep this image alongside the existing ones of its type instead of
   * replacing them. Set by an upload or a manually chosen URL, so a curated
   * poster becomes a candidate rather than overwriting what the scraper found.
   */
  allowMultiple?: boolean
}

export interface DownloadImageResult {
  success: boolean
  path?: string
  width?: number
  height?: number
  format?: string
  fileSize?: number
  error?: string
  /** The file on disk was still current, so nothing was downloaded. */
  reused?: boolean
}

/** A slow provider must not hold a scrape worker indefinitely. */
const DOWNLOAD_TIMEOUT_MS = 20_000;
/** Artwork this large is a mistake or an attack, not a poster. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * The widths a client may ask for, as `?size=`.
 *
 * A grid of posters used to be served the provider's `original` backdrops and
 * logos at full size. These are generated from the stored file the first time
 * one is requested and then cached next to it, so an existing library needs no
 * re-ingest.
 */
export const IMAGE_SIZES: Record<string, number> = {
  w200: 200,
  w400: 400,
  w780: 780,
  w1280: 1280,
};

/** Which folder an image belongs in, from whichever owner id is set. */
function resolveEntityFolder(input: SaveImageInput): { folder: string; id: string } | null {
  if (input.mediaId) return { folder: 'media', id: input.mediaId };
  if (input.collectionId) return { folder: 'collections', id: input.collectionId };
  if (input.personId) return { folder: 'people', id: input.personId };
  if (input.showCreditId) return { folder: 'people', id: input.showCreditId };
  if (input.creditId) return { folder: 'people', id: input.creditId };
  return null;
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
    });
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
    });
  }

  /**
   * Get the primary image of a specific type for an entity
   */
  async getPrimaryImage(
    entityId: string,
    entityType: 'media' | 'collection' | 'showCredit' | 'credit',
    imageType: ImageType
  ) {
    const where: Record<string, unknown> = { imageType, isPrimary: true };

    switch (entityType) {
      case 'media':
        where.mediaId = entityId;
        break;
      case 'collection':
        where.collectionId = entityId;
        break;
      case 'showCredit':
        where.showCreditId = entityId;
        break;
      case 'credit':
        where.creditId = entityId;
        break;
    }

    return prisma.image.findFirst({ where });
  }

  /**
   * Get an image by ID
   */
  async getImageById(id: string) {
    return prisma.image.findUnique({ where: { id } });
  }

  /**
   * Download an image from a URL and save it locally
   */
  async downloadAndSaveImage(
    url: string,
    input: SaveImageInput
  ): Promise<DownloadImageResult> {
    try {
      const entity = resolveEntityFolder(input);
      if (!entity) {
        return { success: false, error: 'No entity ID provided' };
      }
      const { folder: entityFolder, id: entityId } = entity;

      // Nothing to do when the provider still points at the file we already
      // have. saveImage still runs so the row's primary flag stays correct.
      if (input.reuseExisting) {
        const reused = await this.reuseExistingImage(url, input);
        if (reused) {
          return reused;
        }
      }

      // Fetch the image. The URL is a third party's — a scraper's answer, or a
      // request body on the download route — so it can hang, it can answer with
      // a hundred megabytes, it can answer with something that is not an image,
      // and it can name this server's own loopback. All four are bounded here,
      // the last by `safeFetch`.
      const response = await safeFetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) {
        return { success: false, error: `Failed to fetch image: ${response.status}` };
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType && !contentType.startsWith('image/')) {
        return { success: false, error: `Not an image: ${contentType}` };
      }

      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > MAX_IMAGE_BYTES) {
        return { success: false, error: `Image too large: ${declaredLength} bytes` };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const fileSize = buffer.length;
      if (fileSize > MAX_IMAGE_BYTES) {
        return { success: false, error: `Image too large: ${fileSize} bytes` };
      }
      if (fileSize === 0) {
        return { success: false, error: 'Image was empty' };
      }

      // Determine format from content type or URL
      let format = 'jpg';
      if (contentType.includes('png')) {
        format = 'png';
      } else if (contentType.includes('webp')) {
        format = 'webp';
      } else if (contentType.includes('gif')) {
        format = 'gif';
      } else if (contentType.includes('svg')) {
        format = 'svg';
      } else {
        // Try to get from URL
        const urlExt = path.extname(new URL(url).pathname).toLowerCase().slice(1);
        if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(urlExt)) {
          format = urlExt === 'jpeg' ? 'jpg' : urlExt;
        }
      }

      // Build the file path
      const imageStoragePath = getImageStoragePath();
      const entityDir = path.join(imageStoragePath, entityFolder, entityId);

      // Create directory if needed
      if (!fs.existsSync(entityDir)) {
        fs.mkdirSync(entityDir, { recursive: true });
      }

      // One file per type is the scraped case; a candidate gets a suffix so it
      // sits next to the others rather than overwriting one.
      const suffix = input.allowMultiple ? `-${randomUUID().slice(0, 8)}` : '';
      const filename = `${input.imageType.toLowerCase()}${suffix}.${format}`;
      const filePath = path.join(entityDir, filename);

      // Write the file
      fs.writeFileSync(filePath, buffer);

      // Extract image dimensions using sharp
      let width: number | undefined;
      let height: number | undefined;
      try {
        const metadata = await sharp(buffer).metadata();
        width = metadata.width;
        height = metadata.height;
      } catch (sharpError) {
        console.warn('Failed to extract image dimensions:', sharpError);
      }

      // Calculate relative path for storage in database
      const relativePath = path.relative(imageStoragePath, filePath);

      // Save to database
      await this.saveImage({
        ...input,
        path: relativePath,
        format,
        width,
        height,
        fileSize,
        sourceUrl: url,
      });

      return {
        success: true,
        path: relativePath,
        width,
        height,
        format,
        fileSize,
      };
    } catch (error) {
      // `fetch` can reject with an Error from another realm, where `instanceof`
      // does not hold; "Unknown error" told nobody anything.
      const message =
        error instanceof Error ? error.message : String(error ?? 'Unknown error');
      return { success: false, error: message };
    }
  }

  /**
   * Return the stored image for this entity and type when it came from the
   * same URL and its file is still on disk, or null to download afresh.
   */
  private async reuseExistingImage(url: string, input: SaveImageInput): Promise<DownloadImageResult | null> {
    const existing = await prisma.image.findFirst({
      where: {
        imageType: input.imageType,
        mediaId: input.mediaId,
        collectionId: input.collectionId,
        personId: input.personId,
        showCreditId: input.showCreditId,
        creditId: input.creditId,
      },
    });

    if (!existing || existing.sourceUrl !== url || !existing.path) {
      return null;
    }

    const absolutePath = path.join(getImageStoragePath(), existing.path);
    if (!fs.existsSync(absolutePath)) {
      return null;
    }

    // The bytes are current; only the row may need touching (primary flag,
    // scraper attribution) so route it through the usual write.
    await this.saveImage({
      ...input,
      path: existing.path,
      format: existing.format ?? undefined,
      width: existing.width ?? undefined,
      height: existing.height ?? undefined,
      fileSize: existing.fileSize ?? undefined,
      sourceUrl: url,
    });

    return {
      success: true,
      reused: true,
      path: existing.path,
      format: existing.format ?? undefined,
      width: existing.width ?? undefined,
      height: existing.height ?? undefined,
      fileSize: existing.fileSize ?? undefined,
    };
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
      const where: Record<string, unknown> = { imageType: data.imageType };
      if (data.mediaId) where.mediaId = data.mediaId;
      if (data.collectionId) where.collectionId = data.collectionId;
      if (data.personId) where.personId = data.personId;
      if (data.showCreditId) where.showCreditId = data.showCreditId;
      if (data.creditId) where.creditId = data.creditId;

      await prisma.image.updateMany({
        where,
        data: { isPrimary: false },
      });
    }

    // Check if an image of this type already exists for this entity. A
    // candidate is added rather than matched, so several can coexist.
    const existing = data.allowMultiple
      ? null
      : await prisma.image.findFirst({
          where: {
            imageType: data.imageType,
            mediaId: data.mediaId,
            collectionId: data.collectionId,
            personId: data.personId,
            showCreditId: data.showCreditId,
            creditId: data.creditId,
          },
        });

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
      });
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
        personId: data.personId,
        showCreditId: data.showCreditId,
        creditId: data.creditId,
      },
    });
  }

  /**
   * Delete an image by ID
   */
  async deleteImage(id: string) {
    const image = await prisma.image.findUnique({ where: { id } });
    if (!image) {
      throw new Error('Image not found');
    }

    // Delete the file
    const imageStoragePath = getImageStoragePath();
    const fullPath = path.join(imageStoragePath, image.path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    // Delete from database
    return prisma.image.delete({ where: { id } });
  }

  /**
   * Get the full filesystem path for an image
   */
  getFullPath(image: { path: string }): string {
    const imageStoragePath = getImageStoragePath();
    return path.join(imageStoragePath, image.path);
  }

  /**
   * Path to a width-bounded version of a stored image, generating it once.
   *
   * Returns the original when the size is unknown, when the format cannot be
   * resized (SVG is already scalable), when the image is already narrower than
   * the requested width, or when sharp fails: a served original is always
   * better than a broken image.
   */
  async getSizedPath(image: { path: string; format: string | null; width: number | null }, size: string): Promise<string> {
    const originalPath = this.getFullPath(image);
    const targetWidth = IMAGE_SIZES[size];
    if (!targetWidth) return originalPath;

    const format = (image.format ?? path.extname(originalPath).slice(1)).toLowerCase();
    if (format === 'svg') return originalPath;
    if (image.width !== null && image.width <= targetWidth) return originalPath;

    const extension = path.extname(originalPath);
    const variantPath = `${originalPath.slice(0, -extension.length)}-${size}${extension}`;

    try {
      if (fs.existsSync(variantPath) && fs.statSync(variantPath).size > 0) {
        return variantPath;
      }
      if (!fs.existsSync(originalPath)) return originalPath;

      await sharp(originalPath)
        .resize({ width: targetWidth, withoutEnlargement: true })
        .toFile(variantPath);
      return variantPath;
    } catch (error) {
      console.warn(`Failed to resize ${image.path} to ${size}:`, error);
      return originalPath;
    }
  }

  /**
   * Make one image the primary of its type for its entity.
   *
   * Returns null when the id is unknown. The other candidates keep their rows;
   * only the flag moves, so choosing a different poster is reversible.
   */
  async setPrimary(imageId: string) {
    const image = await prisma.image.findUnique({ where: { id: imageId } });
    if (!image) return null;

    await prisma.image.updateMany({
      where: {
        imageType: image.imageType,
        mediaId: image.mediaId,
        collectionId: image.collectionId,
        personId: image.personId,
        showCreditId: image.showCreditId,
        creditId: image.creditId,
        NOT: { id: imageId },
      },
      data: { isPrimary: false },
    });

    return prisma.image.update({ where: { id: imageId }, data: { isPrimary: true } });
  }

  /**
   * Store bytes a user uploaded, as a new candidate of its type.
   *
   * Goes through the same write path as a download so it gets its dimensions,
   * its file size and a row; the `scraperId` of `manual` marks it as something
   * a person chose, which a later refresh must not throw away.
   */
  async saveUploadedImage(
    buffer: Buffer,
    input: SaveImageInput & { format: string }
  ): Promise<DownloadImageResult> {
    const entity = resolveEntityFolder(input);
    if (!entity) return { success: false, error: 'No entity ID provided' };
    if (buffer.length === 0) return { success: false, error: 'Image was empty' };
    if (buffer.length > MAX_IMAGE_BYTES) return { success: false, error: 'Image too large' };

    const imageStoragePath = getImageStoragePath();
    const entityDir = path.join(imageStoragePath, entity.folder, entity.id);
    if (!fs.existsSync(entityDir)) {
      fs.mkdirSync(entityDir, { recursive: true });
    }

    const filename = `${input.imageType.toLowerCase()}-${randomUUID().slice(0, 8)}.${input.format}`;
    const filePath = path.join(entityDir, filename);
    fs.writeFileSync(filePath, buffer);

    let width: number | undefined;
    let height: number | undefined;
    try {
      const metadata = await sharp(buffer).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch {
      // A format sharp cannot read (an SVG variant, say) is still storable.
    }

    const relativePath = path.relative(imageStoragePath, filePath);
    const saved = await this.saveImage({
      ...input,
      allowMultiple: true,
      path: relativePath,
      format: input.format,
      width,
      height,
      fileSize: buffer.length,
      scraperId: input.scraperId ?? 'manual',
    });

    if (input.isPrimary) await this.setPrimary(saved.id);

    return { success: true, path: relativePath, width, height, format: input.format, fileSize: buffer.length };
  }

  /**
   * Get the API URL for serving an image
   */
  getImageUrl(imageId: string): string {
    return `/api/images/${imageId}/file`;
  }
}
