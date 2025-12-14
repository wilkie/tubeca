import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/database';
import { libraryScanQueue, type LibraryScanJobData } from '../queues/libraryScanQueue';
import { addBulkMetadataScrapeJobs, type MetadataScrapeJobData } from '../queues/metadataScrapeQueue';
import {
  addBulkCollectionScrapeJobs,
  type CollectionScrapeJobData,
  type CollectionScrapeType,
} from '../queues/collectionScrapeQueue';
import {
  parseEpisodeFromFilename,
  parseMovieFromFilename,
  getShowNameFromCollectionPath,
} from '../utils/mediaParser';
import { probeMediaFile, type StreamInfo } from '../utils/ffprobe';
import type { LibraryType, CollectionType, StreamType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Supported media extensions by type
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma'];

interface NewMediaInfo {
  id: string
  name: string
  type: 'Video' | 'Audio'
  showName?: string
  season?: number
  episode?: number
  year?: number
  collectionName?: string // For Films, the folder name which often has the proper movie title
}

interface NewCollectionInfo {
  id: string
  name: string
  collectionType: CollectionType
  parentId: string | null
  seasonNumber?: number // For Season collections
  year?: number // For Film collections (parsed from folder name)
}

interface ScanResult {
  filesFound: number
  filesProcessed: number
  collectionsCreated: number
  mediaCreated: number
  errors: string[]
  newMediaIds: NewMediaInfo[]
  newCollections: NewCollectionInfo[]
}

// Library scan worker
export const libraryScanWorker = new Worker(
  'library-scan',
  async (job: Job<LibraryScanJobData & { cancelled?: boolean }>) => {
    const { libraryId, libraryPath, libraryName } = job.data;
    console.log(`📂 Starting scan for library: ${libraryName} (${libraryId})`);
    console.log(`   Path: ${libraryPath}`);

    const result: ScanResult = {
      filesFound: 0,
      filesProcessed: 0,
      collectionsCreated: 0,
      mediaCreated: 0,
      errors: [],
      newMediaIds: [],
      newCollections: [],
    };

    try {
      // Verify path still exists
      if (!fs.existsSync(libraryPath)) {
        throw new Error(`Library path does not exist: ${libraryPath}`);
      }

      // Get library to determine type
      const library = await prisma.library.findUnique({
        where: { id: libraryId },
      });
      if (!library) {
        throw new Error('Library not found');
      }

      // Determine which extensions to look for based on library type
      const extensions = library.libraryType === 'Music' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;

      // Scan the directory recursively
      await scanDirectory(job, libraryPath, libraryId, null, [], extensions, library.libraryType, 0, result);

      await job.updateProgress(100);
      console.log(`✅ Scan complete for ${libraryName}:`, {
        filesFound: result.filesFound,
        filesProcessed: result.filesProcessed,
        collectionsCreated: result.collectionsCreated,
        mediaCreated: result.mediaCreated,
        errors: result.errors,
      });

      // Queue metadata scraping for newly discovered media
      // Skip for Film libraries - the collection scraper handles film metadata
      if (result.newMediaIds.length > 0 && library.libraryType !== 'Film') {
        console.log(`📋 Queueing metadata scrape for ${result.newMediaIds.length} new media items`);
        const scrapeJobs: MetadataScrapeJobData[] = result.newMediaIds.map((media) => ({
          mediaId: media.id,
          mediaName: media.collectionName || media.name,
          mediaType: media.type,
          showName: media.showName,
          season: media.season,
          episode: media.episode,
          year: media.year,
        }));
        await addBulkMetadataScrapeJobs(scrapeJobs);
      }

      // Queue collection metadata scraping for newly discovered collections
      if (result.newCollections.length > 0) {
        // Filter to only scrape-able collection types (Show, Season, Film, Artist, Album)
        const scrapeableTypes: CollectionType[] = ['Show', 'Season', 'Film', 'Artist', 'Album'];
        const collectionsToScrape = result.newCollections.filter(
          (c) => scrapeableTypes.includes(c.collectionType)
        );

        if (collectionsToScrape.length > 0) {
          console.log(`📋 Queueing collection scrape for ${collectionsToScrape.length} collections`);

          // Build a map of collection IDs to their scrape results for parent lookups
          // We need to process Shows first, then Seasons (to get parent info)
          const shows = collectionsToScrape.filter((c) => c.collectionType === 'Show');
          const seasons = collectionsToScrape.filter((c) => c.collectionType === 'Season');
          const films = collectionsToScrape.filter((c) => c.collectionType === 'Film');
          const artists = collectionsToScrape.filter((c) => c.collectionType === 'Artist');
          const albums = collectionsToScrape.filter((c) => c.collectionType === 'Album');

          const collectionScrapeJobs: CollectionScrapeJobData[] = [];

          // Queue Show scrapes
          for (const show of shows) {
            collectionScrapeJobs.push({
              collectionId: show.id,
              collectionName: show.name,
              collectionType: 'Show' as CollectionScrapeType,
            });
          }

          // Queue Season scrapes with parent show info
          for (const season of seasons) {
            collectionScrapeJobs.push({
              collectionId: season.id,
              collectionName: season.name,
              collectionType: 'Season' as CollectionScrapeType,
              parentShowId: season.parentId ?? undefined,
              seasonNumber: season.seasonNumber,
              // Note: parentExternalId and parentScraperId will be filled in by the worker
              // after the parent show is scraped, or we can look them up
            });
          }

          // Queue Film scrapes with year hint
          for (const film of films) {
            collectionScrapeJobs.push({
              collectionId: film.id,
              collectionName: film.name,
              collectionType: 'Film' as CollectionScrapeType,
              year: film.year,
            });
          }

          // Queue Artist scrapes
          for (const artist of artists) {
            collectionScrapeJobs.push({
              collectionId: artist.id,
              collectionName: artist.name,
              collectionType: 'Artist' as CollectionScrapeType,
            });
          }

          // Queue Album scrapes with parent artist info
          for (const album of albums) {
            collectionScrapeJobs.push({
              collectionId: album.id,
              collectionName: album.name,
              collectionType: 'Album' as CollectionScrapeType,
              parentShowId: album.parentId ?? undefined, // Actually parent artist
            });
          }

          await addBulkCollectionScrapeJobs(collectionScrapeJobs);
        }
      }

      return result;
    } catch (error) {
      console.error(`❌ Scan error for ${libraryName}:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Only one scan at a time
  }
);

/**
 * Determine the collection type based on library type and depth
 * - Television: depth 0 = Show, depth 1 = Season
 * - Music: depth 0 = Artist, depth 1 = Album
 * - Film: depth 0 = Film (each folder is a movie)
 */
function getCollectionType(libraryType: LibraryType, depth: number): CollectionType {
  if (libraryType === 'Television') {
    return depth === 0 ? 'Show' : depth === 1 ? 'Season' : 'Generic';
  }
  if (libraryType === 'Music') {
    return depth === 0 ? 'Artist' : depth === 1 ? 'Album' : 'Generic';
  }
  if (libraryType === 'Film') {
    return depth === 0 ? 'Film' : 'Generic';
  }
  return 'Generic';
}

async function scanDirectory(
  job: Job<LibraryScanJobData & { cancelled?: boolean }>,
  dirPath: string,
  libraryId: string,
  parentCollectionId: string | null,
  collectionPath: string[],
  extensions: string[],
  libraryType: LibraryType,
  depth: number,
  result: ScanResult
): Promise<void> {
  // Check if job was cancelled
  const freshJob = await libraryScanQueue.getJob(job.id!);
  if (freshJob?.data?.cancelled) {
    throw new Error('Scan cancelled by user');
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    result.errors.push(`Cannot read directory: ${dirPath}`);
    return;
  }

  // Separate files and directories (following symlinks)
  const files = entries.filter(e => {
    if (e.isFile()) return true;
    if (e.isSymbolicLink()) {
      try {
        return fs.statSync(path.join(dirPath, e.name)).isFile();
      } catch {
        return false; // Broken symlink
      }
    }
    return false;
  });

  const dirs = entries.filter(e => {
    if (e.isDirectory()) return true;
    if (e.isSymbolicLink()) {
      try {
        return fs.statSync(path.join(dirPath, e.name)).isDirectory();
      } catch {
        return false; // Broken symlink
      }
    }
    return false;
  });

  // Process media files in this directory
  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    if (extensions.includes(ext)) {
      result.filesFound++;

      const filePath = path.join(dirPath, file.name);
      const mediaType = VIDEO_EXTENSIONS.includes(ext) ? 'Video' : 'Audio';
      const fileBaseName = path.basename(file.name, ext);

      // For Film libraries, use the collection/folder name as media name (cleaner than filename)
      // The folder name typically has the proper movie title like "The Matrix (1999)"
      const mediaName = (libraryType === 'Film' && collectionPath.length > 0)
        ? collectionPath[collectionPath.length - 1]
        : fileBaseName;

      // Check for corresponding .trickplay folder for video thumbnails
      // Use the file basename (not mediaName) since trickplay folder is named after the file
      let thumbnails: string | null = null;
      if (mediaType === 'Video') {
        const trickplayPath = path.join(dirPath, `${fileBaseName}.trickplay`);
        if (fs.existsSync(trickplayPath) && fs.statSync(trickplayPath).isDirectory()) {
          thumbnails = trickplayPath;
        }
      }

      try {
        // Check if media already exists by path
        const existing = await prisma.media.findFirst({
          where: { path: filePath },
          include: { collection: true },
        });

        if (!existing) {
          // Probe the media file for duration and stream information
          const probeResult = await probeMediaFile(filePath);

          const newMedia = await prisma.media.create({
            data: {
              path: filePath,
              name: mediaName,
              duration: probeResult.duration,
              type: mediaType,
              ...(thumbnails && { thumbnails }),
              collectionId: parentCollectionId,
            },
          });

          // Store stream information
          if (probeResult.streams.length > 0) {
            await prisma.mediaStream.createMany({
              data: probeResult.streams.map((stream: StreamInfo) => ({
                mediaId: newMedia.id,
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
            });
          }

          result.mediaCreated++;

          // Parse filename for metadata hints
          const newMediaInfo: NewMediaInfo = {
            id: newMedia.id,
            name: mediaName,
            type: mediaType as 'Video' | 'Audio',
          };

          if (mediaType === 'Video') {
            // Try to parse as TV episode
            const episodeInfo = parseEpisodeFromFilename(mediaName);
            if (episodeInfo) {
              newMediaInfo.season = episodeInfo.season;
              newMediaInfo.episode = episodeInfo.episode;
              // Get show name from collection path (e.g., /Betty/Season 1/ -> Betty)
              newMediaInfo.showName =
                episodeInfo.showName || getShowNameFromCollectionPath(collectionPath);
            } else {
              // Try to parse as movie - use collection (folder) name if available
              // as it typically has the proper movie title like "The Matrix (1999)"
              const searchName = collectionPath.length > 0 ? collectionPath[collectionPath.length - 1] : mediaName;
              const movieInfo = parseMovieFromFilename(searchName);
              if (movieInfo.year) {
                newMediaInfo.year = movieInfo.year;
              }
              // Store collection name for Film metadata lookup
              if (libraryType === 'Film' && collectionPath.length > 0) {
                newMediaInfo.collectionName = collectionPath[collectionPath.length - 1];
              }
            }
          }

          result.newMediaIds.push(newMediaInfo);
        } else if (job.data.fullScan) {
          // In full scan mode, re-queue existing media for metadata scraping
          const existingMediaInfo: NewMediaInfo = {
            id: existing.id,
            name: mediaName,
            type: mediaType as 'Video' | 'Audio',
          };

          if (mediaType === 'Video') {
            // Try to parse as TV episode
            const episodeInfo = parseEpisodeFromFilename(mediaName);
            if (episodeInfo) {
              existingMediaInfo.season = episodeInfo.season;
              existingMediaInfo.episode = episodeInfo.episode;
              existingMediaInfo.showName =
                episodeInfo.showName || getShowNameFromCollectionPath(collectionPath);
            } else {
              // Try to parse as movie
              const searchName = collectionPath.length > 0 ? collectionPath[collectionPath.length - 1] : mediaName;
              const movieInfo = parseMovieFromFilename(searchName);
              if (movieInfo.year) {
                existingMediaInfo.year = movieInfo.year;
              }
              if (libraryType === 'Film' && collectionPath.length > 0) {
                existingMediaInfo.collectionName = collectionPath[collectionPath.length - 1];
              }
            }
          }

          result.newMediaIds.push(existingMediaInfo);
        }
        result.filesProcessed++;
      } catch (error) {
        console.error(`Failed to process ${filePath}:`, error);
        result.errors.push(`Failed to process: ${filePath} - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Process subdirectories as collections
  for (const dir of dirs) {
    // Skip hidden directories
    if (dir.name.startsWith('.')) continue;

    // Skip .trickplay folders (they are for video thumbnails, not collections)
    if (dir.name.endsWith('.trickplay')) continue;

    const subDirPath = path.join(dirPath, dir.name);

    try {
      // Determine collection type based on library type and depth
      const collectionType = getCollectionType(libraryType, depth);

      // Check if collection already exists
      let collection = await prisma.collection.findFirst({
        where: {
          libraryId,
          name: dir.name,
          parentId: parentCollectionId,
        },
      });

      if (!collection) {
        collection = await prisma.collection.create({
          data: {
            name: dir.name,
            libraryId,
            parentId: parentCollectionId,
            collectionType,
          },
        });
        result.collectionsCreated++;

        // Track new collection for metadata scraping
        const newCollectionInfo: NewCollectionInfo = {
          id: collection.id,
          name: dir.name,
          collectionType,
          parentId: parentCollectionId,
        };

        // For Season collections, try to parse the season number from the name
        if (collectionType === 'Season') {
          const seasonMatch = dir.name.match(/season\s*(\d+)/i);
          if (seasonMatch) {
            newCollectionInfo.seasonNumber = parseInt(seasonMatch[1], 10);
          }
        }

        // For Film collections, try to parse the year from the folder name
        if (collectionType === 'Film') {
          const movieInfo = parseMovieFromFilename(dir.name);
          if (movieInfo.year) {
            newCollectionInfo.year = movieInfo.year;
          }
        }

        result.newCollections.push(newCollectionInfo);
      } else {
        // Update collection type if it changed
        if (collection.collectionType !== collectionType) {
          collection = await prisma.collection.update({
            where: { id: collection.id },
            data: { collectionType },
          });
        }

        // In full scan mode, re-queue existing collections for metadata scraping
        if (job.data.fullScan) {
          const existingCollectionInfo: NewCollectionInfo = {
            id: collection.id,
            name: dir.name,
            collectionType,
            parentId: parentCollectionId,
          };

          if (collectionType === 'Season') {
            const seasonMatch = dir.name.match(/season\s*(\d+)/i);
            if (seasonMatch) {
              existingCollectionInfo.seasonNumber = parseInt(seasonMatch[1], 10);
            }
          }

          if (collectionType === 'Film') {
            const movieInfo = parseMovieFromFilename(dir.name);
            if (movieInfo.year) {
              existingCollectionInfo.year = movieInfo.year;
            }
          }

          result.newCollections.push(existingCollectionInfo);
        }
      }

      // Recursively scan subdirectory with updated collection path
      await scanDirectory(job, subDirPath, libraryId, collection.id, [...collectionPath, dir.name], extensions, libraryType, depth + 1, result);
    } catch {
      result.errors.push(`Failed to process directory: ${subDirPath}`);
    }
  }

  // Update progress based on directories processed
  // This is approximate since we don't know total count upfront
  const progress = Math.min(95, Math.floor((result.filesProcessed / Math.max(result.filesFound, 1)) * 95));
  await job.updateProgress(progress);
}

// Worker event handlers
libraryScanWorker.on('completed', (job) => {
  console.log(`✅ Library scan ${job.id} completed successfully`);
});

libraryScanWorker.on('failed', (job, error) => {
  console.error(`❌ Library scan ${job?.id} failed:`, error.message);
});

libraryScanWorker.on('error', (error) => {
  console.error('Library scan worker error:', error);
});

libraryScanWorker.on('ready', () => {
  console.log('📚 Library scan worker is ready');
});
