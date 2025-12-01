import { watch, type FSWatcher } from 'chokidar';
import { prisma } from '../config/database';
import { probeMediaFile, type StreamInfo } from '../utils/ffprobe';
import {
  parseEpisodeFromFilename,
  parseMovieFromFilename,
  getShowNameFromCollectionPath,
} from '../utils/mediaParser';
import { addMetadataScrapeJob } from '../queues/metadataScrapeQueue';
import {
  addCollectionScrapeJob,
  type CollectionScrapeType,
} from '../queues/collectionScrapeQueue';
import type { LibraryType, CollectionType, StreamType, Collection } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';

// Supported media extensions by type
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma'];

interface WatchedLibrary {
  id: string
  path: string
  libraryType: LibraryType
  watcher: FSWatcher
}

interface FileWatcherStatus {
  enabled: boolean
  watchedLibraries: Array<{
    id: string
    path: string
    libraryType: LibraryType
  }>
}

export interface FileWatcherOptions {
  usePolling?: boolean
  pollInterval?: number
}

/**
 * Service for watching library paths for filesystem changes
 * and automatically processing new media files
 */
export class FileWatcherService {
  private watchers: Map<string, WatchedLibrary> = new Map();
  private enabled: boolean = false;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly debounceMs: number = 2000; // Wait 2 seconds after last change
  private options: FileWatcherOptions = {};

  /**
   * Start watching all libraries that have watchForChanges enabled
   */
  async start(options: FileWatcherOptions = {}): Promise<void> {
    if (this.enabled) {
      return;
    }

    this.enabled = true;
    this.options = options;

    if (options.usePolling) {
      console.log(`📁 Starting file watcher service (polling mode, interval: ${options.pollInterval || 1000}ms)...`);
    } else {
      console.log('📁 Starting file watcher service...');
    }

    const libraries = await prisma.library.findMany({
      where: { watchForChanges: true },
    });

    console.log(`📁 Found ${libraries.length} libraries with watchForChanges enabled`);

    for (const library of libraries) {
      await this.watchLibrary(library.id, library.path, library.libraryType);
    }

    console.log(`📁 File watcher started, monitoring ${this.watchers.size} libraries`);
  }

  /**
   * Sync watchers with database - add/remove watchers based on library settings
   */
  async sync(): Promise<void> {
    const libraries = await prisma.library.findMany();

    // Add watchers for libraries with watchForChanges enabled
    for (const library of libraries) {
      if (library.watchForChanges && !this.watchers.has(library.id)) {
        await this.watchLibrary(library.id, library.path, library.libraryType);
      } else if (!library.watchForChanges && this.watchers.has(library.id)) {
        await this.unwatchLibrary(library.id);
      }
    }

    // Remove watchers for deleted libraries
    for (const libraryId of this.watchers.keys()) {
      const exists = libraries.some((l) => l.id === libraryId);
      if (!exists) {
        await this.unwatchLibrary(libraryId);
      }
    }
  }

  /**
   * Stop watching all libraries
   */
  async stop(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    console.log('📁 Stopping file watcher service...');

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all watchers
    for (const [libraryId, watched] of this.watchers) {
      await watched.watcher.close();
      console.log(`   Stopped watching library: ${libraryId}`);
    }

    this.watchers.clear();
    this.enabled = false;
    console.log('📁 File watcher service stopped');
  }

  /**
   * Get current status of the file watcher
   */
  getStatus(): FileWatcherStatus {
    return {
      enabled: this.enabled,
      watchedLibraries: Array.from(this.watchers.values()).map((w) => ({
        id: w.id,
        path: w.path,
        libraryType: w.libraryType,
      })),
    };
  }

  /**
   * Add a library to watch (call this when a new library is created)
   */
  async watchLibrary(libraryId: string, libraryPath: string, libraryType: LibraryType): Promise<void> {
    if (this.watchers.has(libraryId)) {
      return; // Already watching this library
    }

    if (!fs.existsSync(libraryPath)) {
      console.warn(`📁 Library path does not exist, skipping watch: ${libraryPath}`);
      return;
    }

    const extensions = libraryType === 'Music' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;

    const watcher = watch(libraryPath, {
      ignored: [
        /(^|[/\\])\../, // Ignore hidden files/directories
        /\.trickplay([/\\]|$)/, // Ignore .trickplay folders
      ],
      persistent: true,
      ignoreInitial: true, // Don't emit events for existing files
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Wait for file to be fully written
        pollInterval: 100,
      },
      depth: 10, // Reasonable depth limit
      // Polling options for WSL/mounted filesystems
      usePolling: this.options.usePolling ?? false,
      interval: this.options.pollInterval ?? 1000,
    });

    // Store extensions for filtering in handlers
    const watchedExtensions = new Set(extensions);

    // Handle new files
    watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (!watchedExtensions.has(ext)) {
        return; // Skip non-media files
      }
      const relativePath = path.relative(libraryPath, filePath);
      this.handleFileAdd(libraryId, libraryPath, relativePath, libraryType);
    });

    // Handle new directories (for collections)
    watcher.on('addDir', (dirPath) => {
      const relativePath = path.relative(libraryPath, dirPath);
      this.handleDirectoryAdd(libraryId, libraryPath, relativePath, libraryType);
    });

    // Handle file deletions
    watcher.on('unlink', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (!watchedExtensions.has(ext)) {
        return; // Skip non-media files
      }
      const relativePath = path.relative(libraryPath, filePath);
      this.handleFileRemove(libraryId, libraryPath, relativePath);
    });

    // Handle directory deletions
    watcher.on('unlinkDir', (dirPath) => {
      const relativePath = path.relative(libraryPath, dirPath);
      this.handleDirectoryRemove(libraryId, libraryPath, relativePath);
    });

    watcher.on('error', (error) => {
      console.error(`📁 Watcher error for library ${libraryId}:`, error);
    });

    watcher.on('ready', () => {
      const watched = watcher.getWatched();
      const dirCount = Object.keys(watched).length;
      const fileCount = Object.values(watched).reduce((sum, files) => sum + files.length, 0);
      console.log(`📁 Watcher ready for library ${libraryId.slice(0, 8)}: ${dirCount} directories, ${fileCount} files`);
    });

    this.watchers.set(libraryId, {
      id: libraryId,
      path: libraryPath,
      libraryType,
      watcher,
    });

    console.log(`📁 Watching library (${libraryId.slice(0, 8)}): ${libraryPath}`);
  }

  /**
   * Stop watching a specific library (call this when a library is deleted)
   */
  async unwatchLibrary(libraryId: string): Promise<void> {
    const watched = this.watchers.get(libraryId);
    if (watched) {
      await watched.watcher.close();
      this.watchers.delete(libraryId);
      console.log(`📁 Stopped watching library: ${libraryId}`);
    }
  }

  /**
   * Handle a new file being added
   */
  private handleFileAdd(
    libraryId: string,
    libraryPath: string,
    relativePath: string,
    libraryType: LibraryType
  ): void {
    const fullPath = path.join(libraryPath, relativePath);

    // Debounce to avoid processing the same file multiple times during copy
    const debounceKey = `file:${fullPath}`;
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(debounceKey);

      try {
        await this.processNewFile(libraryId, libraryPath, relativePath, libraryType);
      } catch (error) {
        console.error(`📁 Error processing new file ${fullPath}:`, error);
      }
    }, this.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
  }

  /**
   * Handle a new directory being added
   */
  private handleDirectoryAdd(
    libraryId: string,
    libraryPath: string,
    relativePath: string,
    libraryType: LibraryType
  ): void {
    // Skip root directory event
    if (!relativePath || relativePath === '.') {
      return;
    }

    const fullPath = path.join(libraryPath, relativePath);
    const dirName = path.basename(relativePath);

    // Skip hidden and .trickplay directories
    if (dirName.startsWith('.') || dirName.endsWith('.trickplay')) {
      return;
    }

    // Debounce directory events
    const debounceKey = `dir:${fullPath}`;
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(debounceKey);

      try {
        await this.processNewDirectory(libraryId, libraryPath, relativePath, libraryType);
      } catch (error) {
        console.error(`📁 Error processing new directory ${fullPath}:`, error);
      }
    }, this.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
  }

  /**
   * Handle file removal
   */
  private handleFileRemove(_libraryId: string, libraryPath: string, relativePath: string): void {
    const fullPath = path.join(libraryPath, relativePath);

    // Use setTimeout to avoid blocking the watcher
    setTimeout(async () => {
      try {
        // Find and delete the media record
        const media = await prisma.media.findFirst({
          where: { path: fullPath },
        });

        if (media) {
          await prisma.media.delete({
            where: { id: media.id },
          });
          console.log(`📁 Removed media: ${relativePath}`);
        }
      } catch (error) {
        console.error(`📁 Error removing media ${fullPath}:`, error);
      }
    }, 100);
  }

  /**
   * Handle directory removal
   */
  private handleDirectoryRemove(_libraryId: string, _libraryPath: string, relativePath: string): void {
    const dirName = path.basename(relativePath);

    // Skip hidden and .trickplay directories
    if (dirName.startsWith('.') || dirName.endsWith('.trickplay')) {
      return;
    }

    // Note: We don't auto-delete collections on directory removal
    // because the files inside are handled by their own delete events
    // and we don't want to accidentally delete collections if someone
    // just renames a folder (which triggers delete + add)
    console.log(`📁 Directory removed: ${relativePath} (collections preserved)`);
  }

  /**
   * Process a newly added media file
   */
  private async processNewFile(
    libraryId: string,
    libraryPath: string,
    relativePath: string,
    libraryType: LibraryType
  ): Promise<void> {
    const fullPath = path.join(libraryPath, relativePath);
    const ext = path.extname(fullPath).toLowerCase();
    const mediaName = path.basename(fullPath, ext);

    // Determine media type
    const mediaType = VIDEO_EXTENSIONS.includes(ext) ? 'Video' : 'Audio';

    // Check if already exists
    const existing = await prisma.media.findFirst({
      where: { path: fullPath },
    });

    if (existing) {
      console.log(`📁 Media already exists: ${relativePath}`);
      return;
    }

    console.log(`📁 Processing new media: ${relativePath}`);

    // Get or create parent collection
    const dirRelativePath = path.dirname(relativePath);
    const parentCollectionId = await this.getOrCreateCollectionPath(
      libraryId,
      libraryPath,
      dirRelativePath,
      libraryType
    );

    // Check for .trickplay folder
    let thumbnails: string | null = null;
    if (mediaType === 'Video') {
      const trickplayPath = path.join(path.dirname(fullPath), `${mediaName}.trickplay`);
      if (fs.existsSync(trickplayPath) && fs.statSync(trickplayPath).isDirectory()) {
        thumbnails = trickplayPath;
      }
    }

    // Probe the media file
    const probeResult = await probeMediaFile(fullPath);

    // Create media record
    const newMedia = await prisma.media.create({
      data: {
        path: fullPath,
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

    console.log(`📁 Created media record: ${mediaName}`);

    // Build collection path for metadata hints
    const collectionPath = dirRelativePath !== '.' ? dirRelativePath.split(path.sep) : [];

    // Parse filename for metadata hints and queue scrape job
    const scrapeJobData: Parameters<typeof addMetadataScrapeJob>[0] = {
      mediaId: newMedia.id,
      mediaName: mediaName,
      mediaType: mediaType as 'Video' | 'Audio',
    };

    if (mediaType === 'Video') {
      const episodeInfo = parseEpisodeFromFilename(mediaName);
      if (episodeInfo) {
        scrapeJobData.season = episodeInfo.season;
        scrapeJobData.episode = episodeInfo.episode;
        scrapeJobData.showName = episodeInfo.showName || getShowNameFromCollectionPath(collectionPath);
      } else {
        // For films, use folder name if available, otherwise use filename
        const searchName = collectionPath.length > 0 ? collectionPath[collectionPath.length - 1] : mediaName;
        const movieInfo = parseMovieFromFilename(searchName);
        if (movieInfo.year) {
          scrapeJobData.year = movieInfo.year;
        }
        // Use the parsed title (with year/quality stripped) for better search results
        if (movieInfo.title) {
          scrapeJobData.mediaName = movieInfo.title;
        }
      }
    }

    await addMetadataScrapeJob(scrapeJobData);
    console.log(`📁 Queued metadata scrape for: ${scrapeJobData.mediaName}${scrapeJobData.year ? ` (${scrapeJobData.year})` : ''}`);
  }

  /**
   * Process a newly added directory (create collection if needed)
   */
  private async processNewDirectory(
    libraryId: string,
    libraryPath: string,
    relativePath: string,
    libraryType: LibraryType
  ): Promise<void> {
    const dirName = path.basename(relativePath);
    const depth = relativePath.split(path.sep).length - 1;

    // Determine collection type
    const collectionType = this.getCollectionType(libraryType, depth);

    // Get parent collection ID
    const parentRelativePath = path.dirname(relativePath);
    let parentCollectionId: string | null = null;

    if (parentRelativePath !== '.') {
      parentCollectionId = await this.getOrCreateCollectionPath(
        libraryId,
        libraryPath,
        parentRelativePath,
        libraryType
      );
    }

    // Check if collection already exists
    const existing = await prisma.collection.findFirst({
      where: {
        libraryId,
        name: dirName,
        parentId: parentCollectionId,
      },
    });

    if (existing) {
      console.log(`📁 Collection already exists: ${relativePath}`);
      return;
    }

    console.log(`📁 Creating collection: ${relativePath}`);

    // Create collection
    const collection = await prisma.collection.create({
      data: {
        name: dirName,
        libraryId,
        parentId: parentCollectionId,
        collectionType,
      },
    });

    console.log(`📁 Created collection: ${dirName} (${collectionType})`);

    // Queue collection scraping for supported types
    const scrapeableTypes: CollectionType[] = ['Show', 'Season', 'Film', 'Artist', 'Album'];
    if (scrapeableTypes.includes(collectionType)) {
      const scrapeJobData: Parameters<typeof addCollectionScrapeJob>[0] = {
        collectionId: collection.id,
        collectionName: dirName,
        collectionType: collectionType as CollectionScrapeType,
      };

      // Add season number for Season collections
      if (collectionType === 'Season') {
        const seasonMatch = dirName.match(/season\s*(\d+)/i);
        if (seasonMatch) {
          scrapeJobData.seasonNumber = parseInt(seasonMatch[1], 10);
        }
        scrapeJobData.parentShowId = parentCollectionId ?? undefined;
      }

      // Add year for Film collections
      if (collectionType === 'Film') {
        const movieInfo = parseMovieFromFilename(dirName);
        if (movieInfo.year) {
          scrapeJobData.year = movieInfo.year;
        }
      }

      await addCollectionScrapeJob(scrapeJobData);
      console.log(`📁 Queued collection scrape for: ${dirName}`);
    }
  }

  /**
   * Get or create collection hierarchy for a relative path
   */
  private async getOrCreateCollectionPath(
    libraryId: string,
    _libraryPath: string,
    relativePath: string,
    libraryType: LibraryType
  ): Promise<string | null> {
    if (!relativePath || relativePath === '.') {
      return null;
    }

    const parts = relativePath.split(path.sep);
    let parentId: string | null = null;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part === '.') continue;

      const collectionType = this.getCollectionType(libraryType, i);

      // Try to find existing collection
      let collection: Collection | null = await prisma.collection.findFirst({
        where: {
          libraryId,
          name: part,
          parentId,
        },
      });

      // Create if doesn't exist
      if (!collection) {
        collection = await prisma.collection.create({
          data: {
            name: part,
            libraryId,
            parentId,
            collectionType,
          },
        });
        console.log(`📁 Auto-created collection: ${part} (${collectionType})`);
      }

      parentId = collection.id;
    }

    return parentId;
  }

  /**
   * Determine collection type based on library type and depth
   */
  private getCollectionType(libraryType: LibraryType, depth: number): CollectionType {
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
}

// Singleton instance
export const fileWatcherService = new FileWatcherService();
