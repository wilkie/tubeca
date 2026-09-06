import express, { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { authenticate, requireRole, isTokenCurrent } from '../middleware/auth';
import {
  requireLibraryAccess,
  imageParam,
  mediaParam,
  collectionParam,
  entityInBody,
  entityInQuery,
} from '../middleware/libraryAccess';
import { AuthService } from '../services/authService';
import { getArtworkCandidatesCached } from '../services/artworkCandidates';
import { errorResponse } from '../services/errors';
import { ImageService } from '../services/imageService';
import type { ImageType } from '@prisma/client';
import { findOrphans, removeOrphans } from '../services/imagePrune';

const router = Router();
const imageService = new ImageService();
const authService = new AuthService();
const imageAccess = requireLibraryAccess(imageParam('id'));

/** Image types an upload may claim, and the formats we accept for one. */
const IMAGE_TYPES: ImageType[] = [
  'Poster',
  'Backdrop',
  'Logo',
  'Thumbnail',
  'Still',
  'Photo',
  'AlbumArt',
  'ArtistImage',
];
const FORMAT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

// Custom auth middleware that also accepts token via query parameter
// This is needed because <img> elements can't set Authorization headers
async function imageAuth(req: Request, res: Response, next: NextFunction) {
  // First try query parameter token
  const queryToken = req.query.token as string | undefined;
  if (queryToken) {
    try {
      const payload = authService.verifyToken(queryToken);
      // A token from a URL is still subject to session invalidation.
      if (await isTokenCurrent(payload)) {
        req.user = payload;
        return next();
      }
    } catch {
      // Fall through to try header auth
    }
  }

  // Fall back to header-based auth
  return authenticate(req, res, next);
}

/**
 * @openapi
 * /api/images/{id}/file:
 *   get:
 *     tags:
 *       - Images
 *     summary: Serve image file
 *     description: Serve the actual image file. Supports token via query parameter for img elements.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: token
 *         schema:
 *           type: string
 *         description: JWT token (alternative to Authorization header)
 *       - in: query
 *         name: size
 *         required: false
 *         schema:
 *           type: string
 *           enum: [w200, w400, w780, w1280]
 *         description: >
 *           Serve a copy bounded to this width, generated on first request. The
 *           original is served when the size is unknown, the image is already
 *           smaller, or the format cannot be resized.
 *     responses:
 *       200:
 *         description: Image file
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *           image/webp:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Image not found
 */
router.get('/:id/file', imageAuth, imageAccess, async (req, res) => {
  try {
    const image = await imageService.getImageById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    if (!fs.existsSync(imageService.getFullPath(image))) {
      return res.status(404).json({ error: 'Image file not found' });
    }

    // `?size=` serves a width-bounded copy, generated once and cached on disk.
    const size = typeof req.query.size === 'string' ? req.query.size : null;
    const fullPath = size ? await imageService.getSizedPath(image, size) : imageService.getFullPath(image);

    // Set content type based on format from database (preferred) or file extension (fallback)
    const contentTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      svg: 'image/svg+xml',
    };
    const format = image.format || path.extname(fullPath).toLowerCase().slice(1);
    const contentType = contentTypes[format] || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

    // Use sendFile for efficient file serving
    res.sendFile(fullPath);
  } catch {
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

// All other image routes require standard authentication
router.use(authenticate);

// NOTE: registered before /:id so "orphans" is not taken as an image id.
/**
 * @openapi
 * /api/images/orphans:
 *   get:
 *     tags:
 *       - Images
 *     summary: Files in the image store that no image row points at
 *     description: >
 *       A format change leaves the old file behind, and older versions deleted rows
 *       without their files. Nothing else sweeps them up. Admin only; removes nothing.
 *     responses:
 *       200:
 *         description: The orphaned paths, their total size, and how many files were examined
 *   delete:
 *     tags:
 *       - Images
 *     summary: Delete the files nothing points at
 *     description: Runs the same scan and removes what it finds. Admin only.
 *     responses:
 *       200:
 *         description: How many files were removed and how many bytes they held
 */
router.get('/orphans', requireRole('Admin'), async (_req, res) => {
  try {
    res.json(await findOrphans());
  } catch (error) {
    console.error('Failed to scan for orphaned images:', error);
    res.status(500).json({ error: 'Failed to scan for orphaned images' });
  }
});

router.delete('/orphans', requireRole('Admin'), async (_req, res) => {
  try {
    // Scanned again rather than taking a list from the caller: the caller's
    // list could name anything, and this deletes files.
    const report = await findOrphans();
    const removed = removeOrphans(report.orphans);
    res.json({ removed, bytes: report.bytes, scanned: report.scanned });
  } catch (error) {
    console.error('Failed to remove orphaned images:', error);
    res.status(500).json({ error: 'Failed to remove orphaned images' });
  }
});


/**
 * @openapi
 * /api/images/media/{mediaId}:
 *   get:
 *     tags:
 *       - Images
 *     summary: Get images for media
 *     description: Get all images for a media item
 *     parameters:
 *       - in: path
 *         name: mediaId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [Poster, Backdrop, Banner, Thumb, Logo, Photo]
 *         description: Filter by image type
 *     responses:
 *       200:
 *         description: List of images
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 images:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Image'
 */
router.get('/media/:mediaId', requireLibraryAccess(mediaParam('mediaId')), async (req, res) => {
  try {
    const { mediaId } = req.params;
    const { type } = req.query;

    const images = await imageService.getImagesForMedia(
      mediaId,
      type as ImageType | undefined
    );
    res.json({ images });
  } catch {
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

/**
 * @openapi
 * /api/images/collection/{collectionId}:
 *   get:
 *     tags:
 *       - Images
 *     summary: Get images for collection
 *     description: Get all images for a collection
 *     parameters:
 *       - in: path
 *         name: collectionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [Poster, Backdrop, Banner, Thumb, Logo, Photo]
 *         description: Filter by image type
 *     responses:
 *       200:
 *         description: List of images
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 images:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Image'
 */
router.get('/collection/:collectionId', requireLibraryAccess(collectionParam('collectionId')), async (req, res) => {
  try {
    const { collectionId } = req.params;
    const { type } = req.query;

    const images = await imageService.getImagesForCollection(
      collectionId,
      type as ImageType | undefined
    );
    res.json({ images });
  } catch {
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

/**
 * @openapi
 * /api/images/{id}:
 *   get:
 *     tags:
 *       - Images
 *     summary: Get image metadata
 *     description: Get image metadata by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Image metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 image:
 *                   $ref: '#/components/schemas/Image'
 *       404:
 *         description: Image not found
 */
router.get('/:id', imageAccess, async (req, res) => {
  try {
    const image = await imageService.getImageById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.json({ image });
  } catch {
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

/**
 * @openapi
 * /api/images/candidates/collection/{collectionId}:
 *   get:
 *     tags:
 *       - Images
 *     summary: Artwork the provider offers for a collection
 *     description: >
 *       The posters, backdrops and logos the scraper that identified this
 *       collection has for it, as URLs, each flagged with whether it has
 *       already been saved. Nothing is downloaded until one is chosen through
 *       POST /api/images/download (Editor or Admin only).
 *     parameters:
 *       - in: path
 *         name: collectionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Candidate artwork
 *       400:
 *         description: The collection has not been identified, or its scraper is not configured
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Collection not found
 */
router.get(
  '/candidates/collection/:collectionId',
  requireRole('Editor'),
  requireLibraryAccess(collectionParam('collectionId')),
  async (req, res) => {
    try {
      res.json({ candidates: await getArtworkCandidatesCached(req.params.collectionId) });
    } catch (error) {
      const { status, error: message } = errorResponse(error, 'Failed to fetch artwork candidates');
      if (status === 500) console.error('Artwork candidates error:', error);
      res.status(status).json({ error: message });
    }
  }
);

/**
 * @openapi
 * /api/images/download:
 *   post:
 *     tags:
 *       - Images
 *     summary: Download and save image
 *     description: Download an image from URL and save it (Editor or Admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - imageType
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *               imageType:
 *                 type: string
 *                 enum: [Poster, Backdrop, Banner, Thumb, Logo, Photo]
 *               mediaId:
 *                 type: string
 *                 format: uuid
 *               collectionId:
 *                 type: string
 *                 format: uuid
 *               showCreditId:
 *                 type: string
 *                 format: uuid
 *               creditId:
 *                 type: string
 *                 format: uuid
 *               isPrimary:
 *                 type: boolean
 *               scraperId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Image downloaded and saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 path:
 *                   type: string
 *                 format:
 *                   type: string
 *                 fileSize:
 *                   type: integer
 *       400:
 *         description: Invalid request or download failed
 *       403:
 *         description: Forbidden - Editor role required
 */
router.post('/download', requireRole('Editor'), requireLibraryAccess(entityInBody), async (req, res) => {
  try {
    const { url, imageType, mediaId, collectionId, showCreditId, creditId, isPrimary, scraperId } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    if (!imageType) {
      return res.status(400).json({ error: 'Image type is required' });
    }

    if (!mediaId && !collectionId && !showCreditId && !creditId) {
      return res.status(400).json({ error: 'Entity ID is required (mediaId, collectionId, showCreditId, or creditId)' });
    }

    const result = await imageService.downloadAndSaveImage(url, {
      imageType,
      mediaId,
      collectionId,
      showCreditId,
      creditId,
      isPrimary,
      scraperId: scraperId ?? 'manual',
      // A person chose this one; keep whatever the scraper found as well.
      allowMultiple: true,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json({
      message: 'Image downloaded and saved',
      path: result.path,
      format: result.format,
      fileSize: result.fileSize,
    });
  } catch {
    res.status(500).json({ error: 'Failed to download image' });
  }
});

/**
 * @openapi
 * /api/images/{id}/primary:
 *   put:
 *     tags:
 *       - Images
 *     summary: Choose which image of its type to use
 *     description: >
 *       Make this image the primary one for its entity and type (Editor or Admin only).
 *       The other candidates keep their rows, so the choice is reversible.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The image, now primary
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Image not found
 */
router.put('/:id/primary', requireRole('Editor'), imageAccess, async (req, res) => {
  try {
    const image = await imageService.setPrimary(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.json({ image });
  } catch {
    res.status(500).json({ error: 'Failed to set the primary image' });
  }
});

/**
 * @openapi
 * /api/images/upload:
 *   post:
 *     tags:
 *       - Images
 *     summary: Upload artwork
 *     description: >
 *       Store an image the user supplies as a new candidate for an entity and type
 *       (Editor or Admin only). The body is the raw image bytes and `Content-Type`
 *       names the format. Uploaded images are recorded with scraperId `manual`.
 *     parameters:
 *       - in: query
 *         name: imageType
 *         required: true
 *         schema:
 *           type: string
 *           enum: [Poster, Backdrop, Logo, Thumbnail, Still, Photo, AlbumArt, ArtistImage]
 *       - in: query
 *         name: collectionId
 *         schema:
 *           type: string
 *       - in: query
 *         name: mediaId
 *         schema:
 *           type: string
 *       - in: query
 *         name: personId
 *         schema:
 *           type: string
 *       - in: query
 *         name: isPrimary
 *         schema:
 *           type: boolean
 *     requestBody:
 *       required: true
 *       content:
 *         image/png:
 *           schema:
 *             type: string
 *             format: binary
 *         image/jpeg:
 *           schema:
 *             type: string
 *             format: binary
 *     responses:
 *       201:
 *         description: Image stored
 *       400:
 *         description: Missing or unsupported input
 *       403:
 *         description: Forbidden - Editor role required
 */
router.post(
  '/upload',
  requireRole('Editor'),
  requireLibraryAccess(entityInQuery),
  express.raw({ type: ['image/*'], limit: '25mb' }),
  async (req, res) => {
    try {
      const imageType = req.query.imageType as ImageType | undefined;
      const { collectionId, mediaId, personId } = req.query as Record<string, string | undefined>;

      if (!imageType || !IMAGE_TYPES.includes(imageType)) {
        return res.status(400).json({ error: 'A valid imageType is required' });
      }
      if (!collectionId && !mediaId && !personId) {
        return res.status(400).json({ error: 'Entity ID is required (collectionId, mediaId or personId)' });
      }

      const format = FORMAT_BY_CONTENT_TYPE[(req.headers['content-type'] ?? '').split(';')[0].trim()];
      if (!format) {
        return res.status(400).json({ error: 'Unsupported image type' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'Image body is required' });
      }

      const result = await imageService.saveUploadedImage(req.body, {
        imageType,
        collectionId,
        mediaId,
        personId,
        format,
        isPrimary: req.query.isPrimary === 'true',
      });

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.status(201).json({ message: 'Image uploaded', path: result.path, format: result.format });
    } catch {
      res.status(500).json({ error: 'Failed to upload image' });
    }
  }
);

/**
 * @openapi
 * /api/images/{id}:
 *   delete:
 *     tags:
 *       - Images
 *     summary: Delete an image
 *     description: Delete an image (Editor or Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Image deleted
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Image not found
 */
router.delete('/:id', requireRole('Editor'), imageAccess, async (req, res) => {
  try {
    await imageService.deleteImage(req.params.id);
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === 'Image not found') {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

export default router;
