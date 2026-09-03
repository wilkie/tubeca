import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { prisma } from './config/database';
import { loadAppConfig, getScraperConfigs } from './config/appConfig';
import { videoWorker } from './workers/videoWorker';
import { libraryScanWorker } from './workers/libraryScanWorker';
import { metadataScrapeWorker } from './workers/metadataScrapeWorker';
import { collectionScrapeWorker } from './workers/collectionScrapeWorker';
import { loadScrapers } from './plugins/scraperLoader';
import { redisConnection } from './config/redis';
import { swaggerSpec } from './config/swagger.js';
import { fileWatcherService } from './services/fileWatcherService';
import { hlsCacheCleanupService } from './services/hlsCacheCleanupService';
import { shutdownHlsService } from './services/hlsService';
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
import settingsRoutes from './routes/settings';
import watchRoutes from './routes/watch';

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use('/api/settings', settingsRoutes);
app.use('/api/watch', watchRoutes);

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

  // Kill any FFmpeg still encoding
  shutdownHlsService();
  console.log('✅ FFmpeg processes stopped');

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
