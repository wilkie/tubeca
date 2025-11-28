import { Worker, Job } from 'bullmq'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { redisConnection } from '../config/redis'
import { prisma } from '../config/database'
import { libraryScanQueue, type LibraryScanJobData } from '../queues/libraryScanQueue'
import * as fs from 'fs'
import * as path from 'path'

const execFileAsync = promisify(execFile)

// Get media duration using ffprobe
async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ])
    const duration = parseFloat(stdout.trim())
    return isNaN(duration) ? 0 : Math.round(duration)
  } catch (error) {
    console.error(`Failed to get duration for ${filePath}:`, error)
    return 0
  }
}

// Supported media extensions by type
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v']
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma']

interface ScanResult {
  filesFound: number
  filesProcessed: number
  collectionsCreated: number
  mediaCreated: number
  errors: string[]
}

// Library scan worker
export const libraryScanWorker = new Worker(
  'library-scan',
  async (job: Job<LibraryScanJobData & { cancelled?: boolean }>) => {
    const { libraryId, libraryPath, libraryName } = job.data
    console.log(`📂 Starting scan for library: ${libraryName} (${libraryId})`)
    console.log(`   Path: ${libraryPath}`)

    const result: ScanResult = {
      filesFound: 0,
      filesProcessed: 0,
      collectionsCreated: 0,
      mediaCreated: 0,
      errors: [],
    }

    try {
      // Verify path still exists
      if (!fs.existsSync(libraryPath)) {
        throw new Error(`Library path does not exist: ${libraryPath}`)
      }

      // Get library to determine type
      const library = await prisma.library.findUnique({
        where: { id: libraryId },
      })
      if (!library) {
        throw new Error('Library not found')
      }

      // Determine which extensions to look for based on library type
      const extensions = library.libraryType === 'Music' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS

      // Scan the directory recursively
      await scanDirectory(job, libraryPath, libraryId, null, extensions, result)

      await job.updateProgress(100)
      console.log(`✅ Scan complete for ${libraryName}:`, result)

      return result
    } catch (error) {
      console.error(`❌ Scan error for ${libraryName}:`, error)
      throw error
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Only one scan at a time
  }
)

async function scanDirectory(
  job: Job<LibraryScanJobData & { cancelled?: boolean }>,
  dirPath: string,
  libraryId: string,
  parentCollectionId: string | null,
  extensions: string[],
  result: ScanResult
): Promise<void> {
  // Check if job was cancelled
  const freshJob = await libraryScanQueue.getJob(job.id!)
  if (freshJob?.data?.cancelled) {
    throw new Error('Scan cancelled by user')
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch (error) {
    result.errors.push(`Cannot read directory: ${dirPath}`)
    return
  }

  // Separate files and directories
  const files = entries.filter(e => e.isFile())
  const dirs = entries.filter(e => e.isDirectory())

  // Process media files in this directory
  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase()
    if (extensions.includes(ext)) {
      result.filesFound++

      const filePath = path.join(dirPath, file.name)
      const mediaType = VIDEO_EXTENSIONS.includes(ext) ? 'Video' : 'Audio'
      const mediaName = path.basename(file.name, ext)

      // Check for corresponding .trickplay folder for video thumbnails
      let thumbnails: string | null = null
      if (mediaType === 'Video') {
        const trickplayPath = path.join(dirPath, `${mediaName}.trickplay`)
        if (fs.existsSync(trickplayPath) && fs.statSync(trickplayPath).isDirectory()) {
          thumbnails = trickplayPath
        }
      }

      try {
        // Check if media already exists by path
        const existing = await prisma.media.findFirst({
          where: { path: filePath },
        })

        if (!existing) {
          const duration = await getMediaDuration(filePath)
          await prisma.media.create({
            data: {
              path: filePath,
              name: mediaName,
              description: '',
              duration,
              type: mediaType,
              ...(thumbnails && { thumbnails }),
              collectionId: parentCollectionId,
            },
          })
          result.mediaCreated++
        }
        result.filesProcessed++
      } catch (error) {
        console.error(`Failed to process ${filePath}:`, error)
        result.errors.push(`Failed to process: ${filePath} - ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  // Process subdirectories as collections
  for (const dir of dirs) {
    // Skip hidden directories
    if (dir.name.startsWith('.')) continue

    // Skip .trickplay folders (they are for video thumbnails, not collections)
    if (dir.name.endsWith('.trickplay')) continue

    const subDirPath = path.join(dirPath, dir.name)

    try {
      // Check if collection already exists
      let collection = await prisma.collection.findFirst({
        where: {
          libraryId,
          name: dir.name,
          parentId: parentCollectionId,
        },
      })

      if (!collection) {
        collection = await prisma.collection.create({
          data: {
            name: dir.name,
            libraryId,
            parentId: parentCollectionId,
          },
        })
        result.collectionsCreated++
      }

      // Recursively scan subdirectory
      await scanDirectory(job, subDirPath, libraryId, collection.id, extensions, result)
    } catch (error) {
      result.errors.push(`Failed to process directory: ${subDirPath}`)
    }
  }

  // Update progress based on directories processed
  // This is approximate since we don't know total count upfront
  const progress = Math.min(95, Math.floor((result.filesProcessed / Math.max(result.filesFound, 1)) * 95))
  await job.updateProgress(progress)
}

// Worker event handlers
libraryScanWorker.on('completed', (job) => {
  console.log(`✅ Library scan ${job.id} completed successfully`)
})

libraryScanWorker.on('failed', (job, error) => {
  console.error(`❌ Library scan ${job?.id} failed:`, error.message)
})

libraryScanWorker.on('error', (error) => {
  console.error('Library scan worker error:', error)
})

libraryScanWorker.on('ready', () => {
  console.log('📚 Library scan worker is ready')
})
