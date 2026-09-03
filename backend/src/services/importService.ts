import * as fs from 'fs';
import * as path from 'path';
import { Prisma, type CollectionType, type LibraryType, type StreamType } from '@prisma/client';
import { prisma } from '../config/database';
import { probeMediaFile, type StreamInfo } from '../utils/ffprobe';
import { VIDEO_EXTENSIONS, getCollectionType } from '../utils/libraryLayout';
import {
  parseEpisodeFromFilename,
  parseTitleAndYear,
  getShowNameFromCollectionPath,
} from '../utils/mediaParser';
import {
  addBulkMetadataScrapeJobs,
  type MetadataScrapeJobData,
} from '../queues/metadataScrapeQueue';
import {
  addBulkCollectionScrapeJobs,
  type CollectionScrapeJobData,
  type CollectionScrapeType,
} from '../queues/collectionScrapeQueue';
import { ContentDeletionService } from './contentDeletionService';

/** Hints handed to the metadata scrape queue for one media file. */
export interface MediaHints {
  id: string
  name: string
  type: 'Video' | 'Audio'
  showName?: string
  season?: number
  episode?: number
  year?: number
}

/** Hints handed to the collection scrape queue for one folder. */
export interface CollectionHints {
  id: string
  name: string
  collectionType: CollectionType
  parentId: string | null
  seasonNumber?: number
  year?: number
}

export interface ImportedMedia {
  mediaId: string
  created: boolean
  hints: MediaHints
}

export interface EnsuredCollection {
  id: string
  collectionType: CollectionType
  created: boolean
  hints: CollectionHints
}

export interface ImportServiceDeps {
  probe: typeof probeMediaFile
  queueMediaScrapes: typeof addBulkMetadataScrapeJobs
  queueCollectionScrapes: typeof addBulkCollectionScrapeJobs
  deletion: ContentDeletionService
}

const SCRAPEABLE_TYPES: CollectionType[] = ['Show', 'Season', 'Film', 'Artist', 'Album'];
const SCRAPE_ORDER: CollectionType[] = ['Show', 'Season', 'Film', 'Artist', 'Album'];

/** Film metadata is attached to the Film collection, not the media file, so film media is not scraped. */
export function shouldScrapeMedia(libraryType: LibraryType): boolean {
  return libraryType !== 'Film';
}

/**
 * Derive scrape hints for a media file from its name and the folder chain
 * above it. Pure; shared by the scanner and the file watcher so both produce
 * the same hints.
 */
export function buildMediaHints(
  mediaId: string,
  libraryType: LibraryType,
  fileBaseName: string,
  collectionPath: string[],
  mediaType: 'Video' | 'Audio'
): MediaHints {
  const folderName = collectionPath.length > 0 ? collectionPath[collectionPath.length - 1] : undefined;
  // In Film libraries the folder carries the clean title ("The Matrix (1999)").
  const name = libraryType === 'Film' && folderName ? folderName : fileBaseName;
  const hints: MediaHints = { id: mediaId, name, type: mediaType };

  if (mediaType !== 'Video') return hints;

  const episode = parseEpisodeFromFilename(fileBaseName);
  if (episode) {
    hints.season = episode.season;
    hints.episode = episode.episode;
    hints.showName = episode.showName || getShowNameFromCollectionPath(collectionPath);
    return hints;
  }

  const { year } = parseTitleAndYear(folderName ?? fileBaseName);
  if (year) hints.year = year;
  return hints;
}

/** Derive scrape hints for a folder. Pure. */
export function buildCollectionHints(
  id: string,
  name: string,
  collectionType: CollectionType,
  parentId: string | null
): CollectionHints {
  const hints: CollectionHints = { id, name, collectionType, parentId };
  if (collectionType === 'Season') {
    const match = name.match(/season\s*(\d+)/i);
    if (match) hints.seasonNumber = parseInt(match[1], 10);
  }
  if (collectionType === 'Film') {
    const { year } = parseTitleAndYear(name);
    if (year) hints.year = year;
  }
  return hints;
}

/**
 * Turns on-disk folders and files into collections and media. Used by both
 * the library scan worker and the file watcher so the two import paths cannot
 * drift apart.
 */
export class ImportService {
  private readonly deps: ImportServiceDeps;

  constructor(deps: Partial<ImportServiceDeps> = {}) {
    this.deps = {
      probe: deps.probe ?? probeMediaFile,
      queueMediaScrapes: deps.queueMediaScrapes ?? addBulkMetadataScrapeJobs,
      queueCollectionScrapes: deps.queueCollectionScrapes ?? addBulkCollectionScrapeJobs,
      deletion: deps.deletion ?? new ContentDeletionService(),
    };
  }

  /**
   * Find or create the collection for a folder. An existing collection whose
   * type no longer matches the layout rule (e.g. the library type changed)
   * is re-typed in place.
   */
  async ensureCollection(
    libraryId: string,
    libraryType: LibraryType,
    name: string,
    parentId: string | null,
    depth: number
  ): Promise<EnsuredCollection> {
    const collectionType = getCollectionType(libraryType, depth);
    let collection = await prisma.collection.findFirst({
      where: { libraryId, name, parentId },
      select: { id: true, collectionType: true },
    });
    let created = false;

    if (!collection) {
      collection = await prisma.collection.create({
        data: { name, libraryId, parentId, collectionType },
        select: { id: true, collectionType: true },
      });
      created = true;
    } else if (collection.collectionType !== collectionType) {
      collection = await prisma.collection.update({
        where: { id: collection.id },
        data: { collectionType },
        select: { id: true, collectionType: true },
      });
    }

    return {
      id: collection.id,
      collectionType,
      created,
      hints: buildCollectionHints(collection.id, name, collectionType, parentId),
    };
  }

  /** Find or create the whole chain for a relative folder path; returns the leaf and every collection touched. */
  async ensureCollectionPath(
    libraryId: string,
    libraryType: LibraryType,
    parts: string[]
  ): Promise<{ leafId: string | null; collections: EnsuredCollection[] }> {
    const collections: EnsuredCollection[] = [];
    let parentId: string | null = null;
    let depth = 0;
    for (const part of parts) {
      if (!part || part === '.') continue;
      const ensured = await this.ensureCollection(libraryId, libraryType, part, parentId, depth);
      collections.push(ensured);
      parentId = ensured.id;
      depth++;
    }
    return { leafId: parentId, collections };
  }

  /**
   * Import one media file: probe it, create the `Media` and `MediaStream`
   * rows, detect a sibling `.trickplay` folder. Idempotent on `Media.path`;
   * a concurrent insert of the same path is tolerated.
   */
  async importMediaFile(opts: {
    libraryType: LibraryType
    filePath: string
    parentCollectionId: string | null
    collectionPath: string[]
  }): Promise<ImportedMedia> {
    const { libraryType, filePath, parentCollectionId, collectionPath } = opts;
    const ext = path.extname(filePath).toLowerCase();
    const fileBaseName = path.basename(filePath, ext);
    const mediaType: 'Video' | 'Audio' = VIDEO_EXTENSIONS.includes(ext) ? 'Video' : 'Audio';
    const hintsFor = (id: string) => buildMediaHints(id, libraryType, fileBaseName, collectionPath, mediaType);

    const existing = await prisma.media.findUnique({ where: { path: filePath }, select: { id: true } });
    if (existing) {
      return { mediaId: existing.id, created: false, hints: hintsFor(existing.id) };
    }

    let thumbnails: string | null = null;
    if (mediaType === 'Video') {
      const trickplayPath = path.join(path.dirname(filePath), `${fileBaseName}.trickplay`);
      try {
        if (fs.statSync(trickplayPath).isDirectory()) thumbnails = trickplayPath;
      } catch {
        // no trickplay folder
      }
    }

    const probe = await this.deps.probe(filePath);
    const name = hintsFor('').name;

    try {
      const media = await prisma.media.create({
        data: {
          path: filePath,
          name,
          duration: probe.duration,
          type: mediaType,
          ...(thumbnails && { thumbnails }),
          collectionId: parentCollectionId,
          streams: {
            create: probe.streams.map((stream: StreamInfo) => ({
              streamIndex: stream.streamIndex,
              streamType: stream.streamType as StreamType,
              codec: stream.codec,
              codecLong: stream.codecLong,
              language: stream.language,
              title: stream.title,
              isDefault: stream.isDefault,
              isForced: stream.isForced,
              channels: stream.channels,
              channelLayout: stream.channelLayout,
              sampleRate: stream.sampleRate,
              bitRate: stream.bitRate,
              width: stream.width,
              height: stream.height,
              frameRate: stream.frameRate,
            })),
          },
        },
        select: { id: true },
      });
      return { mediaId: media.id, created: true, hints: hintsFor(media.id) };
    } catch (error) {
      // Unique violation: someone (the watcher, another scan) imported it first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await prisma.media.findUnique({ where: { path: filePath }, select: { id: true } });
        if (raced) return { mediaId: raced.id, created: false, hints: hintsFor(raced.id) };
      }
      throw error;
    }
  }

  /** Queue metadata scrapes for media hints (no-op for Film libraries, whose metadata lives on the collection). */
  async queueMediaScrapes(libraryType: LibraryType, hints: MediaHints[]): Promise<number> {
    if (!shouldScrapeMedia(libraryType) || hints.length === 0) return 0;
    const jobs: MetadataScrapeJobData[] = hints.map((h) => ({
      mediaId: h.id,
      mediaName: h.name,
      mediaType: h.type,
      showName: h.showName,
      season: h.season,
      episode: h.episode,
      year: h.year,
    }));
    await this.deps.queueMediaScrapes(jobs);
    return jobs.length;
  }

  /** Queue collection scrapes, parents before children (shows, then seasons, ...). */
  async queueCollectionScrapes(hints: CollectionHints[]): Promise<number> {
    const scrapeable = hints.filter((h) => SCRAPEABLE_TYPES.includes(h.collectionType));
    if (scrapeable.length === 0) return 0;
    const ordered = SCRAPE_ORDER.flatMap((type) => scrapeable.filter((h) => h.collectionType === type));
    const jobs: CollectionScrapeJobData[] = ordered.map((h) => ({
      collectionId: h.id,
      collectionName: h.name,
      collectionType: h.collectionType as CollectionScrapeType,
      parentShowId: h.collectionType === 'Season' || h.collectionType === 'Album' ? h.parentId ?? undefined : undefined,
      seasonNumber: h.seasonNumber,
      year: h.year,
    }));
    await this.deps.queueCollectionScrapes(jobs);
    return jobs.length;
  }

  /**
   * Remove media and collections in a library that a complete walk did not
   * see. Files that disappeared while nothing was watching are cleaned up here,
   * along with their artwork.
   */
  async removeMissing(
    libraryId: string,
    seenCollectionIds: Set<string>,
    seenMediaIds: Set<string>
  ): Promise<{ collections: number; media: number }> {
    const removed = { collections: 0, media: 0 };

    const staleMedia = await prisma.media.findMany({
      where: { collection: { libraryId }, id: { notIn: [...seenMediaIds] } },
      select: { id: true },
    });
    for (const media of staleMedia) {
      if (await this.deps.deletion.deleteMedia(media.id)) removed.media++;
    }

    const staleCollections = await prisma.collection.findMany({
      where: { libraryId, id: { notIn: [...seenCollectionIds] } },
      select: { id: true },
    });
    for (const collection of staleCollections) {
      // A parent removed earlier in this loop already cascaded to this one.
      const result = await this.deps.deletion.deleteCollectionTree(collection.id);
      if (result) removed.collections += result.collections;
    }

    return removed;
  }
}

export const importService = new ImportService();
