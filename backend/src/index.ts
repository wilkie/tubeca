import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { prisma } from './config/database';
import { loadAppConfig, getScraperConfigs } from './config/appConfig';
import { loadScrapers } from './plugins/scraperLoader';
import { redisConnection } from './config/redis';
import { swaggerSpec } from './config/swagger.js';
import { hlsCacheCleanupService } from './services/hlsCacheCleanupService';
import { shutdownHlsService } from './services/hlsService';
import { getRole, runsApi, runsWorkers } from './runtime/role';
import { mountFrontend, resolveFrontendDist } from './runtime/frontend';
import type { Server } from 'http';
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
const role = getRole();

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

interface Closable {
  close(): Promise<unknown> | void
}

/** Worker-role resources, populated only when this process runs workers. */
const workerHandles: Closable[] = [];
let fileWatcher: Closable | null = null;

/**
 * Load the BullMQ workers and the file watcher. Imported lazily so an
 * API-only process never opens worker connections or starts chokidar.
 */
async function startWorkers(appConfig: ReturnType<typeof loadAppConfig>): Promise<void> {
  const [scan, metadata, collection, watcher] = await Promise.all([
    import('./workers/libraryScanWorker'),
    import('./workers/metadataScrapeWorker'),
    import('./workers/collectionScrapeWorker'),
    import('./services/fileWatcherService'),
  ]);
  workerHandles.push(scan.libraryScanWorker, metadata.metadataScrapeWorker, collection.collectionScrapeWorker);

  // Environment variable takes precedence over config file
  const watcherEnabled = process.env.FILE_WATCHER_ENABLED !== undefined
    ? process.env.FILE_WATCHER_ENABLED === 'true'
    : appConfig.fileWatcher?.enabled ?? false;
  if (watcherEnabled) {
    await watcher.fileWatcherService.start({
      usePolling: appConfig.fileWatcher?.usePolling,
      pollInterval: appConfig.fileWatcher?.pollInterval,
    });
    fileWatcher = { close: () => watcher.fileWatcherService.stop() };
    console.log('📁 File watcher is enabled');
  }
}

/** Bind the HTTP server, serving the SPA when its build output is present. */
function startApi(): Server {
  const distDir = resolveFrontendDist();
  if (mountFrontend(app, distDir)) {
    console.log(`🖥️  Serving frontend from ${distDir}`);
  } else {
    console.log('ℹ️  Frontend build not found; serving API only (set FRONTEND_DIST to change)');
  }

  hlsCacheCleanupService.start();

  return app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  });
}

// Initialize scrapers and start whatever this role runs
async function startServer(): Promise<Server | null> {
  console.log(`🧩 Role: ${role}`);

  // Load application configuration
  const appConfig = loadAppConfig();

  // Initialize scraper plugins (used by workers and by the Identify search endpoint)
  const scraperConfigs = getScraperConfigs(appConfig);
  await loadScrapers(scraperConfigs);

  if (runsWorkers(role)) {
    await startWorkers(appConfig);
  }

  return runsApi(role) ? startApi() : null;
}

const serverPromise = startServer();

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Shutting down gracefully...');

  // Wait for startup to finish, then stop accepting requests
  const server = await serverPromise;
  server?.close(() => {
    console.log('✅ Express server closed');
  });

  // Close workers
  for (const worker of workerHandles) {
    await worker.close();
  }
  if (workerHandles.length > 0) {
    console.log('✅ Workers closed');
  }

  // Stop file watcher
  if (fileWatcher) {
    await fileWatcher.close();
    console.log('✅ File watcher stopped');
  }

  // Stop HLS cache cleanup service and any FFmpeg still encoding
  hlsCacheCleanupService.stop();
  shutdownHlsService();
  console.log('✅ HLS services stopped');

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
