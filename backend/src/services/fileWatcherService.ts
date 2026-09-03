import { watch, type FSWatcher } from 'chokidar';
import { prisma } from '../config/database';
import { getMediaExtensions } from '../utils/libraryLayout';
import { importService } from './importService';
import { contentDeletionService } from './contentDeletionService';
import type { LibraryType } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';

// Supported media extensions by type

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
export /** How long an unlink waits for a matching add before the row is deleted. */
const RENAME_GRACE_MS = 10000;

class FileWatcherService {
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
      console.log(`📁 Starting file watcher service (polling mode, interval: ${options.pollInterval ?? 30000}ms)...`);
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

    const extensions = getMediaExtensions(libraryType);

    // In polling mode chokidar runs an fs.stat over every watched file each cycle.
    // On a network mount (SMB/CIFS) those stat calls are slow and run on libuv's
    // threadpool; a fast interval starves the threadpool and stalls everything
    // else that uses it (DNS lookups, image writes, sharp). Poll gently — a media
    // library doesn't need sub-minute detection of new files.
    //
    // Note: `binaryInterval` must be set too. Media files count as "binary", so
    // without it chokidar polls them on its 300ms default regardless of `interval`.
    const pollInterval = this.options.pollInterval ?? 30000;

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
      interval: pollInterval,
      binaryInterval: pollInterval,
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

    // A rename arrives as unlink + add. Wait before deleting so the add can
    // re-point the row (importMediaFile recognises the file by size and mtime);
    // by then the row's path has changed and the lookup below finds nothing.
    setTimeout(async () => {
      try {
        // Find and delete the media record
        const media = await prisma.media.findFirst({
          where: { path: fullPath },
        });

        if (media && !fs.existsSync(fullPath)) {
          await contentDeletionService.deleteMedia(media.id);
          console.log(`📁 Removed media: ${relativePath}`);
        }
      } catch (error) {
        console.error(`📁 Error removing media ${fullPath}:`, error);
      }
    }, RENAME_GRACE_MS);
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
    const dirRelativePath = path.dirname(relativePath);
    const collectionPath = dirRelativePath !== '.' ? dirRelativePath.split(path.sep) : [];

    // Make sure the folder chain exists (a file can arrive before its addDir event)
    const { leafId, collections } = await importService.ensureCollectionPath(
      libraryId,
      libraryType,
      collectionPath
    );
    await importService.queueCollectionScrapes(
      collections.filter((c) => c.created).map((c) => c.hints)
    );

    const imported = await importService.importMediaFile({
      libraryId,
      libraryType,
      filePath: fullPath,
      parentCollectionId: leafId,
      collectionPath,
    });

    if (imported.moved) {
      console.log(`📁 Media moved to: ${relativePath}`);
      if (imported.scrapeStatus !== 'Matched') {
        await importService.queueMediaScrapes(libraryType, [imported.hints]);
      }
      return;
    }
    if (!imported.created) {
      console.log(`📁 Media already exists: ${relativePath}`);
      return;
    }

    console.log(`📁 Created media record: ${imported.hints.name}`);
    const queued = await importService.queueMediaScrapes(libraryType, [imported.hints]);
    if (queued > 0) {
      console.log(`📁 Queued metadata scrape for: ${imported.hints.name}`);
    }
  }

  /**
   * Process a newly added directory (create collection if needed)
   */
  private async processNewDirectory(
    libraryId: string,
    _libraryPath: string,
    relativePath: string,
    libraryType: LibraryType
  ): Promise<void> {
    const { collections } = await importService.ensureCollectionPath(
      libraryId,
      libraryType,
      relativePath.split(path.sep)
    );
    const created = collections.filter((c) => c.created);
    if (created.length === 0) {
      console.log(`📁 Collection already exists: ${relativePath}`);
      return;
    }
    for (const c of created) {
      console.log(`📁 Created collection: ${c.hints.name} (${c.collectionType})`);
    }
    const queued = await importService.queueCollectionScrapes(created.map((c) => c.hints));
    if (queued > 0) {
      console.log(`📁 Queued collection scrape for: ${relativePath}`);
    }
  }
}

// Singleton instance
export const fileWatcherService = new FileWatcherService();
