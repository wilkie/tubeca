import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { planCollectionScrapeJobs, type CollectionScrapeJobData } from './collectionScrapePlan';

export * from './collectionScrapePlan';

// Create collection scraping queue with rate limiting
export const collectionScrapeQueue = new Queue<CollectionScrapeJobData>('collection-scrape', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
});

// Queue event handlers
collectionScrapeQueue.on('error', (error: Error) => {
  console.error('Collection scrape queue error:', error);
});

/**
 * Add a single collection scrape job
 */
export async function addCollectionScrapeJob(data: CollectionScrapeJobData) {
  // Use timestamp in job ID to allow re-scraping the same collection
  const jobId = `collection-scrape-${data.collectionId}-${Date.now()}`;
  return await collectionScrapeQueue.add('scrape', data, {
    jobId,
  });
}

/**
 * Add multiple collection scrape jobs (bulk operation after library scan)
 */
export async function addBulkCollectionScrapeJobs(jobs: CollectionScrapeJobData[]) {
  const planned = planCollectionScrapeJobs(jobs);
  if (planned.length === 0) return [];
  return await collectionScrapeQueue.addBulk(planned);
}

/**
 * Get the current queue status
 */
export async function getCollectionScrapeQueueStatus() {
  const [waiting, active, completed, failed] = await Promise.all([
    collectionScrapeQueue.getWaitingCount(),
    collectionScrapeQueue.getActiveCount(),
    collectionScrapeQueue.getCompletedCount(),
    collectionScrapeQueue.getFailedCount(),
  ]);

  return { waiting, active, completed, failed };
}
