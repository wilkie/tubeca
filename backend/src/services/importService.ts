import { promises as fsp } from 'fs';
import * as path from 'path';
import { Prisma, type CollectionType, type LibraryType, type ScrapeStatus, type StreamType } from '@prisma/client';
import { prisma } from '../config/database';
import { probeMediaFile, type StreamInfo } from '../utils/ffprobe';
import { VIDEO_EXTENSIONS, getCollectionType } from '../utils/libraryLayout';
import { listDirectory, matchSidecars } from '../utils/subtitleSidecars';
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
import { markCollectionScrapePending, markMediaScrapePending } from './scrapeResolution';

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
  /** A brand new row was created */
  created: boolean
  /** An existing row was re-pointed to this path (renamed or moved file) */
  moved: boolean
  /** The row's last scrape outcome, so callers can decide whether to re-queue a scrape */
  scrapeStatus: ScrapeStatus | null
  hints: MediaHints
}

/** Size and mtime identify a file across renames and moves. */
export interface FileIdentity {
  fileSize: number
  fileMtimeMs: number
}

export async function readFileIdentity(filePath: string): Promise<FileIdentity | null> {
  try {
    const stat = await fsp.stat(filePath);
    return { fileSize: stat.size, fileMtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
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

// Artist and Album are deliberately absent: there is no music scraper, so queueing them only
// produced "not yet implemented" jobs (see specs/metadata-scraping.md).
const SCRAPEABLE_TYPES: CollectionType[] = ['Show', 'Season', 'Film'];
const SCRAPE_ORDER: CollectionType[] = ['Show', 'Season', 'Film'];

/**
 * Film metadata is attached to the Film collection, not the media file, so film media is not
 * scraped; Music has no audio scraper, so its media is not scraped either.
 */
export function shouldScrapeMedia(libraryType: LibraryType): boolean {
  return libraryType === 'Television';
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
   *
   * An unknown path whose size and mtime match a row in the same library whose
   * own file has vanished is treated as a rename or move: that row is
   * re-pointed here, keeping its metadata, images and watch progress.
   */
  async importMediaFile(opts: {
    libraryId: string
    libraryType: LibraryType
    filePath: string
    parentCollectionId: string | null
    collectionPath: string[]
    /** The containing folder's listing, when the caller already has it. */
    directoryEntries?: string[]
  }): Promise<ImportedMedia> {
    const { libraryId, libraryType, filePath, parentCollectionId, collectionPath, directoryEntries } = opts;
    const ext = path.extname(filePath).toLowerCase();
    const fileBaseName = path.basename(filePath, ext);
    const mediaType: 'Video' | 'Audio' = VIDEO_EXTENSIONS.includes(ext) ? 'Video' : 'Audio';
    const hintsFor = (id: string) => buildMediaHints(id, libraryType, fileBaseName, collectionPath, mediaType);
    const identity = await readFileIdentity(filePath);

    const existing = await prisma.media.findUnique({
      where: { path: filePath },
      select: { id: true, fileSize: true, scrapeStatus: true },
    });
    if (existing) {
      // Backfill the file identity for rows imported before it was recorded.
      if (existing.fileSize === null && identity) {
        await prisma.media.update({ where: { id: existing.id }, data: identity });
      }
      // Subtitles can arrive long after the video did.
      if (mediaType === 'Video') await this.syncExternalSubtitles(existing.id, filePath, directoryEntries);
      return { mediaId: existing.id, created: false, moved: false, scrapeStatus: existing.scrapeStatus, hints: hintsFor(existing.id) };
    }

    const moved = identity ? await this.findMovedMedia(libraryId, identity) : null;
    if (moved) {
      const hints = hintsFor(moved.id);
      await prisma.media.update({
        where: { id: moved.id },
        data: {
          path: filePath,
          collectionId: parentCollectionId,
          // Keep a scraped title; otherwise take the name from the new location.
          ...(moved.scrapeStatus === 'Matched' ? {} : { name: hints.name }),
        },
      });
      // The old location's sidecars are gone; this one's apply now.
      if (mediaType === 'Video') await this.syncExternalSubtitles(moved.id, filePath, directoryEntries);
      return { mediaId: moved.id, created: false, moved: true, scrapeStatus: moved.scrapeStatus, hints };
    }

    let thumbnails: string | null = null;
    if (mediaType === 'Video') {
      const trickplayPath = path.join(path.dirname(filePath), `${fileBaseName}.trickplay`);
      try {
        if ((await fsp.stat(trickplayPath)).isDirectory()) thumbnails = trickplayPath;
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
          ...(identity ?? {}),
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
      if (mediaType === 'Video') await this.syncExternalSubtitles(media.id, filePath, directoryEntries);
      return { mediaId: media.id, created: true, moved: false, scrapeStatus: null, hints: hintsFor(media.id) };
    } catch (error) {
      // Unique violation: someone (the watcher, another scan) imported it first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await prisma.media.findUnique({ where: { path: filePath }, select: { id: true, scrapeStatus: true } });
        if (raced) return { mediaId: raced.id, created: false, moved: false, scrapeStatus: raced.scrapeStatus, hints: hintsFor(raced.id) };
      }
      throw error;
    }
  }

  /**
   * A media row in this library with the same size and mtime whose file is
   * gone from its recorded path. Requires both to match exactly, so a copied
   * file (old path still present) is imported as a second item.
   */
  private async findMovedMedia(libraryId: string, identity: FileIdentity) {
    const candidates = await prisma.media.findMany({
      where: { ...identity, collection: { libraryId } },
      select: { id: true, path: true, scrapeStatus: true },
      take: 10,
    });
    // Whichever candidate's own file has gone is the one that moved here.
    const gone = await Promise.all(candidates.map(async (c) => !(await pathExists(c.path))));
    return candidates.find((_, index) => gone[index]) ?? null;
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
    await markMediaScrapePending(hints.map((h) => h.id));
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
    await markCollectionScrapePending(ordered.map((h) => h.id));
    await this.deps.queueCollectionScrapes(jobs);
    return jobs.length;
  }

  /**
   * Remove media and collections in a library that a complete walk did not
   * see. Files that disappeared while nothing was watching are cleaned up here,
   * along with their artwork.
   */
  /**
   * Match the external subtitle rows for a video to the sidecar files that are
   * next to it now.
   *
   * Sidecars come and go independently of the video: one downloaded next week
   * should appear on the next scan, and one deleted should stop being offered.
   * External rows take negative stream indices so they never collide with
   * ffmpeg's numbering for the container itself.
   */
  async syncExternalSubtitles(
    mediaId: string,
    videoPath: string,
    directoryEntries?: string[]
  ): Promise<{ added: number; removed: number }> {
    // The scan already read the folder to find this file, so it hands the
    // listing over rather than making us read it once per episode.
    const entries = directoryEntries ?? (await listDirectory(path.dirname(videoPath)));
    const sidecars = matchSidecars(videoPath, entries);

    const existing = await prisma.mediaStream.findMany({
      where: { mediaId, streamType: 'Subtitle', NOT: { externalPath: null } },
      select: { id: true, externalPath: true },
    });

    const wanted = new Set(sidecars.map((s) => s.path));
    const stale = existing.filter((row) => !row.externalPath || !wanted.has(row.externalPath));
    if (stale.length > 0) {
      await prisma.mediaStream.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }

    const known = new Set(
      existing.filter((row) => row.externalPath && wanted.has(row.externalPath)).map((row) => row.externalPath!)
    );
    const toAdd = sidecars.filter((s) => !known.has(s.path));

    // Keep numbering below any index the container could use.
    let nextIndex = -1;
    for (const sidecar of toAdd) {
      await prisma.mediaStream.create({
        data: {
          mediaId,
          streamIndex: nextIndex--,
          streamType: 'Subtitle',
          codec: sidecar.codec,
          language: sidecar.language,
          title: sidecar.title,
          isDefault: sidecar.isDefault,
          isForced: sidecar.isForced,
          externalPath: sidecar.path,
        },
      });
    }

    return { added: toAdd.length, removed: stale.length };
  }

  /**
   * Re-read a file that changed on disk and refresh what the probe told us.
   *
   * A re-encode keeps the path but changes the duration, the codecs and the
   * audio and subtitle tracks. Without this the player would keep offering
   * tracks that are no longer there and a playlist built from the old
   * duration would run past the end of the file. Metadata, images and watch
   * progress are left alone: it is the same title, in a new encoding.
   */
  async reprobeMediaFile(filePath: string): Promise<{ updated: boolean; streams: number }> {
    const existing = await prisma.media.findUnique({
      where: { path: filePath },
      select: { id: true },
    });
    if (!existing) return { updated: false, streams: 0 };

    const [probe, identity] = await Promise.all([this.deps.probe(filePath), readFileIdentity(filePath)]);

    await prisma.$transaction([
      // Only the container's own streams; sidecar rows are not in the file.
      prisma.mediaStream.deleteMany({ where: { mediaId: existing.id, externalPath: null } }),
      prisma.media.update({
        where: { id: existing.id },
        data: {
          duration: probe.duration,
          ...(identity ?? {}),
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
      }),
    ]);

    await this.syncExternalSubtitles(existing.id, filePath);
    return { updated: true, streams: probe.streams.length };
  }

  /**
   * What a scan did not see, and would therefore remove. Nothing is deleted.
   *
   * Used by a dry-run scan so an admin can look at the list before letting a
   * scan act on it: on a flaky mount, "not seen" and "gone" are not the same.
   */
  async findMissing(
    libraryId: string,
    seenCollectionIds: Set<string>,
    seenMediaIds: Set<string>
  ): Promise<{ collections: Array<{ id: string; name: string }>; media: Array<{ id: string; path: string }> }> {
    const [media, collections] = await Promise.all([
      prisma.media.findMany({
        where: { collection: { libraryId }, id: { notIn: [...seenMediaIds] } },
        select: { id: true, path: true },
      }),
      prisma.collection.findMany({
        where: { libraryId, id: { notIn: [...seenCollectionIds] } },
        select: { id: true, name: true },
      }),
    ]);
    return { media, collections };
  }

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

async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

export const importService = new ImportService();
