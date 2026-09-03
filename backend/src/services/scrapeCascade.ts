/**
 * Re-queue the children of a show once the show itself has been identified.
 *
 * Seasons and episodes cannot be looked up on their own: both are addressed
 * by the show's external id plus a number. Previously the scan queued season
 * jobs behind a fixed delay and hoped the show jobs had finished by then, and
 * Identify changed only the show, leaving its seasons and episodes pointing at
 * whatever the original search had guessed. Both paths now run from here, off
 * the show job's success, with the identity passed down explicitly.
 */

import * as path from 'path';
import { prisma } from '../config/database';
import {
  addBulkCollectionScrapeJobs,
  type CascadeDepth,
  type CollectionScrapeJobData,
} from '../queues/collectionScrapeQueue';
import { addBulkMetadataScrapeJobs, type MetadataScrapeJobData } from '../queues/metadataScrapeQueue';
import { parseEpisodeFromFilename } from '../utils/mediaParser';

export interface CascadeIdentity {
  scraperId: string
  externalId: string
}

export interface CascadeOptions {
  skipImages?: boolean
  imagesOnly?: boolean
  cascade?: CascadeDepth
}

export interface CascadeDeps {
  queueCollectionScrapes?: (jobs: CollectionScrapeJobData[]) => Promise<unknown>
  queueMediaScrapes?: (jobs: MetadataScrapeJobData[]) => Promise<unknown>
}

/** Read a season number out of a folder name: "Season 3", "season03", "Specials". */
export function seasonNumberFromName(name: string): number | undefined {
  const match = name.match(/season\s*(\d+)/i);
  if (match) return parseInt(match[1], 10);
  if (/^specials?$/i.test(name.trim())) return 0;
  return undefined;
}

/**
 * Queue a scrape for every season of a show, using the show's identity.
 *
 * Returns the number of jobs queued.
 */
export async function queueSeasonScrapes(
  showCollectionId: string,
  identity: CascadeIdentity,
  options: CascadeOptions = {},
  deps: CascadeDeps = {}
): Promise<number> {
  const seasons = await prisma.collection.findMany({
    where: { parentId: showCollectionId, collectionType: 'Season' },
    include: { seasonDetails: true },
  });

  const jobs: CollectionScrapeJobData[] = [];
  for (const season of seasons) {
    const seasonNumber = season.seasonDetails?.seasonNumber ?? seasonNumberFromName(season.name);
    if (seasonNumber === undefined) {
      console.warn(`⏭️ Skipping season scrape for "${season.name}": no season number`);
      continue;
    }
    jobs.push({
      collectionId: season.id,
      collectionName: season.name,
      collectionType: 'Season',
      parentShowId: showCollectionId,
      parentExternalId: identity.externalId,
      parentScraperId: identity.scraperId,
      seasonNumber,
      skipImages: options.skipImages,
      imagesOnly: options.imagesOnly,
      cascade: options.cascade,
    });
  }

  if (jobs.length === 0) return 0;

  const queue = deps.queueCollectionScrapes ?? addBulkCollectionScrapeJobs;
  await queue(jobs);
  console.log(`↳ Queued ${jobs.length} season scrape(s) for show ${showCollectionId}`);
  return jobs.length;
}

/**
 * Queue a scrape for every episode file in a season, carrying the show's
 * identity so the episode is fetched rather than searched for again.
 */
export async function queueEpisodeScrapes(
  seasonCollectionId: string,
  identity: CascadeIdentity,
  seasonNumber: number,
  options: CascadeOptions = {},
  deps: CascadeDeps = {}
): Promise<number> {
  const season = await prisma.collection.findUnique({
    where: { id: seasonCollectionId },
    include: {
      parent: true,
      media: { where: { type: 'Video' }, include: { videoDetails: true } },
    },
  });

  if (!season) return 0;
  const showName = season.parent?.name;

  const jobs: MetadataScrapeJobData[] = [];
  for (const media of season.media) {
    const fileName = path.basename(media.path, path.extname(media.path));
    const parsed = parseEpisodeFromFilename(fileName);
    const episode = media.videoDetails?.episode ?? parsed?.episode;
    if (episode === undefined) {
      console.warn(`⏭️ Skipping episode scrape for "${media.name}": no episode number`);
      continue;
    }
    jobs.push({
      mediaId: media.id,
      mediaName: media.name,
      mediaType: 'Video',
      showName,
      season: media.videoDetails?.season ?? parsed?.season ?? seasonNumber,
      episode,
      scraperId: identity.scraperId,
      showExternalId: identity.externalId,
      skipImages: options.skipImages,
      imagesOnly: options.imagesOnly,
    });
  }

  if (jobs.length === 0) return 0;

  const queue = deps.queueMediaScrapes ?? addBulkMetadataScrapeJobs;
  await queue(jobs);
  console.log(`↳ Queued ${jobs.length} episode scrape(s) for season ${seasonCollectionId}`);
  return jobs.length;
}
