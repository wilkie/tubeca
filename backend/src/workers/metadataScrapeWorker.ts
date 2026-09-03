import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/database';
import { scraperManager } from '../plugins/scraperLoader';
import { ImageService } from '../services/imageService';
import { PersonService } from '../services/personService';
import type { MetadataScrapeJobData } from '../queues/metadataScrapeQueue';
import type { VideoMetadata, AudioMetadata } from '@tubeca/scraper-types';
import { parseTitleAndYear } from '../utils/mediaParser';
import {
  resolveByIdentity,
  resolveBySearch,
  recordMediaScrape,
  markMediaScrapePending,
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
    throw attempt.error;
  }
  return { success: false, error: attempt.message };
}

// Worker with rate limiting - process 1 job at a time with delays
export const metadataScrapeWorker = new Worker<MetadataScrapeJobData, ScrapeResult>(
  'metadata-scrape',
  async (job: Job<MetadataScrapeJobData>) => {
    const { mediaId, mediaName, mediaType } = job.data;

    console.log(`🔍 Scraping metadata for: ${mediaName} (${mediaId})`);

    try {
      // Verify media still exists
      const media = await prisma.media.findUnique({
        where: { id: mediaId },
      });

      if (!media) {
        return { success: false, error: 'Media not found' };
      }

      await markMediaScrapePending([mediaId]);
      const attempt = mediaType === 'Video' ? await scrapeVideoMetadata(job) : await scrapeAudioMetadata(job);
      await recordMediaScrape(mediaId, attempt);
      return toResult(attempt);
    } catch (error) {
      console.error(`❌ Metadata scrape failed for ${mediaName}:`, error);
      await recordMediaScrape(mediaId, {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        error: error instanceof Error ? error : new Error(String(error)),
        retryable: true,
      });
      throw error; // Let BullMQ handle retries
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Process one at a time to respect rate limits
    limiter: {
      max: 10, // Max 10 jobs
      duration: 10000, // Per 10 seconds (1 request/second average)
    },
  }
);

async function scrapeVideoMetadata(job: Job<MetadataScrapeJobData>): Promise<ScrapeAttempt<VideoMetadata>> {
  const { mediaId, mediaName, year, showName, season, episode, scraperId, externalId, skipImages, imagesOnly } = job.data;

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

    const isEpisode = season !== undefined && episode !== undefined;
    if (isEpisode) {
      const query = { title: showName || extractShowName(mediaName) };
      attempt = await resolveBySearch(
        scrapers,
        query,
        (s) => (s.searchSeries && s.getEpisodeMetadata ? s.searchSeries(query.title) : undefined),
        (s, id) => s.getEpisodeMetadata!(id, season!, episode!)
      );
    } else {
      const parsed = parseTitleAndYear(mediaName);
      const query = { title: parsed.title, year: year ?? parsed.year };
      attempt = await resolveBySearch(
        scrapers,
        query,
        (s) => (s.searchVideo && s.getVideoMetadata ? s.searchVideo(query.title, { year: query.year }) : undefined),
        (s, id) => s.getVideoMetadata!(id)
      );
    }
  }

  if (attempt.status === 'matched') {
    await applyVideoMetadata(mediaId, attempt.metadata, attempt.scraperId, skipImages, imagesOnly);
    console.log(`✅ Found metadata for ${mediaName} via ${attempt.scraperId}`);
  }
  return attempt;
}

async function scrapeAudioMetadata(job: Job<MetadataScrapeJobData>): Promise<ScrapeAttempt<AudioMetadata>> {
  const { mediaId, mediaName, scraperId, externalId } = job.data;

  let attempt: ScrapeAttempt<AudioMetadata>;
  if (externalId && scraperId) {
    attempt = await resolveByIdentity(scraperManager.get(scraperId), scraperId, externalId, (s) =>
      s.getAudioMetadata?.(externalId)
    );
  } else {
    const scrapers = scraperId
      ? [scraperManager.get(scraperId)].filter((s): s is NonNullable<typeof s> => Boolean(s))
      : scraperManager.getByMediaType('audio').filter((s) => s.isConfigured());
    if (scrapers.length === 0) {
      return { status: 'nomatch', message: 'No audio scrapers configured' };
    }
    attempt = await resolveBySearch(
      scrapers,
      { title: mediaName },
      (s) => (s.searchAudio && s.getAudioMetadata ? s.searchAudio(mediaName) : undefined),
      (s, id) => s.getAudioMetadata!(id)
    );
  }

  if (attempt.status === 'matched') {
    await applyAudioMetadata(mediaId, attempt.metadata, attempt.scraperId);
    console.log(`✅ Found metadata for ${mediaName} via ${attempt.scraperId}`);
  }
  return attempt;
}

/**
 * Apply video metadata to the database
 */
async function applyVideoMetadata(mediaId: string, metadata: VideoMetadata, scraperId?: string, skipImages?: boolean, imagesOnly?: boolean): Promise<void> {
  // If imagesOnly is set, only download images and skip metadata updates
  if (imagesOnly) {
    await downloadMediaImages(mediaId, metadata, scraperId);
    console.log(`📷 Refreshed images for media ${mediaId}`);
    return;
  }

  // Create or update VideoDetails
  await prisma.videoDetails.upsert({
    where: { mediaId },
    create: {
      mediaId,
      showName: metadata.showName,
      season: metadata.season,
      episode: metadata.episode,
      description: metadata.description,
      releaseDate: metadata.releaseDate,
      rating: metadata.rating,
    },
    update: {
      showName: metadata.showName,
      season: metadata.season,
      episode: metadata.episode,
      description: metadata.description,
      releaseDate: metadata.releaseDate,
      rating: metadata.rating,
    },
  });

  // Update media name if we have an episode title
  if (metadata.episodeTitle) {
    await prisma.media.update({
      where: { id: mediaId },
      data: { name: metadata.episodeTitle },
    });
  }

  // Download images for media (unless skipImages is set and media already has images)
  if (!skipImages) {
    await downloadMediaImages(mediaId, metadata, scraperId);
  } else {
    // Even with skipImages, download if media has no images yet
    const existingImages = await prisma.image.count({ where: { mediaId } });
    if (existingImages === 0) {
      await downloadMediaImages(mediaId, metadata, scraperId);
    }
  }

  // Add credits if available
  if (metadata.credits && metadata.credits.length > 0) {
    const videoDetails = await prisma.videoDetails.findUnique({
      where: { mediaId },
    });

    if (videoDetails) {
      // Clear existing credits
      await prisma.credit.deleteMany({
        where: { videoDetailsId: videoDetails.id },
      });

      // Add new credits (without downloading photos if skipImages is set)
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

        await prisma.credit.create({
          data: {
            videoDetailsId: videoDetails.id,
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
  }
}

/**
 * Download images for a media item
 */
async function downloadMediaImages(
  mediaId: string,
  metadata: VideoMetadata | AudioMetadata,
  scraperId?: string
): Promise<void> {
  const imagePromises: Promise<void>[] = [];

  // Check for poster (video) or album art (audio)
  if ('posterUrl' in metadata && metadata.posterUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.posterUrl, {
        imageType: 'Poster',
        mediaId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded poster for media ${mediaId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download poster:`, error);
      })
    );
  }

  // Check for backdrop (video only)
  if ('backdropUrl' in metadata && metadata.backdropUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.backdropUrl, {
        imageType: 'Backdrop',
        mediaId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded backdrop for media ${mediaId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download backdrop:`, error);
      })
    );
  }

  // Check for thumbnail (video only - highest rated English backdrop)
  if ('thumbnailUrl' in metadata && metadata.thumbnailUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.thumbnailUrl, {
        imageType: 'Thumbnail',
        mediaId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded thumbnail for media ${mediaId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download thumbnail:`, error);
      })
    );
  }

  // Check for album art (audio only)
  if ('albumArtUrl' in metadata && metadata.albumArtUrl) {
    imagePromises.push(
      imageService.downloadAndSaveImage(metadata.albumArtUrl, {
        imageType: 'AlbumArt',
        mediaId,
        isPrimary: true,
        scraperId,
      }).then((result) => {
        if (result.success) {
          console.log(`📷 Downloaded album art for media ${mediaId}`);
        }
      }).catch((error) => {
        console.warn(`Failed to download album art:`, error);
      })
    );
  }

  // Wait for all image downloads
  await Promise.all(imagePromises);
}

/**
 * Apply audio metadata to the database
 */
async function applyAudioMetadata(mediaId: string, metadata: AudioMetadata, scraperId?: string): Promise<void> {
  await prisma.audioDetails.upsert({
    where: { mediaId },
    create: {
      mediaId,
      artist: metadata.artist,
      albumArtist: metadata.albumArtist,
      album: metadata.album,
      track: metadata.track,
      disc: metadata.disc,
      year: metadata.year,
      genre: metadata.genre,
    },
    update: {
      artist: metadata.artist,
      albumArtist: metadata.albumArtist,
      album: metadata.album,
      track: metadata.track,
      disc: metadata.disc,
      year: metadata.year,
      genre: metadata.genre,
    },
  });

  // Update media name with track title
  if (metadata.title) {
    await prisma.media.update({
      where: { id: mediaId },
      data: { name: metadata.title },
    });
  }

  // Download album art if available
  await downloadMediaImages(mediaId, metadata, scraperId);
}

/**
 * Extract show name from a filename that might contain episode info
 * e.g., "Breaking Bad S01E01" -> "Breaking Bad"
 */
function extractShowName(filename: string): string {
  // Remove common episode patterns
  const patterns = [
    /\s*S\d{1,2}E\d{1,2}.*/i, // S01E01
    /\s*\d{1,2}x\d{1,2}.*/i, // 1x01
    /\s*-?\s*\d{1,2}\d{2}.*/, // 101 (season 1 episode 01)
    /\s*\[.*\].*/, // [anything]
    /\s*\(.*\).*/, // (anything)
  ];

  let result = filename;
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }

  return result.trim();
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
metadataScrapeWorker.on('completed', (job, result) => {
  if (result.success) {
    console.log(`✅ Metadata scrape ${job.id} completed via ${result.scraperId}`);
  } else {
    console.log(`⚠️ Metadata scrape ${job.id} completed but no metadata found`);
  }
});

metadataScrapeWorker.on('failed', (job, error) => {
  console.error(`❌ Metadata scrape ${job?.id} failed:`, error.message);
});

metadataScrapeWorker.on('error', (error) => {
  console.error('Metadata scrape worker error:', error);
});

metadataScrapeWorker.on('ready', () => {
  console.log('🔍 Metadata scrape worker is ready');
});
