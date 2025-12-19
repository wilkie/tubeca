import { Router } from 'express';
import { prisma } from '../config/database';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getTranscodingSettingsWithInfo,
  updateTranscodingSettings,
} from '../services/transcodingSettingsService';

const router = Router();

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
    let settings = await prisma.settings.findFirst();

    if (!settings) {
      settings = await prisma.settings.create({
        data: { instanceName: 'Tubeca' },
      });
    }

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
router.put('/', requireRole('Admin'), async (req, res) => {
  try {
    const { instanceName } = req.body;

    let settings = await prisma.settings.findFirst();

    if (!settings) {
      settings = await prisma.settings.create({
        data: { instanceName: instanceName || 'Tubeca' },
      });
    } else {
      settings = await prisma.settings.update({
        where: { id: settings.id },
        data: { instanceName },
      });
    }

    res.json({ settings });
  } catch {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

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
 *               preset:
 *                 type: string
 *               enableLowLatency:
 *                 type: boolean
 *               threadCount:
 *                 type: integer
 *               segmentDuration:
 *                 type: integer
 *               prefetchSegments:
 *                 type: integer
 *               bitrate1080p:
 *                 type: integer
 *               bitrate720p:
 *                 type: integer
 *               bitrate480p:
 *                 type: integer
 *               bitrate360p:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Updated transcoding settings
 */
router.put('/transcoding', requireRole('Admin'), async (req, res) => {
  try {
    const {
      enableHardwareAccel,
      preferredEncoder,
      preset,
      enableLowLatency,
      threadCount,
      maxConcurrentTranscodes,
      segmentDuration,
      prefetchSegments,
      bitrate1080p,
      bitrate720p,
      bitrate480p,
      bitrate360p,
    } = req.body;

    await updateTranscodingSettings({
      enableHardwareAccel,
      preferredEncoder,
      preset,
      enableLowLatency,
      threadCount,
      maxConcurrentTranscodes,
      segmentDuration,
      prefetchSegments,
      bitrate1080p,
      bitrate720p,
      bitrate480p,
      bitrate360p,
    });

    // Return updated settings with info
    const settings = await getTranscodingSettingsWithInfo();
    res.json({ settings });
  } catch (error) {
    console.error('Failed to update transcoding settings:', error);
    res.status(500).json({ error: 'Failed to update transcoding settings' });
  }
});

export default router;
