import { Router } from 'express';
import { CollectionService } from '../services/collectionService';
import { authenticate, requireRole } from '../middleware/auth';
import { addCollectionScrapeJob, type CollectionScrapeType } from '../queues/collectionScrapeQueue';

const router = Router();
const collectionService = new CollectionService();

// All routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/collections/library/{libraryId}:
 *   get:
 *     tags:
 *       - Collections
 *     summary: Get collections by library (paginated)
 *     description: Get paginated root collections for a specific library with optional sorting and filtering
 *     parameters:
 *       - in: path
 *         name: libraryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-indexed)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of items per page
 *       - in: query
 *         name: sortField
 *         schema:
 *           type: string
 *           enum: [name, dateAdded, releaseDate, rating, runtime]
 *           default: name
 *         description: Field to sort by
 *       - in: query
 *         name: sortDirection
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Sort direction
 *       - in: query
 *         name: excludedRatings
 *         schema:
 *           type: string
 *         description: Comma-separated list of content ratings to exclude
 *       - in: query
 *         name: keywordIds
 *         schema:
 *           type: string
 *         description: Comma-separated list of keyword IDs to filter by (AND logic)
 *     responses:
 *       200:
 *         description: Paginated list of collections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 collections:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Collection'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 hasMore:
 *                   type: boolean
 *       500:
 *         description: Server error
 */
router.get('/library/:libraryId', async (req, res) => {
  try {
    const { libraryId } = req.params;
    const {
      page,
      limit,
      sortField,
      sortDirection,
      excludedRatings,
      keywordIds,
    } = req.query;

    const result = await collectionService.getPaginatedCollections({
      libraryId,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      sortField: sortField as 'name' | 'dateAdded' | 'releaseDate' | 'rating' | 'runtime' | undefined,
      sortDirection: sortDirection as 'asc' | 'desc' | undefined,
      excludedRatings: excludedRatings ? (excludedRatings as string).split(',') : undefined,
      keywordIds: keywordIds ? (keywordIds as string).split(',') : undefined,
    });

    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

/**
 * @openapi
 * /api/collections/library/{libraryId}/keywords:
 *   get:
 *     tags:
 *       - Collections
 *     summary: Get keywords for a library
 *     description: Get all unique keywords used by collections in a library
 *     parameters:
 *       - in: path
 *         name: libraryId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of keywords
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 keywords:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *       500:
 *         description: Server error
 */
router.get('/library/:libraryId/keywords', async (req, res) => {
  try {
    const keywords = await collectionService.getKeywordsByLibrary(req.params.libraryId);
    res.json({ keywords });
  } catch {
    res.status(500).json({ error: 'Failed to fetch keywords' });
  }
});

/**
 * @openapi
 * /api/collections/{id}:
 *   get:
 *     tags:
 *       - Collections
 *     summary: Get a collection
 *     description: Get a single collection by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Collection found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 collection:
 *                   $ref: '#/components/schemas/Collection'
 *       404:
 *         description: Collection not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', async (req, res) => {
  try {
    const collection = await collectionService.getCollectionById(req.params.id);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json({ collection });
  } catch {
    res.status(500).json({ error: 'Failed to fetch collection' });
  }
});

/**
 * @openapi
 * /api/collections:
 *   post:
 *     tags:
 *       - Collections
 *     summary: Create a collection
 *     description: Create a new collection (Editor or Admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - libraryId
 *             properties:
 *               name:
 *                 type: string
 *               libraryId:
 *                 type: string
 *                 format: uuid
 *               parentId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Collection created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 collection:
 *                   $ref: '#/components/schemas/Collection'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - Editor role required
 */
router.post('/', requireRole('Editor'), async (req, res) => {
  try {
    const { name, libraryId, parentId } = req.body;

    if (!name || !libraryId) {
      return res.status(400).json({ error: 'Name and libraryId are required' });
    }

    const collection = await collectionService.createCollection({
      name,
      libraryId,
      parentId,
    });
    res.status(201).json({ collection });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to create collection' });
    }
  }
});

/**
 * @openapi
 * /api/collections/{id}:
 *   patch:
 *     tags:
 *       - Collections
 *     summary: Update a collection
 *     description: Update an existing collection (Editor or Admin only)
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
 *               name:
 *                 type: string
 *               parentId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Collection updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 collection:
 *                   $ref: '#/components/schemas/Collection'
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Collection not found
 */
router.patch('/:id', requireRole('Editor'), async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const collection = await collectionService.updateCollection(req.params.id, {
      name,
      parentId,
    });
    res.json({ collection });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Collection not found') {
        return res.status(404).json({ error: error.message });
      }
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to update collection' });
    }
  }
});

/**
 * @openapi
 * /api/collections/{id}:
 *   delete:
 *     tags:
 *       - Collections
 *     summary: Delete a collection
 *     description: Delete a collection (Editor or Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Collection deleted
 *       403:
 *         description: Forbidden - Editor role required
 *       500:
 *         description: Server error
 */
router.delete('/:id', requireRole('Editor'), async (req, res) => {
  try {
    await collectionService.deleteCollection(req.params.id);
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

/**
 * @openapi
 * /api/collections/{id}/refresh-metadata:
 *   post:
 *     tags:
 *       - Collections
 *     summary: Refresh collection metadata
 *     description: Queue a metadata refresh job for a collection (Editor or Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *       400:
 *         description: Collection type does not support metadata scraping
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Collection not found
 */
router.post('/:id/refresh-metadata', requireRole('Editor'), async (req, res) => {
  try {
    const collection = await collectionService.getCollectionById(req.params.id);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Check if collection type is scrapeable
    const scrapeableTypes: CollectionScrapeType[] = ['Show', 'Season', 'Film', 'Artist', 'Album'];
    if (!scrapeableTypes.includes(collection.collectionType as CollectionScrapeType)) {
      return res.status(400).json({ error: 'This collection type does not support metadata scraping' });
    }

    // Get existing scraper info if available
    let scraperId: string | undefined;
    let externalId: string | undefined;
    let seasonNumber: number | undefined;

    if (collection.showDetails) {
      scraperId = collection.showDetails.scraperId ?? undefined;
      externalId = collection.showDetails.externalId ?? undefined;
    } else if (collection.seasonDetails) {
      scraperId = collection.seasonDetails.scraperId ?? undefined;
      externalId = collection.seasonDetails.externalId ?? undefined;
      seasonNumber = collection.seasonDetails.seasonNumber ?? undefined;
    } else if (collection.filmDetails) {
      scraperId = collection.filmDetails.scraperId ?? undefined;
      externalId = collection.filmDetails.externalId ?? undefined;
    } else if (collection.artistDetails) {
      scraperId = collection.artistDetails.scraperId ?? undefined;
      externalId = collection.artistDetails.externalId ?? undefined;
    } else if (collection.albumDetails) {
      scraperId = collection.albumDetails.scraperId ?? undefined;
      externalId = collection.albumDetails.externalId ?? undefined;
    }

    const job = await addCollectionScrapeJob({
      collectionId: collection.id,
      collectionName: collection.name,
      collectionType: collection.collectionType as CollectionScrapeType,
      parentShowId: collection.parentId ?? undefined,
      seasonNumber,
      scraperId,
      externalId,
      skipImages: true, // Don't replace images on metadata refresh
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
 * /api/collections/{id}/refresh-images:
 *   post:
 *     tags:
 *       - Collections
 *     summary: Refresh collection images
 *     description: Queue an image refresh job for a collection (Editor or Admin only)
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
 *       400:
 *         description: Collection type does not support image scraping
 *       403:
 *         description: Forbidden - Editor role required
 *       404:
 *         description: Collection not found
 */
router.post('/:id/refresh-images', requireRole('Editor'), async (req, res) => {
  try {
    const collection = await collectionService.getCollectionById(req.params.id);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Check if collection type is scrapeable
    const scrapeableTypes: CollectionScrapeType[] = ['Show', 'Season', 'Film', 'Artist', 'Album'];
    if (!scrapeableTypes.includes(collection.collectionType as CollectionScrapeType)) {
      return res.status(400).json({ error: 'This collection type does not support image scraping' });
    }

    // Get existing scraper info if available
    let scraperId: string | undefined;
    let externalId: string | undefined;
    let seasonNumber: number | undefined;

    if (collection.showDetails) {
      scraperId = collection.showDetails.scraperId ?? undefined;
      externalId = collection.showDetails.externalId ?? undefined;
    } else if (collection.seasonDetails) {
      scraperId = collection.seasonDetails.scraperId ?? undefined;
      externalId = collection.seasonDetails.externalId ?? undefined;
      seasonNumber = collection.seasonDetails.seasonNumber ?? undefined;
    } else if (collection.filmDetails) {
      scraperId = collection.filmDetails.scraperId ?? undefined;
      externalId = collection.filmDetails.externalId ?? undefined;
    } else if (collection.artistDetails) {
      scraperId = collection.artistDetails.scraperId ?? undefined;
      externalId = collection.artistDetails.externalId ?? undefined;
    } else if (collection.albumDetails) {
      scraperId = collection.albumDetails.scraperId ?? undefined;
      externalId = collection.albumDetails.externalId ?? undefined;
    }

    const job = await addCollectionScrapeJob({
      collectionId: collection.id,
      collectionName: collection.name,
      collectionType: collection.collectionType as CollectionScrapeType,
      parentShowId: collection.parentId ?? undefined,
      seasonNumber,
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

export default router;
