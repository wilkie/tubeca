import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { authenticate, requireRole } from '../middleware/auth';
import { AuthService } from '../services/authService';
import { ImageService } from '../services/imageService';
import type { ImageType } from '@prisma/client';

const router = Router();
const imageService = new ImageService();
const authService = new AuthService();

// Custom auth middleware that also accepts token via query parameter
// This is needed because <img> elements can't set Authorization headers
function imageAuth(req: Request, res: Response, next: NextFunction) {
  // First try query parameter token
  const queryToken = req.query.token as string | undefined;
  if (queryToken) {
    try {
      const payload = authService.verifyToken(queryToken);
      req.user = payload;
      return next();
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
router.get('/:id/file', imageAuth, async (req, res) => {
  try {
    const image = await imageService.getImageById(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const fullPath = imageService.getFullPath(image);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Image file not found' });
    }

    // Set content type based on format
    const contentTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
    };
    const ext = path.extname(fullPath).toLowerCase().slice(1);
    const contentType = contentTypes[ext] || 'application/octet-stream';

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
router.get('/media/:mediaId', async (req, res) => {
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
router.get('/collection/:collectionId', async (req, res) => {
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
router.get('/:id', async (req, res) => {
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
router.post('/download', requireRole('Editor'), async (req, res) => {
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
      scraperId,
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
router.delete('/:id', requireRole('Editor'), async (req, res) => {
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
