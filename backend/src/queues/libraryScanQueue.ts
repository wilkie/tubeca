import { Queue } from 'bullmq'
import { redisConnection } from '../config/redis'

export interface LibraryScanJobData {
  libraryId: string
  libraryPath: string
  libraryName: string
}

// Create library scan queue
export const libraryScanQueue = new Queue('library-scan', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1, // Don't retry scans automatically
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 100,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
})

// Helper function to add a scan job
export async function addLibraryScanJob(data: LibraryScanJobData) {
  const jobId = `scan-${data.libraryId}`

  // Remove existing job if it exists (completed or failed)
  const existingJob = await libraryScanQueue.getJob(jobId)
  if (existingJob) {
    const state = await existingJob.getState()
    if (state === 'completed' || state === 'failed') {
      await existingJob.remove()
    }
  }

  return await libraryScanQueue.add('scan', data, {
    jobId,
  })
}

// Get active scan job for a library
export async function getLibraryScanJob(libraryId: string) {
  const jobId = `scan-${libraryId}`
  return await libraryScanQueue.getJob(jobId)
}

// Cancel a scan job
export async function cancelLibraryScanJob(libraryId: string) {
  const job = await getLibraryScanJob(libraryId)
  if (job) {
    const state = await job.getState()
    if (state === 'active') {
      // Mark for cancellation - worker will check this
      await job.updateData({ ...job.data, cancelled: true })
      return { cancelled: true, wasActive: true }
    } else if (state === 'waiting' || state === 'delayed') {
      await job.remove()
      return { cancelled: true, wasActive: false }
    }
  }
  return { cancelled: false, wasActive: false }
}
