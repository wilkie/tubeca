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
import { detectBestEncoderAsync } from './utils/hwaccel';
import { searchIndexService } from './services/searchIndexService';
import { notifyReady, notifyStopping, startWatchdog, type WatchdogHandle } from './runtime/systemd';
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
  const health = await checkHealth();
  res.status(health.status === 'ok' ? 200 : 503).json({
    ...health,
    message: health.status === 'ok' ? 'Tubeca API is running' : 'A dependency is unavailable',
    role,
  });
});

/**
 * Whether this process can still do its job.
 *
 * The database is checked for every role. Redis only matters where queues do:
 * an API-only process that cannot reach Redis can still serve the library and
 * stream, and reporting it unhealthy would take the whole site down for a
 * problem that only stops scans.
 */
async function checkHealth(): Promise<{ status: 'ok' | 'error'; database: string; redis?: string }> {
  let database = 'connected';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'disconnected';
  }

  if (!runsWorkers(role)) {
    return { status: database === 'connected' ? 'ok' : 'error', database };
  }

  let redis = 'connected';
  try {
    await redisConnection.ping();
  } catch {
    redis = 'disconnected';
  }

  return {
    status: database === 'connected' && redis === 'connected' ? 'ok' : 'error',
    database,
    redis,
  };
}

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
  const [scan, metadata, collection, trickplay, watcher] = await Promise.all([
    import('./workers/libraryScanWorker'),
    import('./workers/metadataScrapeWorker'),
    import('./workers/collectionScrapeWorker'),
    import('./workers/trickplayWorker'),
    import('./services/fileWatcherService'),
  ]);
  workerHandles.push(
    scan.libraryScanWorker,
    metadata.metadataScrapeWorker,
    collection.collectionScrapeWorker,
    trickplay.trickplayWorker
  );

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

/** Populate the search index on first boot after it was introduced. */
async function buildSearchIndexIfEmpty(): Promise<void> {
  try {
    if ((await searchIndexService.size()) > 0) return;
    console.log('🔎 Building the search index for the first time...');
    const result = await searchIndexService.rebuild((done, total) => {
      if (total > 0) console.log(`🔎 Indexed ${done}/${total}`);
    });
    console.log(`🔎 Search index ready: ${result.collections} collections, ${result.media} media`);
  } catch (error) {
    console.warn('Could not build the search index; search will fall back to substring matching:', error);
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
    // Encoder detection spawns FFmpeg several times. Doing it now, rather than
    // during boot or on the first segment request, keeps startup quick and the
    // first playback from paying for it.
    void detectBestEncoderAsync().catch((error) => {
      console.warn('Encoder detection failed; falling back to software encoding:', error);
    });

    // A library that predates the search index has none, and search would fall
    // back to a substring match until something rewrote every row. Build it
    // once, in the background, so the first upgrade needs no admin action.
    void buildSearchIndexIfEmpty();
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

// Tell systemd we are up, then keep telling it we are healthy. Both are
// no-ops outside a unit with Type=notify and WatchdogSec.
let watchdog: WatchdogHandle | null = null;
void serverPromise.then(() => {
  notifyReady();
  watchdog = startWatchdog(async () => (await checkHealth()).status === 'ok');
  if (watchdog) console.log('🩺 Reporting health to the systemd watchdog');
});

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Shutting down gracefully...');
  notifyStopping();
  watchdog?.stop();

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
