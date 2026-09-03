import type { CollectionType, LibraryType } from '@prisma/client';
import * as path from 'path';

/**
 * Rules shared by the library scan worker and the file watcher for turning
 * an on-disk layout into collections and media. Keeping them here means the
 * two import paths cannot drift apart.
 */

export const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma'];

/** Extensions considered media for a given library type. */
export function getMediaExtensions(libraryType: LibraryType): string[] {
  return libraryType === 'Music' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;
}

/** True when the file name has a media extension valid for the library type. */
export function isMediaFile(filename: string, libraryType: LibraryType): boolean {
  return getMediaExtensions(libraryType).includes(path.extname(filename).toLowerCase());
}

/**
 * Map a folder's depth below the library root to a collection type.
 *
 * | Library    | depth 0 | depth 1 | deeper  |
 * |------------|---------|---------|---------|
 * | Television | Show    | Season  | Generic |
 * | Film       | Film    | Generic | Generic |
 * | Music      | Artist  | Album   | Generic |
 */
export function getCollectionType(libraryType: LibraryType, depth: number): CollectionType {
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
