import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { LibraryService } from '../services/libraryService';
import { fileWatcherService } from '../services/fileWatcherService';
import {
  addLibraryScanJob,
  getLibraryScanJob,
  cancelLibraryScanJob,
} from '../queues/libraryScanQueue';

const router = Router();
const libraryService = new LibraryService();

// All library routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/libraries:
 *   get:
 *     tags:
 *       - Libraries
 *     summary: Get all accessible libraries
 *     description: Get all media libraries the user has access to. Admins see all libraries. Other users see public libraries (no groups assigned) and libraries where they're a member of at least one assigned group.
 *     responses:
 *       200:
 *         description: List of libraries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 libraries:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Library'
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'Admin';
    const libraries = await libraryService.getAccessibleLibraries(userId, isAdmin);
    res.json({ libraries });
  } catch {
    res.status(500).json({ error: 'Failed to fetch libraries' });
  }
});

/**
 * @openapi
 * /api/libraries/{id}:
 *   get:
 *     tags:
 *       - Libraries
 *     summary: Get a library
 *     description: Get a single library by ID. Returns 404 if the library doesn't exist or the user doesn't have access.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Library found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 library:
 *                   $ref: '#/components/schemas/Library'
 *       404:
 *         description: Library not found or access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'Admin';

    // Check if user can access this library
    const canAccess = await libraryService.canUserAccessLibrary(userId, isAdmin, req.params.id);
    if (!canAccess) {
      return res.status(404).json({ error: 'Library not found' });
    }

    const library = await libraryService.getLibraryById(req.params.id);
    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }
    res.json({ library });
  } catch {
    res.status(500).json({ error: 'Failed to fetch library' });
  }
});

/**
 * @openapi
 * /api/libraries:
 *   post:
 *     tags:
 *       - Libraries
 *     summary: Create a library
 *     description: Create a new media library (Admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - path
 *               - libraryType
 *             properties:
 *               name:
 *                 type: string
 *               path:
 *                 type: string
 *               libraryType:
 *                 type: string
 *                 enum: [Television, Film, Music]
 *               watchForChanges:
 *                 type: boolean
 *                 description: Watch for filesystem changes and auto-import new media
 *               groupIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       201:
 *         description: Library created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 library:
 *                   $ref: '#/components/schemas/Library'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - Admin role required
 */
router.post('/', requireRole('Admin'), async (req, res) => {
  try {
    const { name, path, libraryType, groupIds, watchForChanges } = req.body;

    if (!name || !path || !libraryType) {
      return res.status(400).json({ error: 'Name, path, and libraryType are required' });
    }

    if (!['Television', 'Film', 'Music'].includes(libraryType)) {
      return res.status(400).json({ error: 'Invalid libraryType. Must be Television, Film, or Music' });
    }

    const library = await libraryService.createLibrary({
      name,
      path,
      libraryType,
      groupIds,
      watchForChanges,
    });

    // Sync file watcher to pick up changes
    await fileWatcherService.sync();

    res.status(201).json({ library });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create library';
    res.status(400).json({ error: message });
  }
});

/**
 * @openapi
 * /api/libraries/{id}:
 *   patch:
 *     tags:
 *       - Libraries
 *     summary: Update a library
 *     description: Update an existing library (Admin only)
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
 *               path:
 *                 type: string
 *               libraryType:
 *                 type: string
 *                 enum: [Television, Film, Music]
 *               watchForChanges:
 *                 type: boolean
 *                 description: Watch for filesystem changes and auto-import new media
 *               groupIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Library updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 library:
 *                   $ref: '#/components/schemas/Library'
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Forbidden - Admin role required
 */
router.patch('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const { name, path, libraryType, groupIds, watchForChanges } = req.body;

    if (libraryType && !['Television', 'Film', 'Music'].includes(libraryType)) {
      return res.status(400).json({ error: 'Invalid libraryType. Must be Television, Film, or Music' });
    }

    const library = await libraryService.updateLibrary(req.params.id, {
      name,
      path,
      libraryType,
      groupIds,
      watchForChanges,
    });

    // Sync file watcher to pick up changes
    await fileWatcherService.sync();

    res.json({ library });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update library';
    res.status(400).json({ error: message });
  }
});

/**
 * @openapi
 * /api/libraries/{id}:
 *   delete:
 *     tags:
 *       - Libraries
 *     summary: Delete a library
 *     description: Delete a library and all its contents (Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Library deleted
 *       403:
 *         description: Forbidden - Admin role required
 *       500:
 *         description: Server error
 */
router.delete('/:id', requireRole('Admin'), async (req, res) => {
  try {
    // Stop watching this library if it was being watched
    await fileWatcherService.unwatchLibrary(req.params.id);

    await libraryService.deleteLibrary(req.params.id);
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Failed to delete library' });
  }
});

/**
 * @openapi
 * /api/libraries/{id}/scan:
 *   post:
 *     tags:
 *       - Libraries
 *     summary: Start library scan
 *     description: Start scanning a library for media files (Admin only). Use fullScan to re-scrape metadata for all existing items.
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
 *               fullScan:
 *                 type: boolean
 *                 description: If true, re-scrape metadata for all existing items
 *     responses:
 *       202:
 *         description: Scan started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 jobId:
 *                   type: string
 *       404:
 *         description: Library not found
 *       409:
 *         description: Scan already in progress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 jobId:
 *                   type: string
 *                 state:
 *                   type: string
 */
router.post('/:id/scan', requireRole('Admin'), async (req, res) => {
  try {
    const { fullScan } = req.body || {};
    const library = await libraryService.getLibraryById(req.params.id);
    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Check if scan is already in progress
    const existingJob = await getLibraryScanJob(req.params.id);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'active' || state === 'waiting') {
        return res.status(409).json({
          error: 'Scan already in progress',
          jobId: existingJob.id,
          state,
        });
      }
    }

    const job = await addLibraryScanJob({
      libraryId: library.id,
      libraryPath: library.path,
      libraryName: library.name,
      fullScan: !!fullScan,
    });

    res.status(202).json({
      message: fullScan ? 'Full scan started' : 'Scan started',
      jobId: job.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start scan';
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/libraries/{id}/scan:
 *   get:
 *     tags:
 *       - Libraries
 *     summary: Get scan status
 *     description: Get the current scan status for a library
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Scan status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ScanStatus'
 */
router.get('/:id/scan', async (req, res) => {
  try {
    const job = await getLibraryScanJob(req.params.id);
    if (!job) {
      return res.json({
        status: 'idle',
        scanning: false,
      });
    }

    const state = await job.getState();
    const progress = job.progress as number;
    const result = job.returnvalue;

    res.json({
      status: state,
      scanning: state === 'active' || state === 'waiting',
      progress: typeof progress === 'number' ? progress : 0,
      result: state === 'completed' ? result : undefined,
      failedReason: state === 'failed' ? job.failedReason : undefined,
    });
  } catch {
    res.status(500).json({ error: 'Failed to get scan status' });
  }
});

/**
 * @openapi
 * /api/libraries/{id}/scan:
 *   delete:
 *     tags:
 *       - Libraries
 *     summary: Cancel library scan
 *     description: Cancel an in-progress library scan (Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Scan cancelled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 wasActive:
 *                   type: boolean
 *       404:
 *         description: No active scan found
 */
router.delete('/:id/scan', requireRole('Admin'), async (req, res) => {
  try {
    const result = await cancelLibraryScanJob(req.params.id);
    if (result.cancelled) {
      res.json({
        message: 'Scan cancelled',
        wasActive: result.wasActive,
      });
    } else {
      res.status(404).json({ error: 'No active scan found' });
    }
  } catch {
    res.status(500).json({ error: 'Failed to cancel scan' });
  }
});

export default router;
