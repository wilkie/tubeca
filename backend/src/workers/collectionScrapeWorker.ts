import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/database';
import { scraperManager } from '../plugins/scraperLoader';
import { applyCredits, downloadArtwork, shouldDownloadArtwork } from '../services/scrapeApply';
import { queueEpisodeScrapes, queueSeasonScrapes } from '../services/scrapeCascade';
import { cachedCall, scrapeCacheKey } from '../services/scrapeCache';
import type { CollectionScrapeJobData } from '../queues/collectionScrapeQueue';
import type { SeriesMetadata, SeasonMetadata, VideoMetadata } from '@tubeca/scraper-types';
import { parseTitleAndYear } from '../utils/mediaParser';
import { syncCollectionSortFields } from '../services/collectionSortFields';
import {
  resolveByIdentity,
  resolveBySearch,
  recordCollectionScrape,
  markCollectionScrapePending,
  type ScrapeAttempt,
} from '../services/scrapeResolution';


interface ScrapeResult {
  success: boolean
  scraperId?: string
  externalId?: string
  error?: string
}

/** Job return value: keeps the shape earlier callers expect and throws for retryable failures. */
function toResult(attempt: ScrapeAttempt<unknown>): ScrapeResult {
  if (attempt.status === 'matched') {
    return { success: true, scraperId: attempt.scraperId, externalId: attempt.externalId };
  }
  if (attempt.status === 'failed' && attempt.retryable) {
    throw attempt.error; // Let BullMQ retry; status already recorded as Failed
  }
  return { success: false, error: attempt.message };
}

// Worker with rate limiting - process 1 job at a time with delays
export const collectionScrapeWorker = new Worker<CollectionScrapeJobData, ScrapeResult>(
  'collection-scrape',
  async (job: Job<CollectionScrapeJobData>) => {
    const { collectionId, collectionName, collectionType } = job.data;

    console.log(`🔍 Scraping collection metadata for: ${collectionName} (${collectionType})`);

    try {
      // Verify collection still exists
      const collection = await prisma.collection.findUnique({
        where: { id: collectionId },
      });

      if (!collection) {
        return { success: false, error: 'Collection not found' };
      }

      await markCollectionScrapePending([collectionId]);

      let attempt: ScrapeAttempt<unknown>;
      switch (collectionType) {
        case 'Show':
          attempt = await scrapeShowMetadata(job);
          break;
        case 'Season':
          attempt = await scrapeSeasonMetadata(job);
          break;
        case 'Film':
          attempt = await scrapeFilmMetadata(job);
          break;
        case 'Artist':
          attempt = await scrapeArtistMetadata(job);
          break;
        case 'Album':
          attempt = await scrapeAlbumMetadata(job);
          break;
        default:
          attempt = { status: 'nomatch', message: `Unsupported collection type: ${collectionType}` };
      }

      await recordCollectionScrape(collectionId, attempt);
      return toResult(attempt);
    } catch (error) {
      console.error(`❌ Collection scrape failed for ${collectionName}:`, error);
      await recordCollectionScrape(collectionId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error : new Error(String(error)),
        retryable: true,
      });
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: {
      max: 10,
      duration: 10000,
    },
  }
);

async function scrapeShowMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeAttempt<SeriesMetadata>> {
  const { collectionId, collectionName, scraperId, externalId, skipImages, imagesOnly, cascade } = job.data;

  let attempt: ScrapeAttempt<SeriesMetadata>;
  if (externalId && scraperId) {
    // Already identified: fetch by id only, never fall back to a name search.
    attempt = await resolveByIdentity(scraperManager.get(scraperId), scraperId, externalId, (s) =>
      s.getSeriesMetadata
        ? cachedCall(scrapeCacheKey(s.id, 'series', externalId), () => s.getSeriesMetadata!(externalId))
        : undefined
    );
  } else {
    const scrapers = scraperId
      ? [scraperManager.get(scraperId)].filter((s): s is NonNullable<typeof s> => Boolean(s))
      : scraperManager.getByMediaType('video').filter((s) => s.isConfigured());
    if (scrapers.length === 0) {
      return { status: 'nomatch', message: 'No video scrapers configured' };
    }
    const { title, year } = parseTitleAndYear(collectionName);
    attempt = await resolveBySearch(
      scrapers,
      { title, year },
      (s) =>
        s.searchSeries
          ? cachedCall(scrapeCacheKey(s.id, 'searchSeries', title), () => s.searchSeries!(title))
          : undefined,
      (s, id) => cachedCall(scrapeCacheKey(s.id, 'series', id), () => s.getSeriesMetadata!(id))
    );
  }

  if (attempt.status === 'matched') {
    await applyShowMetadata(collectionId, attempt.metadata, attempt.scraperId, skipImages, imagesOnly);
    console.log(`✅ Found show metadata for ${collectionName} via ${attempt.scraperId}`);

    // Seasons are addressed by the show's external id, so they can only be
    // queued now that we have one. This replaces the old fixed delay.
    if (cascade) {
      await queueSeasonScrapes(
        collectionId,
        { scraperId: attempt.scraperId, externalId: attempt.externalId },
        { skipImages, imagesOnly, cascade }
      );
    }
  }
  return attempt;
}

async function scrapeSeasonMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeAttempt<SeasonMetadata>> {
  const { collectionId, collectionName, parentShowId, seasonNumber, skipImages, imagesOnly, cascade } =
    job.data;
  let { parentExternalId, parentScraperId } = job.data;

  // If we don't have parent info from the job, look it up from the database
  if ((!parentExternalId || !parentScraperId) && parentShowId) {
    const parentShowDetails = await prisma.showDetails.findUnique({
      where: { collectionId: parentShowId },
    });
    if (parentShowDetails?.externalId && parentShowDetails?.scraperId) {
      parentExternalId = parentShowDetails.externalId;
      parentScraperId = parentShowDetails.scraperId;
    }
  }

  if (!parentExternalId || !parentScraperId || seasonNumber === undefined) {
    return { status: 'nomatch', message: 'Missing parent show info for season scrape' };
  }

  const scraper = scraperManager.get(parentScraperId);
  if (!scraper?.getSeasonMetadata) {
    return { status: 'nomatch', message: 'Scraper does not support season metadata' };
  }

  try {
    const metadata = await cachedCall(
      scrapeCacheKey(scraper.id, 'season', parentExternalId, seasonNumber),
      () => scraper.getSeasonMetadata!(parentExternalId!, seasonNumber!)
    );

    if (metadata) {
      await applySeasonMetadata(collectionId, metadata, parentScraperId, skipImages, imagesOnly);
      console.log(`✅ Found season metadata for ${collectionName} via ${scraper.name}`);

      // Episodes are fetched by the show's id plus season and episode number,
      // so a re-identified show has to push its identity down to them.
      if (cascade === 'all') {
        await queueEpisodeScrapes(
          collectionId,
          { scraperId: parentScraperId, externalId: parentExternalId },
          seasonNumber,
          { skipImages, imagesOnly }
        );
      }

      return { status: 'matched', scraperId: parentScraperId, externalId: metadata.externalId, metadata };
    }
  } catch (error) {
    console.warn(`Failed to get season metadata for ${collectionName}:`, error);
  }

  return { status: 'nomatch', message: 'No season metadata found' };
}

async function scrapeFilmMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeAttempt<VideoMetadata>> {
  const { collectionId, collectionName, year, scraperId, externalId, skipImages, imagesOnly } = job.data;

  let attempt: ScrapeAttempt<VideoMetadata>;
  if (externalId && scraperId) {
    // Already identified: fetch by id only, never fall back to a name search.
    attempt = await resolveByIdentity(scraperManager.get(scraperId), scraperId, externalId, (s) =>
      s.getVideoMetadata
        ? cachedCall(scrapeCacheKey(s.id, 'video', externalId), () => s.getVideoMetadata!(externalId))
        : undefined
    );
  } else {
    const scrapers = scraperId
      ? [scraperManager.get(scraperId)].filter((s): s is NonNullable<typeof s> => Boolean(s))
      : scraperManager.getByMediaType('video').filter((s) => s.isConfigured());
    if (scrapers.length === 0) {
      return { status: 'nomatch', message: 'No video scrapers configured' };
    }
    // "Blade Runner (1982)" -> title "Blade Runner", year 1982; the raw string hurts matching.
    const parsed = parseTitleAndYear(collectionName);
    const query = { title: parsed.title, year: year ?? parsed.year };
    attempt = await resolveBySearch(
      scrapers,
      query,
      (s) =>
        s.searchVideo
          ? cachedCall(scrapeCacheKey(s.id, 'searchVideo', query.title, query.year, 'movie'), () =>
              s.searchVideo!(query.title, { year: query.year, videoType: 'movie' })
            )
          : undefined,
      (s, id) => cachedCall(scrapeCacheKey(s.id, 'video', id), () => s.getVideoMetadata!(id))
    );
  }

  if (attempt.status === 'matched') {
    await applyFilmMetadata(collectionId, attempt.metadata, attempt.scraperId, skipImages, imagesOnly);
    console.log(`✅ Found film metadata for ${collectionName} via ${attempt.scraperId}`);
  }
  return attempt;
}

async function scrapeArtistMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeAttempt<never>> {
  const { collectionName } = job.data;
  // TODO: Implement when music scrapers are available
  console.log(`⏭️ Artist scraping not yet implemented for: ${collectionName}`);
  return { status: 'nomatch', message: 'Artist scraping not yet implemented' };
}

async function scrapeAlbumMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeAttempt<never>> {
  const { collectionName } = job.data;
  // TODO: Implement when music scrapers are available
  console.log(`⏭️ Album scraping not yet implemented for: ${collectionName}`);
  return { status: 'nomatch', message: 'Album scraping not yet implemented' };
}

/**
 * Save keywords for a collection
 * Finds or creates keywords and connects them to the collection
 */
async function saveKeywords(collectionId: string, keywords: string[]): Promise<void> {
  if (!keywords || keywords.length === 0) return;

  // Normalize keywords (lowercase, trim)
  const normalizedKeywords = keywords.map((k) => k.toLowerCase().trim()).filter((k) => k.length > 0);

  // Find or create each keyword and connect to collection
  for (const keywordName of normalizedKeywords) {
    const keyword = await prisma.keyword.upsert({
      where: { name: keywordName },
      create: { name: keywordName },
      update: {},
    });

    // Connect keyword to collection (if not already connected)
    await prisma.collection.update({
      where: { id: collectionId },
      data: {
        keywords: {
          connect: { id: keyword.id },
        },
      },
    });
  }

  console.log(`🏷️ Saved ${normalizedKeywords.length} keywords for collection ${collectionId}`);
}

/**
 * Apply show metadata to the database
 */
async function applyShowMetadata(
  collectionId: string,
  metadata: SeriesMetadata,
  scraperId: string,
  skipImages?: boolean,
  imagesOnly?: boolean
): Promise<void> {
  // If imagesOnly is set, only download images and skip metadata updates
  if (imagesOnly) {
    await downloadArtwork({ collectionId }, metadata, scraperId, { label: 'show collection' });
    console.log(`📷 Refreshed images for show collection ${collectionId}`);
    return;
  }

  // Upsert ShowDetails
  const showDetails = await prisma.showDetails.upsert({
    where: { collectionId },
    create: {
      collectionId,
      scraperId,
      externalId: metadata.externalId,
      description: metadata.description,
      releaseDate: metadata.firstAirDate,
      endDate: metadata.lastAirDate,
      status: metadata.status,
      rating: metadata.rating,
      genres: metadata.genres?.join(', '),
    },
    update: {
      scraperId,
      externalId: metadata.externalId,
      description: metadata.description,
      releaseDate: metadata.firstAirDate,
      endDate: metadata.lastAirDate,
      status: metadata.status,
      rating: metadata.rating,
      genres: metadata.genres?.join(', '),
    },
  });

  // A re-scrape usually returns the artwork we already have on disk, so let
  // the image service keep the existing file when the URL has not moved.
  if (await shouldDownloadArtwork({ collectionId }, skipImages)) {
    await downloadArtwork({ collectionId }, metadata, scraperId, {
      reuseExisting: true,
      label: 'show collection',
    });
  }

  await applyCredits({
    credits: metadata.credits ?? [],
    scraperId,
    downloadPhotos: !skipImages,
    deleteExisting: () => prisma.showCredit.deleteMany({ where: { showDetailsId: showDetails.id } }),
    createCredit: (row) => prisma.showCredit.create({ data: { showDetailsId: showDetails.id, ...row } }),
  });

  // Save keywords for search and recommendations
  if (metadata.keywords && metadata.keywords.length > 0) {
    await saveKeywords(collectionId, metadata.keywords);
  }

  // Keep the denormalised sort keys in step with the details row just written.
  await syncCollectionSortFields(collectionId);
}

/**
 * Apply season metadata to the database
 */
async function applySeasonMetadata(
  collectionId: string,
  metadata: SeasonMetadata,
  scraperId: string,
  skipImages?: boolean,
  imagesOnly?: boolean
): Promise<void> {
  // If imagesOnly is set, only download images and skip metadata updates
  if (imagesOnly) {
    await downloadArtwork({ collectionId }, metadata, scraperId, { label: 'season collection' });
    return;
  }

  await prisma.seasonDetails.upsert({
    where: { collectionId },
    create: {
      collectionId,
      scraperId,
      externalId: metadata.externalId,
      seasonNumber: metadata.seasonNumber,
      description: metadata.description,
      releaseDate: metadata.airDate,
    },
    update: {
      scraperId,
      externalId: metadata.externalId,
      seasonNumber: metadata.seasonNumber,
      description: metadata.description,
      releaseDate: metadata.airDate,
    },
  });

  if (await shouldDownloadArtwork({ collectionId }, skipImages)) {
    await downloadArtwork({ collectionId }, metadata, scraperId, {
      reuseExisting: true,
      label: 'season collection',
    });
  }

  // Keep the denormalised sort keys in step with the details row just written.
  await syncCollectionSortFields(collectionId);
}

/**
 * Apply film metadata to the collection
 */
async function applyFilmMetadata(
  collectionId: string,
  metadata: VideoMetadata,
  scraperId: string,
  skipImages?: boolean,
  imagesOnly?: boolean
): Promise<void> {
  // If imagesOnly is set, only download images and skip metadata updates
  if (imagesOnly) {
    await downloadArtwork({ collectionId }, metadata, scraperId, { label: 'film collection' });
    console.log(`📷 Refreshed images for film collection ${collectionId}`);
    return;
  }

  // Upsert FilmDetails
  const filmDetails = await prisma.filmDetails.upsert({
    where: { collectionId },
    create: {
      collectionId,
      scraperId,
      externalId: metadata.externalId,
      description: metadata.description,
      releaseDate: metadata.releaseDate,
      runtime: metadata.runtime,
      contentRating: metadata.rating,
      rating: metadata.voteAverage,
      genres: metadata.genres?.join(', '),
      originalTitle: metadata.originalTitle,
    },
    update: {
      scraperId,
      externalId: metadata.externalId,
      description: metadata.description,
      releaseDate: metadata.releaseDate,
      runtime: metadata.runtime,
      contentRating: metadata.rating,
      rating: metadata.voteAverage,
      genres: metadata.genres?.join(', '),
      originalTitle: metadata.originalTitle,
    },
  });

  if (await shouldDownloadArtwork({ collectionId }, skipImages)) {
    await downloadArtwork({ collectionId }, metadata, scraperId, {
      reuseExisting: true,
      label: 'film collection',
    });
  }

  await applyCredits({
    credits: metadata.credits ?? [],
    scraperId,
    downloadPhotos: !skipImages,
    deleteExisting: () => prisma.filmCredit.deleteMany({ where: { filmDetailsId: filmDetails.id } }),
    createCredit: (row) => prisma.filmCredit.create({ data: { filmDetailsId: filmDetails.id, ...row } }),
  });

  // Save keywords for search and recommendations
  if (metadata.keywords && metadata.keywords.length > 0) {
    await saveKeywords(collectionId, metadata.keywords);
  }

  // Keep the denormalised sort keys in step with the details row just written.
  await syncCollectionSortFields(collectionId);
}

// Worker event handlers
collectionScrapeWorker.on('completed', (job, result) => {
  if (result.success) {
    console.log(`✅ Collection scrape ${job.id} completed via ${result.scraperId}`);
  } else {
    console.log(`⚠️ Collection scrape ${job.id} completed but no metadata found`);
  }
});

collectionScrapeWorker.on('failed', (job, error) => {
  console.error(`❌ Collection scrape ${job?.id} failed:`, error.message);
});

collectionScrapeWorker.on('error', (error) => {
  console.error('Collection scrape worker error:', error);
});

collectionScrapeWorker.on('ready', () => {
  console.log('🎬 Collection scrape worker is ready');
});
