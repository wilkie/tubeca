import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export interface MetadataScrapeJobData {
  mediaId: string
  mediaName: string
  mediaType: 'Video' | 'Audio'
  // Optional hints to help matching
  year?: number
  // For TV episodes, provide show context
  showName?: string
  season?: number
  episode?: number
  // Specific scraper to use (if not provided, tries all)
  scraperId?: string
  // External ID if already known (for refresh)
  externalId?: string
  // Skip downloading images (useful for metadata-only refresh)
  skipImages?: boolean
  // Skip metadata updates, only refresh images
  imagesOnly?: boolean
}

// Create metadata scraping queue with rate limiting
export const metadataScrapeQueue = new Queue<MetadataScrapeJobData>('metadata-scrape', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // Start with 5 second delay on retry
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
});

// Queue event handlers
metadataScrapeQueue.on('error', (error: Error) => {
  console.error('Metadata scrape queue error:', error);
});

/**
 * Add a single metadata scrape job
 */
export async function addMetadataScrapeJob(data: MetadataScrapeJobData) {
  // Use timestamp in job ID to allow re-scraping the same media
  const jobId = `scrape-${data.mediaId}-${Date.now()}`;
  return await metadataScrapeQueue.add('scrape', data, {
    jobId,
  });
}

/**
 * Add multiple metadata scrape jobs (bulk operation after library scan)
 */
export async function addBulkMetadataScrapeJobs(jobs: MetadataScrapeJobData[]) {
  const bulkJobs = jobs.map((data) => ({
    name: 'scrape',
    data,
    opts: {
      jobId: `scrape-${data.mediaId}`,
    },
  }));

  return await metadataScrapeQueue.addBulk(bulkJobs);
}

/**
 * Get the current queue status
 */
export async function getMetadataScrapeQueueStatus() {
  const [waiting, active, completed, failed] = await Promise.all([
    metadataScrapeQueue.getWaitingCount(),
    metadataScrapeQueue.getActiveCount(),
    metadataScrapeQueue.getCompletedCount(),
    metadataScrapeQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}
