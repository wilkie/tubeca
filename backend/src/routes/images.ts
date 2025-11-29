import { Router, Request, Response, NextFunction } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { authenticate, requireRole } from '../middleware/auth'
import { AuthService } from '../services/authService'
import { ImageService } from '../services/imageService'
import type { ImageType } from '@prisma/client'

const router = Router()
const imageService = new ImageService()
const authService = new AuthService()

// Custom auth middleware that also accepts token via query parameter
// This is needed because <img> elements can't set Authorization headers
function imageAuth(req: Request, res: Response, next: NextFunction) {
  // First try query parameter token
  const queryToken = req.query.token as string | undefined
  if (queryToken) {
    try {
      const payload = authService.verifyToken(queryToken)
      req.user = payload
      return next()
    } catch {
      // Fall through to try header auth
    }
  }

  // Fall back to header-based auth
  return authenticate(req, res, next)
}

// Serve an image file - uses imageAuth to support query param token for <img> elements
router.get('/:id/file', imageAuth, async (req, res) => {
  try {
    const image = await imageService.getImageById(req.params.id)
    if (!image) {
      return res.status(404).json({ error: 'Image not found' })
    }

    const fullPath = imageService.getFullPath(image)
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Image file not found' })
    }

    // Set content type based on format
    const contentTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
    }
    const ext = path.extname(fullPath).toLowerCase().slice(1)
    const contentType = contentTypes[ext] || 'application/octet-stream'

    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400') // Cache for 1 day

    const stream = fs.createReadStream(fullPath)
    stream.pipe(res)
  } catch {
    res.status(500).json({ error: 'Failed to serve image' })
  }
})

// All other image routes require standard authentication
router.use(authenticate)

// Get all images for a media item
router.get('/media/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params
    const { type } = req.query

    const images = await imageService.getImagesForMedia(
      mediaId,
      type as ImageType | undefined
    )
    res.json({ images })
  } catch {
    res.status(500).json({ error: 'Failed to fetch images' })
  }
})

// Get all images for a collection
router.get('/collection/:collectionId', async (req, res) => {
  try {
    const { collectionId } = req.params
    const { type } = req.query

    const images = await imageService.getImagesForCollection(
      collectionId,
      type as ImageType | undefined
    )
    res.json({ images })
  } catch {
    res.status(500).json({ error: 'Failed to fetch images' })
  }
})

// Get image metadata by ID
router.get('/:id', async (req, res) => {
  try {
    const image = await imageService.getImageById(req.params.id)
    if (!image) {
      return res.status(404).json({ error: 'Image not found' })
    }
    res.json({ image })
  } catch {
    res.status(500).json({ error: 'Failed to fetch image' })
  }
})

// Download and save an image from URL (Admin/Editor only)
router.post('/download', requireRole('Editor'), async (req, res) => {
  try {
    const { url, imageType, mediaId, collectionId, showCreditId, creditId, isPrimary, scraperId } = req.body

    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    if (!imageType) {
      return res.status(400).json({ error: 'Image type is required' })
    }

    if (!mediaId && !collectionId && !showCreditId && !creditId) {
      return res.status(400).json({ error: 'Entity ID is required (mediaId, collectionId, showCreditId, or creditId)' })
    }

    const result = await imageService.downloadAndSaveImage(url, {
      imageType,
      mediaId,
      collectionId,
      showCreditId,
      creditId,
      isPrimary,
      scraperId,
    })

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    res.status(201).json({
      message: 'Image downloaded and saved',
      path: result.path,
      format: result.format,
      fileSize: result.fileSize,
    })
  } catch {
    res.status(500).json({ error: 'Failed to download image' })
  }
})

// Delete an image (Admin/Editor only)
router.delete('/:id', requireRole('Editor'), async (req, res) => {
  try {
    await imageService.deleteImage(req.params.id)
    res.status(204).send()
  } catch (error) {
    if (error instanceof Error && error.message === 'Image not found') {
      return res.status(404).json({ error: 'Image not found' })
    }
    res.status(500).json({ error: 'Failed to delete image' })
  }
})

export default router
