import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import { MediaService } from '../services/mediaService'
import { addMetadataScrapeJob, getMetadataScrapeQueueStatus } from '../queues/metadataScrapeQueue'
import { scraperManager } from '../plugins/scraperLoader'

const router = Router()
const mediaService = new MediaService()

// All media routes require authentication
router.use(authenticate)

// Get a single media item
router.get('/:id', async (req, res) => {
  try {
    const media = await mediaService.getMediaById(req.params.id)
    if (!media) {
      return res.status(404).json({ error: 'Media not found' })
    }
    res.json({ media })
  } catch {
    res.status(500).json({ error: 'Failed to fetch media' })
  }
})

// Delete a media item (Admin/Editor only)
router.delete('/:id', requireRole('Editor'), async (req, res) => {
  try {
    await mediaService.deleteMedia(req.params.id)
    res.status(204).send()
  } catch (error) {
    if (error instanceof Error && error.message === 'Media not found') {
      return res.status(404).json({ error: error.message })
    }
    res.status(500).json({ error: 'Failed to delete media' })
  }
})

// Refresh metadata for a media item (Admin/Editor only)
router.post('/:id/refresh-metadata', requireRole('Editor'), async (req, res) => {
  try {
    const media = await mediaService.getMediaById(req.params.id)
    if (!media) {
      return res.status(404).json({ error: 'Media not found' })
    }

    // Optional: specify a scraper and/or external ID
    const { scraperId, externalId } = req.body

    // Extract episode context from videoDetails if available
    const videoDetails = media.videoDetails as {
      showName?: string | null
      season?: number | null
      episode?: number | null
    } | null

    const job = await addMetadataScrapeJob({
      mediaId: media.id,
      mediaName: media.name,
      mediaType: media.type as 'Video' | 'Audio',
      scraperId,
      externalId,
      skipImages: true, // Don't replace images on metadata refresh
      // Include episode context for TV shows
      showName: videoDetails?.showName ?? undefined,
      season: videoDetails?.season ?? undefined,
      episode: videoDetails?.episode ?? undefined,
    })

    res.status(202).json({
      message: 'Metadata refresh queued',
      jobId: job.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue metadata refresh'
    res.status(500).json({ error: message })
  }
})

// Refresh images for a media item (Admin/Editor only)
router.post('/:id/refresh-images', requireRole('Editor'), async (req, res) => {
  try {
    const media = await mediaService.getMediaById(req.params.id)
    if (!media) {
      return res.status(404).json({ error: 'Media not found' })
    }

    // Get existing scraper info from videoDetails or audioDetails
    let scraperId: string | undefined
    let externalId: string | undefined

    if (media.videoDetails) {
      // VideoDetails doesn't store scraperId/externalId directly
      // We'll need to search again
    }

    const job = await addMetadataScrapeJob({
      mediaId: media.id,
      mediaName: media.name,
      mediaType: media.type as 'Video' | 'Audio',
      scraperId,
      externalId,
      imagesOnly: true, // Only refresh images, not metadata
    })

    res.status(202).json({
      message: 'Image refresh queued',
      jobId: job.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue image refresh'
    res.status(500).json({ error: message })
  }
})

// Get list of available scrapers
router.get('/scrapers/list', async (_req, res) => {
  try {
    const scrapers = scraperManager.list()
    res.json({ scrapers })
  } catch {
    res.status(500).json({ error: 'Failed to get scrapers' })
  }
})

// Get metadata scrape queue status (Admin only)
router.get('/scrapers/queue-status', requireRole('Admin'), async (_req, res) => {
  try {
    const status = await getMetadataScrapeQueueStatus()
    res.json(status)
  } catch {
    res.status(500).json({ error: 'Failed to get queue status' })
  }
})

// Search for metadata using scrapers (for manual matching)
router.get('/scrapers/search', async (req, res) => {
  try {
    const { query, type, scraperId } = req.query

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query parameter is required' })
    }

    const scrapers = scraperId
      ? [scraperManager.get(scraperId as string)].filter(Boolean)
      : scraperManager.getByMediaType((type as 'video' | 'audio') ?? 'video').filter((s) => s.isConfigured())

    const results: Array<{ scraperId: string; results: unknown[] }> = []

    for (const scraper of scrapers) {
      if (!scraper) continue

      try {
        if (type === 'audio' && scraper.searchAudio) {
          const audioResults = await scraper.searchAudio(query)
          results.push({ scraperId: scraper.id, results: audioResults })
        } else if (scraper.searchVideo) {
          const videoResults = await scraper.searchVideo(query)
          results.push({ scraperId: scraper.id, results: videoResults })
        }
      } catch (error) {
        console.error(`Search failed for scraper ${scraper.id}:`, error)
      }
    }

    res.json({ results })
  } catch {
    res.status(500).json({ error: 'Failed to search' })
  }
})

export default router
