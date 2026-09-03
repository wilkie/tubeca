import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/database';
import { scraperManager } from '../plugins/scraperLoader';
import { ImageService } from '../services/imageService';
import { PersonService } from '../services/personService';
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

const imageService = new ImageService();
const personService = new PersonService();

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
  const { collectionId, collectionName, scraperId, externalId, skipImages, imagesOnly } = job.data;

  let attempt: ScrapeAttempt<SeriesMetadata>;
  if (externalId && scraperId) {
    // Already identified: fetch by id only, never fall back to a name search.
    attempt = await resolveByIdentity(scraperManager.get(scraperId), scraperId, externalId, (s) =>
      s.getSeriesMetadata?.(externalId)
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
      (s) => s.searchSeries?.(title),
      (s, id) => s.getSeriesMetadata!(id)
    );
  }

  if (attempt.status === 'matched') {
    await applyShowMetadata(collectionId, attempt.metadata, attempt.scraperId, skipImages, imagesOnly);
    console.log(`✅ Found show metadata for ${collectionName} via ${attempt.scraperId}`);
  }
  return attempt;
}

async function scrapeSeasonMetadata(job: Job<CollectionScrapeJobData>): Promise<ScrapeAttempt<SeasonMetadata>> {
  const { collectionId, collectionName, parentShowId, seasonNumber, skipImages, imagesOnly } = job.data;
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
    const metadata = await scraper.getSeasonMetadata(parentExternalId, seasonNumber);

    if (metadata) {
      await applySeasonMetadata(collectionId, metadata, parentScraperId, skipImages, imagesOnly);
      console.log(`✅ Found season metadata for ${collectionName} via ${scraper.name}`);
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
      s.getVideoMetadata?.(externalId)
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
      (s) => s.searchVideo?.(query.title, { year: query.year, videoType: 'movie' }),
      (s, id) => s.getVideoMetadata!(id)
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
    await downloadCollectionImages(collectionId, metadata, scraperId);
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

  // Download images for collection (unless skipImages is set and collection already has images)
  if (!skipImages) {
    await downloadCollectionImages(collectionId, metadata, scraperId);
  } else {
    // Even with skipImages, download if collection has no images yet
    const existingImages = await prisma.image.count({ where: { collectionId } });
    if (existingImages === 0) {
      await downloadCollectionImages(collectionId, metadata, scraperId);
    }
  }

  // Add credits if available
  if (metadata.credits && metadata.credits.length > 0) {
    // Clear existing credits
    await prisma.showCredit.deleteMany({
      where: { showDetailsId: showDetails.id },
    });

    // Add new credits
    for (const credit of metadata.credits) {
      // Find or create person for this credit
      let personId: string | undefined;
      try {
        const person = await personService.findOrCreatePerson({
          name: credit.name,
          type: credit.type,
          tmdbId: credit.tmdbId,
          tvdbId: credit.tvdbId,
          imdbId: credit.imdbId,
        });
        personId = person.id;
      } catch (error) {
        console.warn(`Failed to link person for ${credit.name}:`, error);
      }

      await prisma.showCredit.create({
        data: {
          showDetailsId: showDetails.id,
          name: credit.name,
          role: credit.role,
          creditType: mapCreditType(credit.type),
          order: credit.order,
          personId,
        },
      });

      // Download credit photo to person if available and person doesn't have one yet
      if (credit.photoUrl && personId) {
        try {
          // Check if person already has a photo
          const existingPhoto = await prisma.image.findFirst({
            where: { personId, imageType: 'Photo', isPrimary: true },
          });
          if (!existingPhoto) {
            await imageService.downloadAndSaveImage(credit.photoUrl, {
              imageType: 'Photo',
              personId,
              isPrimary: true,
              scraperId,
            });
            console.log(`📷 Downloaded photo for ${credit.name}`);
          }
        } catch (error) {
          console.warn(`Failed to download photo for ${credit.name}:`, error);
        }
      }
    }
  }

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
    if (metadata.posterUrl) {
      try {
        await imageService.downloadAndSaveImage(metadata.posterUrl, {
          imageType: 'Poster',
          collectionId,
          isPrimary: true,
          scraperId,
        });
        console.log(`📷 Refreshed season poster for collection ${collectionId}`);
      } catch (error) {
        console.warn(`Failed to download season poster:`, error);
      }
    }
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

  // Download season poster if available (unless skipImages is set)
  if (metadata.posterUrl && !skipImages) {
    try {
      await imageService.downloadAndSaveImage(metadata.posterUrl, {
        imageType: 'Poster',
        collectionId,
        isPrimary: true,
        scraperId,
      });
      console.log(`📷 Downloaded season poster for collection ${collectionId}`);
    } catch (error) {
      console.warn(`Failed to download season poster:`, error);
    }
  }

  // Keep the denormalised sort keys in step with the details row just written.
  await syncCollectionSortFields(collectionId);
}

/**
 * Download images for a collection (show/series)
 */
async function downloadCollectionImages(
  collectionId: string,
  metadata: SeriesMetadata,
  scraperId: string
): Promise<void> {
  const imagePromises: Promise<void>[] = [];

  // Download poster
  if (metadata.posterUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.posterUrl, {
        imageType: 'Poster',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded poster for collection ${collectionId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download poster:`, error);
      })
    );
  }

  // Download backdrop
  if (metadata.backdropUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.backdropUrl, {
        imageType: 'Backdrop',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded backdrop for collection ${collectionId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download backdrop:`, error);
      })
    );
  }

  // Download thumbnail (highest rated English backdrop)
  if (metadata.thumbnailUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.thumbnailUrl, {
        imageType: 'Thumbnail',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded thumbnail for collection ${collectionId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download thumbnail:`, error);
      })
    );
  }

  // Download logo
  if (metadata.logoUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.logoUrl, {
        imageType: 'Logo',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded logo for collection ${collectionId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download logo:`, error);
      })
    );
  }

  // Wait for all image downloads
  await Promise.all(imagePromises);
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
    await downloadFilmImages(collectionId, metadata, scraperId);
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

  // Download images for the collection (unless skipImages is set)
  if (!skipImages) {
    await downloadFilmImages(collectionId, metadata, scraperId);
  } else {
    // Even with skipImages, download if collection has no images yet
    const existingImages = await prisma.image.count({ where: { collectionId } });
    if (existingImages === 0) {
      await downloadFilmImages(collectionId, metadata, scraperId);
    }
  }

  // Add credits if available
  if (metadata.credits && metadata.credits.length > 0) {
    // Clear existing credits
    await prisma.filmCredit.deleteMany({
      where: { filmDetailsId: filmDetails.id },
    });

    // Add new credits
    for (const credit of metadata.credits) {
      // Find or create person for this credit
      let personId: string | undefined;
      try {
        const person = await personService.findOrCreatePerson({
          name: credit.name,
          type: credit.type,
          tmdbId: credit.tmdbId,
          tvdbId: credit.tvdbId,
          imdbId: credit.imdbId,
        });
        personId = person.id;
      } catch (error) {
        console.warn(`Failed to link person for ${credit.name}:`, error);
      }

      await prisma.filmCredit.create({
        data: {
          filmDetailsId: filmDetails.id,
          name: credit.name,
          role: credit.role,
          creditType: mapCreditType(credit.type),
          order: credit.order,
          personId,
        },
      });

      // Download credit photo to person if available and person doesn't have one yet
      if (credit.photoUrl && personId) {
        try {
          // Check if person already has a photo
          const existingPhoto = await prisma.image.findFirst({
            where: { personId, imageType: 'Photo', isPrimary: true },
          });
          if (!existingPhoto) {
            await imageService.downloadAndSaveImage(credit.photoUrl, {
              imageType: 'Photo',
              personId,
              isPrimary: true,
              scraperId,
            });
            console.log(`📷 Downloaded photo for ${credit.name}`);
          }
        } catch (error) {
          console.warn(`Failed to download photo for ${credit.name}:`, error);
        }
      }
    }
  }

  // Save keywords for search and recommendations
  if (metadata.keywords && metadata.keywords.length > 0) {
    await saveKeywords(collectionId, metadata.keywords);
  }

  // Keep the denormalised sort keys in step with the details row just written.
  await syncCollectionSortFields(collectionId);
}

/**
 * Download images for a film collection
 */
async function downloadFilmImages(
  collectionId: string,
  metadata: VideoMetadata,
  scraperId: string
): Promise<void> {
  const imagePromises: Promise<void>[] = [];

  // Download poster
  if (metadata.posterUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.posterUrl, {
        imageType: 'Poster',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded poster for film collection ${collectionId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download film poster:`, error);
      })
    );
  }

  // Download backdrop
  if (metadata.backdropUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.backdropUrl, {
        imageType: 'Backdrop',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded backdrop for film collection ${collectionId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download film backdrop:`, error);
      })
    );
  }

  // Download thumbnail (highest rated English backdrop)
  if (metadata.thumbnailUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.thumbnailUrl, {
        imageType: 'Thumbnail',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded thumbnail for film collection ${collectionId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download film thumbnail:`, error);
      })
    );
  }

  // Download logo
  if (metadata.logoUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.logoUrl, {
        imageType: 'Logo',
        collectionId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded logo for film collection ${collectionId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download film logo:`, error);
      })
    );
  }

  // Wait for all image downloads
  await Promise.all(imagePromises);
}

/**
 * Map scraper credit type to Prisma enum
 */
function mapCreditType(
  type: string
): 'Actor' | 'Director' | 'Writer' | 'Producer' | 'Composer' | 'Cinematographer' | 'Editor' {
  const mapping: Record<string, 'Actor' | 'Director' | 'Writer' | 'Producer' | 'Composer' | 'Cinematographer' | 'Editor'> = {
    actor: 'Actor',
    director: 'Director',
    writer: 'Writer',
    producer: 'Producer',
    composer: 'Composer',
    cinematographer: 'Cinematographer',
    editor: 'Editor',
  };
  return mapping[type] ?? 'Actor';
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
