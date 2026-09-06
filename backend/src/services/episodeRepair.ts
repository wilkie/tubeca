import * as path from 'path';
import { prisma } from '../config/database';
import { parseEpisodeFromFilename, parseSeasonFromFolderName } from '../utils/mediaParser';
import { addBulkMetadataScrapeJobs } from '../queues/metadataScrapeQueue';
import { markMediaScrapePending } from './scrapeResolution';
import type { MetadataScrapeJobData } from '../queues/metadataScrapeQueue';

/**
 * Give episodes back the season and episode numbers nobody read at import.
 *
 * A media row without them cannot be scraped: `metadataScrapeWorker` addresses
 * an episode as `getEpisodeMetadata(showExternalId, season, episode)`, and with
 * any of the three missing it falls back to searching the provider for the
 * file's name — which for `14 - Karen Peralta.mkv` can only ever be a `NoMatch`.
 *
 * Two things put rows in that state. Files whose names the parser could not
 * read until it learned to look at the folder, and files imported before it
 * could read them at all, which nothing re-parses.
 */

export interface RepairReport {
  /** Rows examined: episodes with no season or episode number */
  examined: number
  /** Rows the parser could read, and which now have numbers */
  repaired: number
  /** Of those, how many were queued for a scrape */
  queued: number
  /** Rows whose names still say nothing */
  unreadable: number
}

export interface RepairOptions {
  /** Report what would change without writing anything. */
  dryRun?: boolean
  /** Queue a metadata scrape for each repaired row. */
  rescrape?: boolean
}

/** Read the numbers out of a file's own path. */
export function readEpisodeFromPath(filePath: string): { season: number; episode: number } | null {
  const base = path.basename(filePath, path.extname(filePath));
  const folder = path.basename(path.dirname(filePath));
  const parsed = parseEpisodeFromFilename(base, {
    seasonHint: parseSeasonFromFolderName(folder),
  });
  return parsed ? { season: parsed.season, episode: parsed.episode } : null;
}

/**
 * Re-parse the episodes of one library, or of every Television library when no
 * id is given.
 */
export async function repairEpisodeNumbers(
  libraryId?: string,
  options: RepairOptions = {}
): Promise<RepairReport> {
  const candidates = await prisma.media.findMany({
    where: {
      type: 'Video',
      collection: {
        library: { libraryType: 'Television', ...(libraryId ? { id: libraryId } : {}) },
      },
      // Either no detail row at all, or one that never learned its numbers.
      OR: [{ videoDetails: { is: null } }, { videoDetails: { episode: null } }],
    },
    select: {
      id: true,
      name: true,
      path: true,
      videoDetails: { select: { id: true } },
      collection: {
        select: {
          name: true,
          parent: {
            select: {
              name: true,
              showDetails: { select: { scraperId: true, externalId: true } },
            },
          },
        },
      },
    },
  });

  const report: RepairReport = {
    examined: candidates.length,
    repaired: 0,
    queued: 0,
    unreadable: 0,
  };
  const jobs: MetadataScrapeJobData[] = [];

  for (const media of candidates) {
    const numbers = readEpisodeFromPath(media.path);
    if (!numbers) {
      report.unreadable++;
      continue;
    }
    report.repaired++;

    if (!options.dryRun) {
      // `update` where a detail row exists, `create` where it does not; the
      // row holds the scraped description and credits too, which must survive.
      if (media.videoDetails) {
        await prisma.videoDetails.update({
          where: { id: media.videoDetails.id },
          data: { season: numbers.season, episode: numbers.episode },
        });
      } else {
        await prisma.videoDetails.create({
          data: { mediaId: media.id, season: numbers.season, episode: numbers.episode },
        });
      }
    }

    if (options.rescrape) {
      const show = media.collection?.parent;
      jobs.push({
        mediaId: media.id,
        mediaName: media.name,
        mediaType: 'Video',
        showName: show?.name,
        season: numbers.season,
        episode: numbers.episode,
        // The point of the exercise: with the show's identity and the two
        // numbers, the worker fetches the episode instead of searching for it.
        scraperId: show?.showDetails?.scraperId ?? undefined,
        showExternalId: show?.showDetails?.externalId ?? undefined,
      });
    }
  }

  if (options.rescrape && !options.dryRun && jobs.length > 0) {
    await markMediaScrapePending(jobs.map((job) => job.mediaId));
    await addBulkMetadataScrapeJobs(jobs);
    report.queued = jobs.length;
  }

  return report;
}
