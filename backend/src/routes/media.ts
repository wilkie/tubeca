import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { MediaService } from '../services/mediaService';
import { addMetadataScrapeJob, getMetadataScrapeQueueStatus } from '../queues/metadataScrapeQueue';
import { scraperManager } from '../plugins/scraperLoader';

const router = Router();
const mediaService = new MediaService();

// All media routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/media/{id}:
 *   get:
 *     tags:
 *       - Media
 *     summary: Get a media item
 *     description: Get a single media item by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Media found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 media:
 *                   $ref: '#/components/schemas/Media'
 *       404:
 *         description: Media not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', async (req, res) => {
  try {
    const media = await mediaService.getMediaById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }
    res.json({ media });
  } catch {
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

/**
 * @openapi
 * /api/media/{id}:
 *   delete:
 *     tags:
 *       - Media
 *     summary: Delete a media item
 *     description: Delete a media item (Editor or Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Media deleted
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Media not found
 */
router.delete('/:id', requireRole('Editor'), async (req, res) => {
  try {
    await mediaService.deleteMedia(req.params.id);
    res.status(204).send();
  } catch (error) {
    if (error instanceof Error && error.message === 'Media not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

/**
 * @openapi
 * /api/media/{id}/refresh-metadata:
 *   post:
 *     tags:
 *       - Media
 *     summary: Refresh media metadata
 *     description: Queue a metadata refresh job for a media item (Editor or Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scraperId:
 *                 type: string
 *                 description: Specific scraper to use
 *               externalId:
 *                 type: string
 *                 description: External ID for the scraper
 *     responses:
 *       202:
 *         description: Metadata refresh queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 jobId:
 *                   type: string
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Media not found
 */
router.post('/:id/refresh-metadata', requireRole('Editor'), async (req, res) => {
  try {
    const media = await mediaService.getMediaById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Optional: specify a scraper and/or external ID
    const { scraperId, externalId } = req.body;

    // Extract episode context from videoDetails if available
    const videoDetails = media.videoDetails as {
      showName?: string | null
      season?: number | null
      episode?: number | null
    } | null;

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
    });

    res.status(202).json({
      message: 'Metadata refresh queued',
      jobId: job.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue metadata refresh';
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/media/{id}/refresh-images:
 *   post:
 *     tags:
 *       - Media
 *     summary: Refresh media images
 *     description: Queue an image refresh job for a media item (Editor or Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       202:
 *         description: Image refresh queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 jobId:
 *                   type: string
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Media not found
 */
router.post('/:id/refresh-images', requireRole('Editor'), async (req, res) => {
  try {
    const media = await mediaService.getMediaById(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Get existing scraper info from videoDetails or audioDetails
    let scraperId: string | undefined;
    let externalId: string | undefined;

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
    });

    res.status(202).json({
      message: 'Image refresh queued',
      jobId: job.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue image refresh';
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/media/scrapers/list:
 *   get:
 *     tags:
 *       - Media
 *     summary: Get available scrapers
 *     description: Get list of available metadata scrapers
 *     responses:
 *       200:
 *         description: List of scrapers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 scrapers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       mediaTypes:
 *                         type: array
 *                         items:
 *                           type: string
 *                           enum: [video, audio]
 */
router.get('/scrapers/list', async (_req, res) => {
  try {
    const scrapers = scraperManager.list();
    res.json({ scrapers });
  } catch {
    res.status(500).json({ error: 'Failed to get scrapers' });
  }
});

/**
 * @openapi
 * /api/media/scrapers/queue-status:
 *   get:
 *     tags:
 *       - Media
 *     summary: Get scraper queue status
 *     description: Get metadata scrape queue status (Admin only)
 *     responses:
 *       200:
 *         description: Queue status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 waiting:
 *                   type: integer
 *                 active:
 *                   type: integer
 *                 completed:
 *                   type: integer
 *                 failed:
 *                   type: integer
 *       403:
 *         description: Forbidden - Admin role required
 */
router.get('/scrapers/queue-status', requireRole('Admin'), async (_req, res) => {
  try {
    const status = await getMetadataScrapeQueueStatus();
    res.json(status);
  } catch {
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

/**
 * @openapi
 * /api/media/scrapers/search:
 *   get:
 *     tags:
 *       - Media
 *     summary: Search scrapers
 *     description: Search for metadata using scrapers (for manual matching)
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [video, audio]
 *         description: Media type to search for
 *       - in: query
 *         name: scraperId
 *         schema:
 *           type: string
 *         description: Specific scraper to use
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       scraperId:
 *                         type: string
 *                       results:
 *                         type: array
 *                         items:
 *                           type: object
 *       400:
 *         description: Query parameter is required
 */
router.get('/scrapers/search', async (req, res) => {
  try {
    const { query, type, scraperId } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const scrapers = scraperId
      ? [scraperManager.get(scraperId as string)].filter(Boolean)
      : scraperManager.getByMediaType((type as 'video' | 'audio') ?? 'video').filter((s) => s.isConfigured());

    const results: Array<{ scraperId: string; results: unknown[] }> = [];

    for (const scraper of scrapers) {
      if (!scraper) continue;

      try {
        if (type === 'audio' && scraper.searchAudio) {
          const audioResults = await scraper.searchAudio(query);
          results.push({ scraperId: scraper.id, results: audioResults });
        } else if (scraper.searchVideo) {
          const videoResults = await scraper.searchVideo(query);
          results.push({ scraperId: scraper.id, results: videoResults });
        }
      } catch (error) {
        console.error(`Search failed for scraper ${scraper.id}:`, error);
      }
    }

    res.json({ results });
  } catch {
    res.status(500).json({ error: 'Failed to search' });
  }
});

export default router;
