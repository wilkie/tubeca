/**
 * Job shapes for the collection scrape queue, and the rule for which jobs a
 * bulk request actually queues.
 *
 * Kept apart from the queue itself so the ordering can be tested without a
 * Redis connection.
 */

export type CollectionScrapeType = 'Show' | 'Season' | 'Artist' | 'Album' | 'Film'

/**
 * How far a scrape carries on into the collection's children:
 * 'seasons' queues the show's seasons, 'all' also queues their episodes.
 */
export type CascadeDepth = 'seasons' | 'all'

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
  // Queue this collection's children once it has been matched
  cascade?: CascadeDepth
}

/** One job as it will be handed to BullMQ. */
export interface PlannedCollectionScrapeJob {
  name: 'scrape'
  data: CollectionScrapeJobData
  opts: { jobId: string }
}

/**
 * Decide which jobs a bulk request actually queues.
 *
 * A season can only be looked up through its show's external id, so a season
 * whose show is in the same batch is left out here: the show job queues it
 * once the show has been matched. Seasons whose show is not in the batch
 * (a re-scrape of one season, say) are queued directly and read the identity
 * from the database. Shows are queued first so the provider sees them before
 * the films competing for the same rate limit.
 *
 * Kept pure and exported so the ordering can be tested without Redis.
 */
export function planCollectionScrapeJobs(
  jobs: CollectionScrapeJobData[],
  timestamp: number = Date.now()
): PlannedCollectionScrapeJob[] {
  const showIds = new Set(
    jobs.filter((j) => j.collectionType === 'Show').map((j) => j.collectionId)
  );

  const shows: PlannedCollectionScrapeJob[] = [];
  const rest: PlannedCollectionScrapeJob[] = [];

  for (const data of jobs) {
    if (data.collectionType === 'Season' && data.parentShowId && showIds.has(data.parentShowId)) {
      continue; // The show job will queue this season with the identity it found.
    }

    const opts = { jobId: `collection-scrape-${data.collectionId}-${timestamp}` };
    if (data.collectionType === 'Show') {
      shows.push({ name: 'scrape', data: { ...data, cascade: data.cascade ?? 'seasons' }, opts });
    } else {
      rest.push({ name: 'scrape', data, opts });
    }
  }

  return [...shows, ...rest];
}

