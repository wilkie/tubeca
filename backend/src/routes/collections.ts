import { Router } from 'express'
import { CollectionService } from '../services/collectionService'
import { authenticate, requireRole } from '../middleware/auth'
import { addCollectionScrapeJob, type CollectionScrapeType } from '../queues/collectionScrapeQueue'

const router = Router()
const collectionService = new CollectionService()

// All routes require authentication
router.use(authenticate)

// Get all collections for a library
router.get('/library/:libraryId', async (req, res) => {
  try {
    const collections = await collectionService.getCollectionsByLibrary(req.params.libraryId)
    res.json({ collections })
  } catch {
    res.status(500).json({ error: 'Failed to fetch collections' })
  }
})

// Get a single collection
router.get('/:id', async (req, res) => {
  try {
    const collection = await collectionService.getCollectionById(req.params.id)
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' })
    }
    res.json({ collection })
  } catch {
    res.status(500).json({ error: 'Failed to fetch collection' })
  }
})

// Create a collection (Admin/Editor only)
router.post('/', requireRole('Editor'), async (req, res) => {
  try {
    const { name, libraryId, parentId } = req.body

    if (!name || !libraryId) {
      return res.status(400).json({ error: 'Name and libraryId are required' })
    }

    const collection = await collectionService.createCollection({
      name,
      libraryId,
      parentId,
    })
    res.status(201).json({ collection })
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message })
    } else {
      res.status(500).json({ error: 'Failed to create collection' })
    }
  }
})

// Update a collection (Admin/Editor only)
router.patch('/:id', requireRole('Editor'), async (req, res) => {
  try {
    const { name, parentId } = req.body
    const collection = await collectionService.updateCollection(req.params.id, {
      name,
      parentId,
    })
    res.json({ collection })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Collection not found') {
        return res.status(404).json({ error: error.message })
      }
      res.status(400).json({ error: error.message })
    } else {
      res.status(500).json({ error: 'Failed to update collection' })
    }
  }
})

// Delete a collection (Admin/Editor only)
router.delete('/:id', requireRole('Editor'), async (req, res) => {
  try {
    await collectionService.deleteCollection(req.params.id)
    res.status(204).send()
  } catch {
    res.status(500).json({ error: 'Failed to delete collection' })
  }
})

// Refresh metadata for a collection (Admin/Editor only)
router.post('/:id/refresh-metadata', requireRole('Editor'), async (req, res) => {
  try {
    const collection = await collectionService.getCollectionById(req.params.id)
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    // Check if collection type is scrapeable
    const scrapeableTypes: CollectionScrapeType[] = ['Show', 'Season', 'Film', 'Artist', 'Album']
    if (!scrapeableTypes.includes(collection.collectionType as CollectionScrapeType)) {
      return res.status(400).json({ error: 'This collection type does not support metadata scraping' })
    }

    // Get existing scraper info if available
    let scraperId: string | undefined
    let externalId: string | undefined
    let seasonNumber: number | undefined

    if (collection.showDetails) {
      scraperId = collection.showDetails.scraperId ?? undefined
      externalId = collection.showDetails.externalId ?? undefined
    } else if (collection.seasonDetails) {
      scraperId = collection.seasonDetails.scraperId ?? undefined
      externalId = collection.seasonDetails.externalId ?? undefined
      seasonNumber = collection.seasonDetails.seasonNumber ?? undefined
    } else if (collection.artistDetails) {
      scraperId = collection.artistDetails.scraperId ?? undefined
      externalId = collection.artistDetails.externalId ?? undefined
    } else if (collection.albumDetails) {
      scraperId = collection.albumDetails.scraperId ?? undefined
      externalId = collection.albumDetails.externalId ?? undefined
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

// Refresh images for a collection (Admin/Editor only)
router.post('/:id/refresh-images', requireRole('Editor'), async (req, res) => {
  try {
    const collection = await collectionService.getCollectionById(req.params.id)
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    // Check if collection type is scrapeable
    const scrapeableTypes: CollectionScrapeType[] = ['Show', 'Season', 'Film', 'Artist', 'Album']
    if (!scrapeableTypes.includes(collection.collectionType as CollectionScrapeType)) {
      return res.status(400).json({ error: 'This collection type does not support image scraping' })
    }

    // Get existing scraper info if available
    let scraperId: string | undefined
    let externalId: string | undefined
    let seasonNumber: number | undefined

    if (collection.showDetails) {
      scraperId = collection.showDetails.scraperId ?? undefined
      externalId = collection.showDetails.externalId ?? undefined
    } else if (collection.seasonDetails) {
      scraperId = collection.seasonDetails.scraperId ?? undefined
      externalId = collection.seasonDetails.externalId ?? undefined
      seasonNumber = collection.seasonDetails.seasonNumber ?? undefined
    } else if (collection.artistDetails) {
      scraperId = collection.artistDetails.scraperId ?? undefined
      externalId = collection.artistDetails.externalId ?? undefined
    } else if (collection.albumDetails) {
      scraperId = collection.albumDetails.scraperId ?? undefined
      externalId = collection.albumDetails.externalId ?? undefined
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

export default router
