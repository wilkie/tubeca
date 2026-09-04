import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';

/**
 * The full-text index behind search.
 *
 * `LIKE '%q%'` on `name` alone could not find a film by its cast, its plot or
 * one of its tags, ranked nothing, and scanned every row. This keeps one FTS5
 * row per collection and per media item, holding the title, alternative
 * titles, the description, the keyword names and the cast, so a search over
 * any of those returns matches in relevance order.
 *
 * Rows are written where the text is written: by the importer when a file or
 * folder appears, and by the scrape workers when metadata arrives. Nothing
 * here is authoritative, so a lost or stale index is repaired by a rebuild
 * rather than being a data-loss problem.
 */

export type SearchEntityType = 'collection' | 'media'

export interface SearchIndexRow {
  entityId: string
  entityType: SearchEntityType
  libraryId: string | null
  contentRating: string | null
  name: string
  altNames: string
  description: string
  keywords: string
  people: string
}

export interface SearchIndexQuery {
  /** Raw text as the user typed it. */
  query: string
  entityType: SearchEntityType
  /** Restrict to these libraries; undefined means no restriction (an admin). */
  libraryIds?: string[]
  excludedRatings?: string[]
  limit: number
  offset: number
}

export interface SearchIndexHits {
  ids: string[]
  total: number
}

/**
 * Turn what someone typed into an FTS5 query.
 *
 * FTS5's own syntax (quotes, `*`, `:`, `NOT`, `-`) would either throw or mean
 * something surprising if a title contained it, so every token is quoted as a
 * literal. The last token gets a prefix match, which is what makes search feel
 * live: "blade run" finds Blade Runner before the word is finished.
 */
export function toMatchQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  if (tokens.length === 0) return null;

  return tokens
    .map((token, index) => (index === tokens.length - 1 ? `"${token}"*` : `"${token}"`))
    .join(' ');
}

/** Column weights for bm25, in table order. Unindexed columns never match. */
const BM25_WEIGHTS = '0.0, 0.0, 0.0, 0.0, 10.0, 6.0, 1.0, 3.0, 2.0';

function joinNames(values: Array<string | null | undefined>): string {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim())))).join(' ');
}

/** What `indexCollection` and the rebuild both need to load. */
const COLLECTION_INCLUDE = {
  keywords: { select: { name: true } },
  showDetails: { select: { description: true, credits: { select: { name: true }, take: 30 } } },
  filmDetails: {
    select: {
      description: true,
      originalTitle: true,
      contentRating: true,
      credits: { select: { name: true }, take: 30 },
    },
  },
  seasonDetails: { select: { description: true } },
  albumDetails: { select: { description: true } },
  artistDetails: { select: { biography: true } },
} as const;

const MEDIA_INCLUDE = {
  collection: { select: { libraryId: true, name: true, parent: { select: { name: true } } } },
  videoDetails: {
    select: { description: true, showName: true, credits: { select: { name: true }, take: 30 } },
  },
  audioDetails: { select: { artist: true, album: true, albumArtist: true } },
} as const;

type CollectionWithText = Prisma.CollectionGetPayload<{ include: typeof COLLECTION_INCLUDE }>
type MediaWithText = Prisma.MediaGetPayload<{ include: typeof MEDIA_INCLUDE }>

function collectionRow(collection: CollectionWithText): SearchIndexRow {
  return {
    entityId: collection.id,
    entityType: 'collection',
    libraryId: collection.libraryId,
    contentRating: collection.filmDetails?.contentRating ?? null,
    name: collection.name,
    altNames: joinNames([collection.filmDetails?.originalTitle]),
    description: joinNames([
      collection.showDetails?.description,
      collection.filmDetails?.description,
      collection.seasonDetails?.description,
      collection.albumDetails?.description,
      collection.artistDetails?.biography,
    ]),
    keywords: joinNames(collection.keywords.map((k) => k.name)),
    people: joinNames([
      ...(collection.showDetails?.credits.map((c) => c.name) ?? []),
      ...(collection.filmDetails?.credits.map((c) => c.name) ?? []),
    ]),
  };
}

function mediaRow(media: MediaWithText): SearchIndexRow {
  return {
    entityId: media.id,
    entityType: 'media',
    libraryId: media.collection?.libraryId ?? null,
    contentRating: null,
    name: media.name,
    // The show and season an episode sits under, so "betty season 2" works.
    altNames: joinNames([
      media.videoDetails?.showName,
      media.collection?.name,
      media.collection?.parent?.name,
      media.audioDetails?.artist,
      media.audioDetails?.album,
      media.audioDetails?.albumArtist,
    ]),
    description: joinNames([media.videoDetails?.description]),
    keywords: '',
    people: joinNames(media.videoDetails?.credits.map((c) => c.name) ?? []),
  };
}

/** Rows per INSERT during a rebuild; nine parameters each, well under SQLite's limit. */
const INSERT_CHUNK = 50;

export class SearchIndexService {
  /** Replace the index row for one entity. */
  private async write(row: SearchIndexRow): Promise<void> {
    await this.remove(row.entityId);
    await prisma.$executeRawUnsafe(
      `INSERT INTO search_index (entityId, entityType, libraryId, contentRating, name, altNames, description, keywords, people)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.entityId,
      row.entityType,
      row.libraryId,
      row.contentRating,
      row.name,
      row.altNames,
      row.description,
      row.keywords,
      row.people
    );
  }

  /** Drop the row for an entity that was deleted or is being rewritten. */
  async remove(entityId: string): Promise<void> {
    await prisma.$executeRawUnsafe(`DELETE FROM search_index WHERE entityId = ?`, entityId);
  }

  /** Index one collection, gathering its text from the details and credits. */
  async indexCollection(collectionId: string): Promise<void> {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      include: COLLECTION_INCLUDE,
    });
    if (!collection) return;
    await this.write(collectionRow(collection));
  }

  /** Index one media item: its own name plus the show and episode it belongs to. */
  async indexMedia(mediaId: string): Promise<void> {
    const media = await prisma.media.findUnique({ where: { id: mediaId }, include: MEDIA_INCLUDE });
    if (!media) return;
    await this.write(mediaRow(media));
  }

  /** How many rows the index holds; zero means it has never been built. */
  async size(): Promise<number> {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*) AS count FROM search_index`
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Rebuild from scratch. Used on first boot after the index was added, and
   * by the admin reindex endpoint when something looks stale.
   */
  async rebuild(onProgress?: (done: number, total: number) => void): Promise<{ collections: number; media: number }> {
    await prisma.$executeRawUnsafe(`DELETE FROM search_index`);

    const [collectionCount, mediaCount] = await Promise.all([prisma.collection.count(), prisma.media.count()]);
    const total = collectionCount + mediaCount;
    let done = 0;

    // Read and write in batches: a library of a few thousand titles would
    // otherwise be one query and one insert per row, which takes minutes.
    const PAGE = 500;

    for (let skip = 0; skip < collectionCount; skip += PAGE) {
      const page = await prisma.collection.findMany({
        include: COLLECTION_INCLUDE,
        orderBy: { id: 'asc' },
        skip,
        take: PAGE,
      });
      await this.insertMany(page.map(collectionRow));
      done += page.length;
      onProgress?.(done, total);
    }

    for (let skip = 0; skip < mediaCount; skip += PAGE) {
      const page = await prisma.media.findMany({
        include: MEDIA_INCLUDE,
        orderBy: { id: 'asc' },
        skip,
        take: PAGE,
      });
      await this.insertMany(page.map(mediaRow));
      done += page.length;
      onProgress?.(done, total);
    }

    return { collections: collectionCount, media: mediaCount };
  }

  /** Insert rows in chunks, without deleting first: only a rebuild uses this. */
  private async insertMany(rows: SearchIndexRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params = chunk.flatMap((row) => [
        row.entityId,
        row.entityType,
        row.libraryId,
        row.contentRating,
        row.name,
        row.altNames,
        row.description,
        row.keywords,
        row.people,
      ]);
      await prisma.$executeRawUnsafe(
        `INSERT INTO search_index (entityId, entityType, libraryId, contentRating, name, altNames, description, keywords, people)
         VALUES ${values}`,
        ...params
      );
    }
  }

  /**
   * Ids matching the query, best first, plus how many matched in total.
   *
   * Library access and the rating exclusion are applied here rather than
   * afterwards, so the page of ids handed back is already the page to show.
   */
  async search(input: SearchIndexQuery): Promise<SearchIndexHits> {
    const match = toMatchQuery(input.query);
    if (!match) return { ids: [], total: 0 };

    const conditions = ['search_index MATCH ?', 'entityType = ?'];
    const params: unknown[] = [match, input.entityType];

    if (input.libraryIds) {
      if (input.libraryIds.length === 0) return { ids: [], total: 0 };
      conditions.push(`libraryId IN (${input.libraryIds.map(() => '?').join(', ')})`);
      params.push(...input.libraryIds);
    }

    if (input.excludedRatings && input.excludedRatings.length > 0) {
      conditions.push(
        `(contentRating IS NULL OR contentRating = '' OR contentRating NOT IN (${input.excludedRatings
          .map(() => '?')
          .join(', ')}))`
      );
      params.push(...input.excludedRatings);
    }

    const where = conditions.join(' AND ');

    const totals = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*) AS count FROM search_index WHERE ${where}`,
      ...params
    );

    const rows = await prisma.$queryRawUnsafe<Array<{ entityId: string }>>(
      `SELECT entityId FROM search_index
       WHERE ${where}
       ORDER BY bm25(search_index, ${BM25_WEIGHTS})
       LIMIT ? OFFSET ?`,
      ...params,
      input.limit,
      input.offset
    );

    return { ids: rows.map((r) => r.entityId), total: Number(totals[0]?.count ?? 0) };
  }
}

export const searchIndexService = new SearchIndexService();
