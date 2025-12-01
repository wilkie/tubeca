import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

// Job data interfaces
export interface TranscodeJobData {
  mediaId: string
  inputPath: string
  outputPath: string
  resolution?: string
  format?: string
}

export interface ThumbnailJobData {
  mediaId: string
  videoPath: string
  thumbnailPath: string
  timestamp?: number // seconds into video
}

export interface AnalyzeJobData {
  mediaId: string
  filePath: string
}

// Create video processing queue
export const videoQueue = new Queue('video-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
});

// Queue event handlers
videoQueue.on('error', (error: Error) => {
  console.error('Video queue error:', error);
});

// Helper functions to add jobs
export async function addTranscodeJob(data: TranscodeJobData) {
  return await videoQueue.add('transcode', data, {
    priority: 2, // Higher number = lower priority
  });
}

export async function addThumbnailJob(data: ThumbnailJobData) {
  return await videoQueue.add('thumbnail', data, {
    priority: 1, // Thumbnails are higher priority
  });
}

export async function addAnalyzeJob(data: AnalyzeJobData) {
  return await videoQueue.add('analyze', data, {
    priority: 3,
  });
}
