import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { prisma } from './config/database';
import { loadAppConfig, getScraperConfigs } from './config/appConfig';
import { MediaService } from './services/mediaService';
import { SettingsService } from './services/settingsService';
import { videoWorker } from './workers/videoWorker';
import { libraryScanWorker } from './workers/libraryScanWorker';
import { metadataScrapeWorker } from './workers/metadataScrapeWorker';
import { collectionScrapeWorker } from './workers/collectionScrapeWorker';
import { loadScrapers } from './plugins/scraperLoader';
import { redisConnection } from './config/redis';
import { swaggerSpec } from './config/swagger.js';
import { fileWatcherService } from './services/fileWatcherService';
import { hlsCacheCleanupService } from './services/hlsCacheCleanupService';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import groupRoutes from './routes/groups';
import libraryRoutes from './routes/libraries';
import collectionRoutes from './routes/collections';
import mediaRoutes from './routes/media';
import streamRoutes from './routes/stream';
import imageRoutes from './routes/images';
import personRoutes from './routes/persons';
import searchRoutes from './routes/search';
import userCollectionRoutes from './routes/userCollections';

const app = express();
const PORT = process.env.PORT || 3000;
const mediaService = new MediaService();
const settingsService = new SettingsService();

app.use(cors());
app.use(express.json());

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Tubeca API Documentation',
}));

// Auth and User routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/libraries', libraryRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/persons', personRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/user-collections', userCollectionRoutes);

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Health check endpoint
 *     description: Check if the API and database are running
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 message:
 *                   type: string
 *                   example: Tubeca API is running
 *                 database:
 *                   type: string
 *                   example: connected
 *       503:
 *         description: Database connection failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/health', async (_req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      message: 'Tubeca API is running',
      database: 'connected'
    });
  } catch {
    res.status(503).json({
      status: 'error',
      message: 'Database connection failed',
      database: 'disconnected'
    });
  }
});

/**
 * @openapi
 * /api/media:
 *   get:
 *     tags:
 *       - Media
 *     summary: Get all media
 *     description: Retrieve all media items (videos and audio)
 *     responses:
 *       200:
 *         description: List of media items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 media:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Media'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/media', async (_req, res) => {
  try {
    const media = await mediaService.getAllMedia();
    res.json({ media });
  } catch {
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

/**
 * @openapi
 * /api/media/videos:
 *   get:
 *     tags:
 *       - Media
 *     summary: Get all videos
 *     description: Retrieve all video media items
 *     responses:
 *       200:
 *         description: List of video items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 videos:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Media'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/media/videos', async (_req, res) => {
  try {
    const videos = await mediaService.getAllVideos();
    res.json({ videos });
  } catch {
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * @openapi
 * /api/media/audio:
 *   get:
 *     tags:
 *       - Media
 *     summary: Get all audio
 *     description: Retrieve all audio media items
 *     responses:
 *       200:
 *         description: List of audio items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 audio:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Media'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/media/audio', async (_req, res) => {
  try {
    const audio = await mediaService.getAllAudio();
    res.json({ audio });
  } catch {
    res.status(500).json({ error: 'Failed to fetch audio' });
  }
});

/**
 * @openapi
 * /api/media/{id}:
 *   get:
 *     tags:
 *       - Media
 *     summary: Get media by ID
 *     description: Retrieve a specific media item by its ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Media ID
 *     responses:
 *       200:
 *         description: Media item found
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
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/media/:id', async (req, res) => {
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
 * /api/media/video:
 *   post:
 *     tags:
 *       - Media
 *     summary: Create a new video
 *     description: Add a new video to the media library
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - path
 *               - duration
 *               - name
 *               - description
 *             properties:
 *               path:
 *                 type: string
 *                 description: File path
 *               duration:
 *                 type: integer
 *                 description: Duration in seconds
 *               name:
 *                 type: string
 *                 description: Video name
 *               description:
 *                 type: string
 *                 description: Video description
 *     responses:
 *       201:
 *         description: Video created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 video:
 *                   $ref: '#/components/schemas/Media'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/media/video', async (req, res) => {
  try {
    const { path, duration, name } = req.body;
    const video = await mediaService.createVideo({ path, duration, name });
    res.status(201).json({ video });
  } catch {
    res.status(500).json({ error: 'Failed to create video' });
  }
});

/**
 * @openapi
 * /api/media/audio:
 *   post:
 *     tags:
 *       - Media
 *     summary: Create a new audio
 *     description: Add a new audio file to the media library
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - path
 *               - duration
 *               - name
 *             properties:
 *               path:
 *                 type: string
 *                 description: File path
 *               duration:
 *                 type: integer
 *                 description: Duration in seconds
 *               name:
 *                 type: string
 *                 description: Audio name
 *     responses:
 *       201:
 *         description: Audio created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 audio:
 *                   $ref: '#/components/schemas/Media'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/media/audio', async (req, res) => {
  try {
    const { path, duration, name } = req.body;
    const audio = await mediaService.createAudio({ path, duration, name });
    res.status(201).json({ audio });
  } catch {
    res.status(500).json({ error: 'Failed to create audio' });
  }
});

/**
 * @openapi
 * /api/settings:
 *   get:
 *     tags:
 *       - Settings
 *     summary: Get system settings
 *     description: Retrieve system settings (creates default if none exist)
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings:
 *                   $ref: '#/components/schemas/Settings'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await settingsService.getOrCreateSettings();
    res.json({ settings });
  } catch {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * @openapi
 * /api/settings:
 *   patch:
 *     tags:
 *       - Settings
 *     summary: Update system settings
 *     description: Update system settings
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceName:
 *                 type: string
 *                 description: Instance name
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 settings:
 *                   $ref: '#/components/schemas/Settings'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.patch('/api/settings', async (req, res) => {
  try {
    const { instanceName } = req.body;
    const settings = await settingsService.updateSettings({ instanceName });
    res.json({ settings });
  } catch {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Background job endpoints

/**
 * @openapi
 * /api/jobs/transcode:
 *   post:
 *     tags:
 *       - Jobs
 *     summary: Queue a transcode job
 *     description: Queue a background job to transcode a media file
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mediaId
 *               - inputPath
 *               - outputPath
 *             properties:
 *               mediaId:
 *                 type: string
 *                 description: Media ID to transcode
 *               inputPath:
 *                 type: string
 *                 description: Input file path
 *               outputPath:
 *                 type: string
 *                 description: Output file path
 *               resolution:
 *                 type: string
 *                 description: Target resolution (e.g., "1080p", "720p")
 *               format:
 *                 type: string
 *                 description: Output format (e.g., "mp4", "webm")
 *     responses:
 *       202:
 *         description: Job queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                 message:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/jobs/transcode', async (req, res) => {
  try {
    const { mediaId, inputPath, outputPath, resolution, format } = req.body;
    const job = await mediaService.queueTranscode({ mediaId, inputPath, outputPath, resolution, format });
    res.status(202).json({ jobId: job.id, message: 'Transcode job queued' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue transcode job';
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/jobs/thumbnail:
 *   post:
 *     tags:
 *       - Jobs
 *     summary: Queue a thumbnail generation job
 *     description: Queue a background job to generate a thumbnail from a video
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mediaId
 *               - videoPath
 *               - thumbnailPath
 *             properties:
 *               mediaId:
 *                 type: string
 *                 description: Media ID
 *               videoPath:
 *                 type: string
 *                 description: Path to the video file
 *               thumbnailPath:
 *                 type: string
 *                 description: Output path for the thumbnail
 *               timestamp:
 *                 type: number
 *                 description: Timestamp in seconds to capture thumbnail
 *     responses:
 *       202:
 *         description: Job queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                 message:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/jobs/thumbnail', async (req, res) => {
  try {
    const { mediaId, videoPath, thumbnailPath, timestamp } = req.body;
    const job = await mediaService.queueThumbnail({ mediaId, videoPath, thumbnailPath, timestamp });
    res.status(202).json({ jobId: job.id, message: 'Thumbnail job queued' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue thumbnail job';
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/jobs/analyze:
 *   post:
 *     tags:
 *       - Jobs
 *     summary: Queue a media analysis job
 *     description: Queue a background job to analyze a media file (extract metadata, streams, etc.)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mediaId
 *               - filePath
 *             properties:
 *               mediaId:
 *                 type: string
 *                 description: Media ID to analyze
 *               filePath:
 *                 type: string
 *                 description: Path to the media file
 *     responses:
 *       202:
 *         description: Job queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                 message:
 *                   type: string
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/jobs/analyze', async (req, res) => {
  try {
    const { mediaId, filePath } = req.body;
    const job = await mediaService.queueAnalyze({ mediaId, filePath });
    res.status(202).json({ jobId: job.id, message: 'Analyze job queued' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue analyze job';
    res.status(500).json({ error: message });
  }
});

// Initialize scrapers and start server
async function startServer() {
  // Load application configuration
  const appConfig = loadAppConfig();

  // Initialize scraper plugins
  const scraperConfigs = getScraperConfigs(appConfig);
  await loadScrapers(scraperConfigs);

  // Start file watcher service (optional - can be controlled via config or env var)
  // Environment variable takes precedence over config file
  const watcherEnabled = process.env.FILE_WATCHER_ENABLED !== undefined
    ? process.env.FILE_WATCHER_ENABLED === 'true'
    : appConfig.fileWatcher?.enabled ?? false;
  if (watcherEnabled) {
    await fileWatcherService.start({
      usePolling: appConfig.fileWatcher?.usePolling,
      pollInterval: appConfig.fileWatcher?.pollInterval,
    });
  }

  // Start HLS cache cleanup service
  hlsCacheCleanupService.start();

  // Start HTTP server
  const server = app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    if (watcherEnabled) {
      console.log(`📁 File watcher is enabled`);
    }
  });

  return server;
}

const serverPromise = startServer();

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Shutting down gracefully...');

  // Wait for server to be initialized, then close it
  const server = await serverPromise;
  server.close(() => {
    console.log('✅ Express server closed');
  });

  // Close workers
  await videoWorker.close();
  console.log('✅ Video worker closed');

  await libraryScanWorker.close();
  console.log('✅ Library scan worker closed');

  await metadataScrapeWorker.close();
  console.log('✅ Metadata scrape worker closed');

  await collectionScrapeWorker.close();
  console.log('✅ Collection scrape worker closed');

  // Stop file watcher
  await fileWatcherService.stop();
  console.log('✅ File watcher stopped');

  // Stop HLS cache cleanup service
  hlsCacheCleanupService.stop();
  console.log('✅ HLS cache cleanup service stopped');

  // Close Redis connection
  await redisConnection.quit();
  console.log('✅ Redis connection closed');

  // Close Prisma connection
  await prisma.$disconnect();
  console.log('✅ Database connection closed');

  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
