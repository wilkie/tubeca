import { Router } from 'express'
import { authenticate, requireRole } from '../middleware/auth'
import { LibraryService } from '../services/libraryService'
import {
  addLibraryScanJob,
  getLibraryScanJob,
  cancelLibraryScanJob,
} from '../queues/libraryScanQueue'

const router = Router()
const libraryService = new LibraryService()

// All library routes require authentication
router.use(authenticate)

// Get all libraries
router.get('/', async (_req, res) => {
  try {
    const libraries = await libraryService.getAllLibraries()
    res.json({ libraries })
  } catch {
    res.status(500).json({ error: 'Failed to fetch libraries' })
  }
})

// Get a single library
router.get('/:id', async (req, res) => {
  try {
    const library = await libraryService.getLibraryById(req.params.id)
    if (!library) {
      return res.status(404).json({ error: 'Library not found' })
    }
    res.json({ library })
  } catch {
    res.status(500).json({ error: 'Failed to fetch library' })
  }
})

// Create a new library (Admin only)
router.post('/', requireRole('Admin'), async (req, res) => {
  try {
    const { name, path, libraryType, groupIds } = req.body

    if (!name || !path || !libraryType) {
      return res.status(400).json({ error: 'Name, path, and libraryType are required' })
    }

    if (!['Television', 'Film', 'Music'].includes(libraryType)) {
      return res.status(400).json({ error: 'Invalid libraryType. Must be Television, Film, or Music' })
    }

    const library = await libraryService.createLibrary({
      name,
      path,
      libraryType,
      groupIds,
    })
    res.status(201).json({ library })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create library'
    res.status(400).json({ error: message })
  }
})

// Update a library (Admin only)
router.patch('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const { name, path, libraryType, groupIds } = req.body

    if (libraryType && !['Television', 'Film', 'Music'].includes(libraryType)) {
      return res.status(400).json({ error: 'Invalid libraryType. Must be Television, Film, or Music' })
    }

    const library = await libraryService.updateLibrary(req.params.id, {
      name,
      path,
      libraryType,
      groupIds,
    })
    res.json({ library })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update library'
    res.status(400).json({ error: message })
  }
})

// Delete a library (Admin only)
router.delete('/:id', requireRole('Admin'), async (req, res) => {
  try {
    await libraryService.deleteLibrary(req.params.id)
    res.status(204).send()
  } catch {
    res.status(500).json({ error: 'Failed to delete library' })
  }
})

// Start a library scan (Admin only)
router.post('/:id/scan', requireRole('Admin'), async (req, res) => {
  try {
    const library = await libraryService.getLibraryById(req.params.id)
    if (!library) {
      return res.status(404).json({ error: 'Library not found' })
    }

    // Check if scan is already in progress
    const existingJob = await getLibraryScanJob(req.params.id)
    if (existingJob) {
      const state = await existingJob.getState()
      if (state === 'active' || state === 'waiting') {
        return res.status(409).json({
          error: 'Scan already in progress',
          jobId: existingJob.id,
          state,
        })
      }
    }

    const job = await addLibraryScanJob({
      libraryId: library.id,
      libraryPath: library.path,
      libraryName: library.name,
    })

    res.status(202).json({
      message: 'Scan started',
      jobId: job.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start scan'
    res.status(500).json({ error: message })
  }
})

// Get scan status for a library
router.get('/:id/scan', async (req, res) => {
  try {
    const job = await getLibraryScanJob(req.params.id)
    if (!job) {
      return res.json({
        status: 'idle',
        scanning: false,
      })
    }

    const state = await job.getState()
    const progress = job.progress as number
    const result = job.returnvalue

    res.json({
      status: state,
      scanning: state === 'active' || state === 'waiting',
      progress: typeof progress === 'number' ? progress : 0,
      result: state === 'completed' ? result : undefined,
      failedReason: state === 'failed' ? job.failedReason : undefined,
    })
  } catch {
    res.status(500).json({ error: 'Failed to get scan status' })
  }
})

// Cancel a library scan (Admin only)
router.delete('/:id/scan', requireRole('Admin'), async (req, res) => {
  try {
    const result = await cancelLibraryScanJob(req.params.id)
    if (result.cancelled) {
      res.json({
        message: 'Scan cancelled',
        wasActive: result.wasActive,
      })
    } else {
      res.status(404).json({ error: 'No active scan found' })
    }
  } catch {
    res.status(500).json({ error: 'Failed to cancel scan' })
  }
})

export default router
