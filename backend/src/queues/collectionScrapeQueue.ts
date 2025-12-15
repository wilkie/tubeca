import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export type CollectionScrapeType = 'Show' | 'Season' | 'Artist' | 'Album' | 'Film'

export interface CollectionScrapeJobData {
  collectionId: string
  collectionName: string
  collectionType: CollectionScrapeType
  // For seasons, provide parent show context
  parentShowId?: string // Collection ID of the parent show
  parentExternalId?: string // External ID of the parent show (for scraper)
  parentScraperId?: string // Which scraper to use
  seasonNumber?: number // For seasons
  // For films, provide year hint for better search accuracy
  year?: number
  // Specific scraper to use (if not provided, tries all)
  scraperId?: string
  // External ID if already known (for refresh)
  externalId?: string
  // Skip downloading images (useful for metadata-only refresh)
  skipImages?: boolean
  // Skip metadata updates, only refresh images
  imagesOnly?: boolean
}

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
 * Shows are queued first, then seasons with a delay to ensure parent shows are scraped first
 */
export async function addBulkCollectionScrapeJobs(jobs: CollectionScrapeJobData[]) {
  // Separate shows from seasons/other types
  const shows = jobs.filter((j) => j.collectionType === 'Show');
  const seasons = jobs.filter((j) => j.collectionType === 'Season');
  const others = jobs.filter((j) => j.collectionType !== 'Show' && j.collectionType !== 'Season');

  const timestamp = Date.now();
  const results = [];

  // Queue shows first (no delay)
  if (shows.length > 0) {
    const showJobs = shows.map((data) => ({
      name: 'scrape',
      data,
      opts: {
        jobId: `collection-scrape-${data.collectionId}-${timestamp}`,
      },
    }));
    results.push(...(await collectionScrapeQueue.addBulk(showJobs)));
  }

  // Queue seasons with a delay to allow parent shows to be scraped first
  // The delay is proportional to the number of shows to account for rate limiting
  if (seasons.length > 0) {
    const seasonDelay = Math.max(5000, shows.length * 2000); // At least 5s, plus 2s per show
    const seasonJobs = seasons.map((data) => ({
      name: 'scrape',
      data,
      opts: {
        jobId: `collection-scrape-${data.collectionId}-${timestamp}`,
        delay: seasonDelay,
      },
    }));
    results.push(...(await collectionScrapeQueue.addBulk(seasonJobs)));
  }

  // Queue other types (films, artists, albums) without delay
  if (others.length > 0) {
    const otherJobs = others.map((data) => ({
      name: 'scrape',
      data,
      opts: {
        jobId: `collection-scrape-${data.collectionId}-${timestamp}`,
      },
    }));
    results.push(...(await collectionScrapeQueue.addBulk(otherJobs)));
  }

  return results;
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
