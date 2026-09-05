import type { ScrapeStatus } from '@prisma/client';
import { prisma } from '../config/database';

/**
 * Which of a library's items got their metadata, and which did not.
 *
 * Per-item scrape status has been stored since 2026-09-03 and shown on the
 * collection and media pages, which answers the question one item at a time. On
 * a library of thirty thousand files that is not an answer at all: nobody opens
 * thirty thousand pages to find the eleven that failed. These two queries turn
 * it into a list.
 */

/** A status of `null` means nothing has been attempted for the item yet. */
export type ScrapeOverviewStatus = ScrapeStatus | 'Unscraped';

export type ScrapeCounts = Record<ScrapeOverviewStatus, number>;

export interface ScrapeOverview {
  /** Shows, seasons and films */
  collections: ScrapeCounts
  /** Episodes and other media files */
  media: ScrapeCounts
}

const EMPTY_COUNTS: ScrapeCounts = {
  Matched: 0,
  NoMatch: 0,
  Failed: 0,
  Pending: 0,
  Unscraped: 0,
};

/** Statuses a viewer can act on, in the order the overview lists them. */
export const ACTIONABLE_STATUSES: ScrapeOverviewStatus[] = ['NoMatch', 'Failed', 'Pending', 'Unscraped'];

function toCounts(rows: { scrapeStatus: ScrapeStatus | null; _count: { _all: number } }[]): ScrapeCounts {
  const counts: ScrapeCounts = { ...EMPTY_COUNTS };
  for (const row of rows) {
    counts[row.scrapeStatus ?? 'Unscraped'] += row._count._all;
  }
  return counts;
}

/** Counts by scrape status for everything in a library. */
export async function getScrapeOverview(libraryId: string): Promise<ScrapeOverview> {
  const [collections, media] = await Promise.all([
    prisma.collection.groupBy({
      by: ['scrapeStatus'],
      where: { libraryId },
      _count: { _all: true },
    }),
    prisma.media.groupBy({
      by: ['scrapeStatus'],
      where: { collection: { libraryId } },
      _count: { _all: true },
    }),
  ]);
  return { collections: toCounts(collections), media: toCounts(media) };
}

export interface UnmatchedItem {
  id: string
  kind: 'collection' | 'media'
  name: string
  /** `CollectionType` for a collection, `MediaType` for a media item */
  type: string
  /** The show or season this sits under, when it has one */
  parentName: string | null
  status: ScrapeOverviewStatus
  message: string | null
  scrapedAt: Date | null
}

export interface UnmatchedPage {
  items: UnmatchedItem[]
  total: number
}

export interface UnmatchedQuery {
  /** Which statuses to list; defaults to everything a viewer can act on. */
  statuses?: ScrapeOverviewStatus[]
  /** Restrict to one kind, or list both interleaved by name. */
  kind?: 'collection' | 'media'
  skip?: number
  take?: number
}

/** Turn the requested statuses into a Prisma filter, `Unscraped` meaning null. */
function statusFilter(statuses: ScrapeOverviewStatus[]) {
  const named = statuses.filter((s): s is ScrapeStatus => s !== 'Unscraped');
  const includesUnscraped = statuses.includes('Unscraped');
  if (named.length > 0 && includesUnscraped) {
    return { OR: [{ scrapeStatus: { in: named } }, { scrapeStatus: null }] };
  }
  if (includesUnscraped) return { scrapeStatus: null };
  return { scrapeStatus: { in: named } };
}

/**
 * The items in a library whose metadata did not land, newest attempt first so
 * whatever just failed is at the top. Items never attempted have no timestamp
 * to sort by and follow, by name.
 */
export async function listUnmatched(
  libraryId: string,
  query: UnmatchedQuery = {}
): Promise<UnmatchedPage> {
  const statuses = query.statuses?.length ? query.statuses : ACTIONABLE_STATUSES;
  const filter = statusFilter(statuses);
  const skip = Math.max(0, query.skip ?? 0);
  const take = Math.min(200, Math.max(1, query.take ?? 50));

  const wantCollections = query.kind !== 'media';
  const wantMedia = query.kind !== 'collection';

  const [collectionRows, collectionTotal, mediaRows, mediaTotal] = await Promise.all([
    wantCollections
      ? prisma.collection.findMany({
          where: { libraryId, ...filter },
          select: {
            id: true,
            name: true,
            collectionType: true,
            scrapeStatus: true,
            scrapeMessage: true,
            scrapedAt: true,
            parent: { select: { name: true } },
          },
          orderBy: [{ scrapedAt: 'desc' }, { name: 'asc' }],
          // Both halves are fetched to the end of the requested window and
          // merged, since neither can be paged independently of the other.
          take: skip + take,
        })
      : [],
    wantCollections ? prisma.collection.count({ where: { libraryId, ...filter } }) : 0,
    wantMedia
      ? prisma.media.findMany({
          where: { collection: { libraryId }, ...filter },
          select: {
            id: true,
            name: true,
            type: true,
            scrapeStatus: true,
            scrapeMessage: true,
            scrapedAt: true,
            collection: { select: { name: true } },
          },
          orderBy: [{ scrapedAt: 'desc' }, { name: 'asc' }],
          take: skip + take,
        })
      : [],
    wantMedia ? prisma.media.count({ where: { collection: { libraryId }, ...filter } }) : 0,
  ]);

  const items: UnmatchedItem[] = [
    ...collectionRows.map((row) => ({
      id: row.id,
      kind: 'collection' as const,
      name: row.name,
      type: row.collectionType as string,
      parentName: row.parent?.name ?? null,
      status: (row.scrapeStatus ?? 'Unscraped') as ScrapeOverviewStatus,
      message: row.scrapeMessage,
      scrapedAt: row.scrapedAt,
    })),
    ...mediaRows.map((row) => ({
      id: row.id,
      kind: 'media' as const,
      name: row.name,
      type: row.type as string,
      parentName: row.collection?.name ?? null,
      status: (row.scrapeStatus ?? 'Unscraped') as ScrapeOverviewStatus,
      message: row.scrapeMessage,
      scrapedAt: row.scrapedAt,
    })),
  ];

  items.sort((a, b) => {
    if (a.scrapedAt && b.scrapedAt) return b.scrapedAt.getTime() - a.scrapedAt.getTime();
    if (a.scrapedAt) return -1;
    if (b.scrapedAt) return 1;
    return a.name.localeCompare(b.name);
  });

  return { items: items.slice(skip, skip + take), total: collectionTotal + mediaTotal };
}
