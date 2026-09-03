import * as fs from 'fs';
import * as path from 'path';
import type { LibraryType } from '@prisma/client';
import { getMediaExtensions } from '../utils/libraryLayout';
import { ImportService, type CollectionHints, type MediaHints } from './importService';

export interface ScanOptions {
  /** Re-queue scrapes for media and collections that already existed. */
  fullScan?: boolean
  /** Polled once per directory; throw from here to abort. */
  checkCancelled?: () => Promise<void>
  /** Approximate progress, 0-100. */
  onProgress?: (percent: number) => Promise<void> | void
}

export interface ScanSummary {
  filesFound: number
  filesProcessed: number
  collectionsCreated: number
  mediaCreated: number
  mediaRemoved: number
  collectionsRemoved: number
  errors: string[]
  mediaToScrape: MediaHints[]
  collectionsToScrape: CollectionHints[]
}

interface WalkState {
  summary: ScanSummary
  seenCollectionIds: Set<string>
  seenMediaIds: Set<string>
  /** Set when a directory could not be read; reconciliation is skipped then. */
  incomplete: boolean
}

/**
 * Walks a library folder and imports what it finds through `ImportService`.
 * Separated from the BullMQ worker so it can run in tests against a temp tree.
 */
export class LibraryScanService {
  constructor(private readonly importer: ImportService = new ImportService()) {}

  async scan(
    library: { id: string; path: string; libraryType: LibraryType },
    options: ScanOptions = {}
  ): Promise<ScanSummary> {
    if (!fs.existsSync(library.path)) {
      throw new Error(`Library path does not exist: ${library.path}`);
    }

    const state: WalkState = {
      summary: {
        filesFound: 0,
        filesProcessed: 0,
        collectionsCreated: 0,
        mediaCreated: 0,
        mediaRemoved: 0,
        collectionsRemoved: 0,
        errors: [],
        mediaToScrape: [],
        collectionsToScrape: [],
      },
      seenCollectionIds: new Set(),
      seenMediaIds: new Set(),
      incomplete: false,
    };

    await this.walk(library, options, library.path, null, [], 0, state);

    // Reconcile only after a complete, non-empty walk: an unmounted share
    // presents as an empty directory and must not wipe the library.
    const sawAnything = state.seenCollectionIds.size > 0 || state.seenMediaIds.size > 0;
    if (!state.incomplete && sawAnything) {
      const removed = await this.importer.removeMissing(
        library.id,
        state.seenCollectionIds,
        state.seenMediaIds
      );
      state.summary.mediaRemoved = removed.media;
      state.summary.collectionsRemoved = removed.collections;
    } else if (!sawAnything) {
      state.summary.errors.push('Library folder is empty; skipped removal of missing items');
    }

    await options.onProgress?.(100);
    return state.summary;
  }

  private async walk(
    library: { id: string; libraryType: LibraryType },
    options: ScanOptions,
    dirPath: string,
    parentCollectionId: string | null,
    collectionPath: string[],
    depth: number,
    state: WalkState
  ): Promise<void> {
    await options.checkCancelled?.();
    const { summary } = state;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      summary.errors.push(`Cannot read directory: ${dirPath}`);
      state.incomplete = true;
      return;
    }

    const isFile = (e: fs.Dirent) =>
      e.isFile() || (e.isSymbolicLink() && safeStat(path.join(dirPath, e.name))?.isFile() === true);
    const isDir = (e: fs.Dirent) =>
      e.isDirectory() ||
      (e.isSymbolicLink() && safeStat(path.join(dirPath, e.name))?.isDirectory() === true);

    const extensions = getMediaExtensions(library.libraryType);

    for (const entry of entries.filter(isFile)) {
      if (!extensions.includes(path.extname(entry.name).toLowerCase())) continue;
      summary.filesFound++;
      const filePath = path.join(dirPath, entry.name);
      try {
        const imported = await this.importer.importMediaFile({
          libraryType: library.libraryType,
          filePath,
          parentCollectionId,
          collectionPath,
        });
        state.seenMediaIds.add(imported.mediaId);
        if (imported.created) {
          summary.mediaCreated++;
          summary.mediaToScrape.push(imported.hints);
        } else if (options.fullScan) {
          summary.mediaToScrape.push(imported.hints);
        }
        summary.filesProcessed++;
      } catch (error) {
        summary.errors.push(
          `Failed to process: ${filePath} - ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    for (const entry of entries.filter(isDir)) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.trickplay')) continue;
      const subDirPath = path.join(dirPath, entry.name);
      try {
        const ensured = await this.importer.ensureCollection(
          library.id,
          library.libraryType,
          entry.name,
          parentCollectionId,
          depth
        );
        state.seenCollectionIds.add(ensured.id);
        if (ensured.created) {
          summary.collectionsCreated++;
          summary.collectionsToScrape.push(ensured.hints);
        } else if (options.fullScan) {
          summary.collectionsToScrape.push(ensured.hints);
        }
        await this.walk(
          library,
          options,
          subDirPath,
          ensured.id,
          [...collectionPath, entry.name],
          depth + 1,
          state
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'Scan cancelled by user') throw error;
        summary.errors.push(`Failed to process directory: ${subDirPath}`);
        state.incomplete = true;
      }
    }

    const percent = Math.min(95, Math.floor((summary.filesProcessed / Math.max(summary.filesFound, 1)) * 95));
    await options.onProgress?.(percent);
  }
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
