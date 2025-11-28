import { Router } from 'express'
import { CollectionService } from '../services/collectionService'
import { authenticate, requireRole } from '../middleware/auth'

const router = Router()
const collectionService = new CollectionService()

// All routes require authentication
router.use(authenticate)

// Get all collections for a library
router.get('/library/:libraryId', async (req, res) => {
  try {
    const collections = await collectionService.getCollectionsByLibrary(req.params.libraryId)
    res.json({ collections })
  } catch (error) {
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
  } catch (error) {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete collection' })
  }
})

export default router
