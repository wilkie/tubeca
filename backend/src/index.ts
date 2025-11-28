import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import { prisma } from './config/database'
import { MediaService } from './services/mediaService'
import { SettingsService } from './services/settingsService'
import { videoWorker } from './workers/videoWorker'
import { libraryScanWorker } from './workers/libraryScanWorker'
import { redisConnection } from './config/redis'
import { swaggerSpec } from './config/swagger.js'
import authRoutes from './routes/auth'
import userRoutes from './routes/users'
import libraryRoutes from './routes/libraries'
import collectionRoutes from './routes/collections'
import streamRoutes from './routes/stream'

const app = express()
const PORT = process.env.PORT || 3000
const mediaService = new MediaService()
const settingsService = new SettingsService()

app.use(cors())
app.use(express.json())

// API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Tubeca API Documentation',
}))

// Auth and User routes
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/libraries', libraryRoutes)
app.use('/api/collections', collectionRoutes)
app.use('/api/stream', streamRoutes)

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
    await prisma.$queryRaw`SELECT 1`
    res.json({
      status: 'ok',
      message: 'Tubeca API is running',
      database: 'connected'
    })
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Database connection failed',
      database: 'disconnected'
    })
  }
})

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
    const media = await mediaService.getAllMedia()
    res.json({ media })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch media' })
  }
})

app.get('/api/media/videos', async (_req, res) => {
  try {
    const videos = await mediaService.getAllVideos()
    res.json({ videos })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch videos' })
  }
})

app.get('/api/media/audio', async (_req, res) => {
  try {
    const audio = await mediaService.getAllAudio()
    res.json({ audio })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audio' })
  }
})

app.get('/api/media/:id', async (req, res) => {
  try {
    const media = await mediaService.getMediaById(req.params.id)
    if (!media) {
      return res.status(404).json({ error: 'Media not found' })
    }
    res.json({ media })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch media' })
  }
})

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
    const { path, duration, name, description } = req.body
    const video = await mediaService.createVideo({ path, duration, name, description })
    res.status(201).json({ video })
  } catch (error) {
    res.status(500).json({ error: 'Failed to create video' })
  }
})

app.post('/api/media/audio', async (req, res) => {
  try {
    const { path, duration, name, description } = req.body
    const audio = await mediaService.createAudio({ path, duration, name, description })
    res.status(201).json({ audio })
  } catch (error) {
    res.status(500).json({ error: 'Failed to create audio' })
  }
})

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
    const settings = await settingsService.getOrCreateSettings()
    res.json({ settings })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' })
  }
})

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
    const { instanceName } = req.body
    const settings = await settingsService.updateSettings({ instanceName })
    res.json({ settings })
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' })
  }
})

// Background job endpoints
app.post('/api/jobs/transcode', async (req, res) => {
  try {
    const { mediaId, inputPath, outputPath, resolution, format } = req.body
    const job = await mediaService.queueTranscode({ mediaId, inputPath, outputPath, resolution, format })
    res.status(202).json({ jobId: job.id, message: 'Transcode job queued' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue transcode job'
    res.status(500).json({ error: message })
  }
})

app.post('/api/jobs/thumbnail', async (req, res) => {
  try {
    const { mediaId, videoPath, thumbnailPath, timestamp } = req.body
    const job = await mediaService.queueThumbnail({ mediaId, videoPath, thumbnailPath, timestamp })
    res.status(202).json({ jobId: job.id, message: 'Thumbnail job queued' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue thumbnail job'
    res.status(500).json({ error: message })
  }
})

app.post('/api/jobs/analyze', async (req, res) => {
  try {
    const { mediaId, filePath } = req.body
    const job = await mediaService.queueAnalyze({ mediaId, filePath })
    res.status(202).json({ jobId: job.id, message: 'Analyze job queued' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to queue analyze job'
    res.status(500).json({ error: message })
  }
})

const server = app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`)
})

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Shutting down gracefully...')

  // Close Express server
  server.close(() => {
    console.log('✅ Express server closed')
  })

  // Close workers
  await videoWorker.close()
  console.log('✅ Video worker closed')

  await libraryScanWorker.close()
  console.log('✅ Library scan worker closed')

  // Close Redis connection
  await redisConnection.quit()
  console.log('✅ Redis connection closed')

  // Close Prisma connection
  await prisma.$disconnect()
  console.log('✅ Database connection closed')

  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
