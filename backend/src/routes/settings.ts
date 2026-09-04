import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { SettingsService } from '../services/settingsService';
import {
  getTranscodingSettingsWithInfo,
  updateTranscodingSettings,
  validateTranscodingSettings,
} from '../services/transcodingSettingsService';

const router = Router();
const settingsService = new SettingsService();

/** What a fresh instance calls itself until someone renames it. */
const DEFAULT_INSTANCE_NAME = 'Tubeca';

// All settings routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/settings:
 *   get:
 *     tags:
 *       - Settings
 *     summary: Get instance settings
 *     description: Get general instance settings
 *     responses:
 *       200:
 *         description: Instance settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings:
 *                   type: object
 *                   properties:
 *                     instanceName:
 *                       type: string
 */
router.get('/', async (_req, res) => {
  try {
    const settings = await settingsService.getOrCreateSettings(DEFAULT_INSTANCE_NAME);
    res.json({ settings });
  } catch {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * @openapi
 * /api/settings:
 *   put:
 *     tags:
 *       - Settings
 *     summary: Update instance settings
 *     description: Update general instance settings (Admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated settings
 */
const updateInstanceSettings = async (req: Request, res: Response) => {
  try {
    const { instanceName } = req.body;

    // A request that names nothing still has to answer with the settings, so it
    // falls back to the same find-or-create the GET does.
    const settings = instanceName
      ? await settingsService.updateInstanceName(instanceName)
      : await settingsService.getOrCreateSettings(DEFAULT_INSTANCE_NAME);

    res.json({ settings });
  } catch {
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

router.put('/', requireRole('Admin'), updateInstanceSettings);

/**
 * @openapi
 * /api/settings:
 *   patch:
 *     tags:
 *       - Settings
 *     summary: Update settings
 *     description: Partially update instance settings (Admin only). Same semantics as PUT.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated settings
 *       403:
 *         description: Admin role required
 */
router.patch('/', requireRole('Admin'), updateInstanceSettings);

/**
 * @openapi
 * /api/settings/transcoding:
 *   get:
 *     tags:
 *       - Settings
 *     summary: Get transcoding settings
 *     description: Get transcoding/encoding settings with detected encoder info (Admin only)
 *     responses:
 *       200:
 *         description: Transcoding settings with runtime info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings:
 *                   type: object
 *                   properties:
 *                     enableHardwareAccel:
 *                       type: boolean
 *                     preferredEncoder:
 *                       type: string
 *                       nullable: true
 *                     preset:
 *                       type: string
 *                     enableLowLatency:
 *                       type: boolean
 *                     threadCount:
 *                       type: integer
 *                     segmentDuration:
 *                       type: integer
 *                     prefetchSegments:
 *                       type: integer
 *                     bitrate1080p:
 *                       type: integer
 *                     bitrate720p:
 *                       type: integer
 *                     bitrate480p:
 *                       type: integer
 *                     bitrate360p:
 *                       type: integer
 *                     detectedEncoder:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         encoder:
 *                           type: string
 *                         type:
 *                           type: string
 *                           enum: [hardware, software]
 *                     activeEncoder:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         encoder:
 *                           type: string
 *                         type:
 *                           type: string
 *                           enum: [hardware, software]
 *                     availablePresets:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.get('/transcoding', requireRole('Admin'), async (_req, res) => {
  try {
    const settings = await getTranscodingSettingsWithInfo();
    res.json({ settings });
  } catch (error) {
    console.error('Failed to fetch transcoding settings:', error);
    res.status(500).json({ error: 'Failed to fetch transcoding settings' });
  }
});

/**
 * @openapi
 * /api/settings/transcoding:
 *   put:
 *     tags:
 *       - Settings
 *     summary: Update transcoding settings
 *     description: Update transcoding/encoding settings (Admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enableHardwareAccel:
 *                 type: boolean
 *               preferredEncoder:
 *                 type: string
 *                 nullable: true
 *                 description: Encoder id to pin, or null to let detection choose
 *               preset:
 *                 type: string
 *                 description: One of the presets listed by GET /api/settings/transcoding
 *               enableLowLatency:
 *                 type: boolean
 *               threadCount:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 64
 *               maxConcurrentTranscodes:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 16
 *               segmentDuration:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 30
 *                 description: Seconds. Changing this purges the segment cache.
 *               prefetchSegments:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 10
 *               bitrate1080p:
 *                 type: integer
 *                 minimum: 100
 *                 maximum: 100000
 *               bitrate720p:
 *                 type: integer
 *                 minimum: 100
 *                 maximum: 100000
 *               bitrate480p:
 *                 type: integer
 *                 minimum: 100
 *                 maximum: 100000
 *               bitrate360p:
 *                 type: integer
 *                 minimum: 100
 *                 maximum: 100000
 *     responses:
 *       200:
 *         description: Updated transcoding settings
 *       400:
 *         description: A field was missing, the wrong type, or out of range
 */
router.put('/transcoding', requireRole('Admin'), async (req, res) => {
  try {
    // These values become FFmpeg arguments and playlist arithmetic, so a bad
    // one is rejected here rather than breaking playback later.
    const { data, errors } = validateTranscodingSettings(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Invalid transcoding settings',
        details: errors,
      });
    }

    await updateTranscodingSettings(data);

    // Return updated settings with info
    const settings = await getTranscodingSettingsWithInfo();
    res.json({ settings });
  } catch (error) {
    console.error('Failed to update transcoding settings:', error);
    res.status(500).json({ error: 'Failed to update transcoding settings' });
  }
});

export default router;
