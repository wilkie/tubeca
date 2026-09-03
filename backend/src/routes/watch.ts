import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireLibraryAccess, mediaParam } from '../middleware/libraryAccess';
import { WatchProgressService } from '../services/watchProgressService';

const router = Router();
const watchProgressService = new WatchProgressService();
const mediaAccess = requireLibraryAccess(mediaParam('mediaId'));

router.use(authenticate);

/**
 * @openapi
 * /api/watch/continue:
 *   get:
 *     tags:
 *       - Watch Progress
 *     summary: Continue watching
 *     description: Media the current user has started but not finished, most recent first.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: In-progress items with their media
 */
// NOTE: registered before /:mediaId so "continue" is not taken as an id.
router.get('/continue', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
    const rows = await watchProgressService.getContinueWatching(
      req.user!.userId,
      req.user!.role === 'Admin',
      limit
    );
    const items = rows.map(({ media, ...progress }) => ({ progress, media }));
    res.json({ items });
  } catch {
    res.status(500).json({ error: 'Failed to fetch continue watching' });
  }
});

/**
 * @openapi
 * /api/watch/{mediaId}:
 *   get:
 *     tags:
 *       - Watch Progress
 *     summary: Get watch progress for a media item
 *     parameters:
 *       - in: path
 *         name: mediaId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Progress, or null when never played
 *   put:
 *     tags:
 *       - Watch Progress
 *     summary: Report a playback position
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [position]
 *             properties:
 *               position:
 *                 type: number
 *                 description: Seconds from the start
 *               duration:
 *                 type: number
 *                 description: Duration in seconds, if the player knows a better value than the stored one
 *     responses:
 *       200:
 *         description: Updated progress
 *       400:
 *         description: Invalid position
 *       404:
 *         description: Media not found or not accessible
 *   delete:
 *     tags:
 *       - Watch Progress
 *     summary: Clear progress (mark as unwatched)
 *     responses:
 *       204:
 *         description: Cleared
 */
router.get('/:mediaId', mediaAccess, async (req, res) => {
  try {
    const progress = await watchProgressService.getProgress(req.user!.userId, req.params.mediaId);
    res.json({ progress });
  } catch {
    res.status(500).json({ error: 'Failed to fetch watch progress' });
  }
});

router.put('/:mediaId', mediaAccess, async (req, res) => {
  const { position, duration } = req.body ?? {};
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
    return res.status(400).json({ error: 'position must be a non-negative number of seconds' });
  }
  if (duration !== undefined && (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)) {
    return res.status(400).json({ error: 'duration must be a non-negative number of seconds' });
  }
  try {
    const progress = await watchProgressService.recordProgress(
      req.user!.userId,
      req.params.mediaId,
      position,
      duration
    );
    if (!progress) {
      return res.status(404).json({ error: 'Media not found' });
    }
    res.json({ progress });
  } catch {
    res.status(500).json({ error: 'Failed to record watch progress' });
  }
});

/**
 * @openapi
 * /api/watch/{mediaId}/complete:
 *   post:
 *     tags:
 *       - Watch Progress
 *     summary: Mark a media item as watched
 *     responses:
 *       200:
 *         description: Updated progress
 */
router.post('/:mediaId/complete', mediaAccess, async (req, res) => {
  try {
    const progress = await watchProgressService.markCompleted(req.user!.userId, req.params.mediaId);
    if (!progress) {
      return res.status(404).json({ error: 'Media not found' });
    }
    res.json({ progress });
  } catch {
    res.status(500).json({ error: 'Failed to mark as watched' });
  }
});

router.delete('/:mediaId', mediaAccess, async (req, res) => {
  try {
    await watchProgressService.clearProgress(req.user!.userId, req.params.mediaId);
    res.status(204).end();
  } catch {
    res.status(500).json({ error: 'Failed to clear watch progress' });
  }
});

export default router;
