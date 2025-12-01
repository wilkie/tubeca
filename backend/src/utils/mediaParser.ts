/**
 * Utilities for parsing media filenames to extract metadata hints
 */

export interface ParsedEpisode {
  showName?: string
  season: number
  episode: number
  episodeTitle?: string
}

export interface ParsedMovie {
  title: string
  year?: number
}

/**
 * Parse TV episode information from a filename
 * Supports patterns like:
 *   - s01e01, S01E01
 *   - 1x01
 *   - s01e01 - Episode Title
 *   - Show Name S01E01
 *   - Show.Name.S01E01.720p
 */
export function parseEpisodeFromFilename(filename: string): ParsedEpisode | null {
  // Pattern: S##E## or S#E# (case insensitive)
  const sePattern = /(?:^|[.\s_-])s(\d{1,2})e(\d{1,2})(?:[.\s_-]|$)/i;

  // Pattern: ##x## (e.g., 1x01)
  const xPattern = /(?:^|[.\s_-])(\d{1,2})x(\d{2,3})(?:[.\s_-]|$)/i;

  let season: number | undefined;
  let episode: number | undefined;
  let matchIndex: number | undefined;
  let matchLength: number | undefined;

  // Try S##E## pattern first
  const seMatch = filename.match(sePattern);
  if (seMatch) {
    season = parseInt(seMatch[1], 10);
    episode = parseInt(seMatch[2], 10);
    matchIndex = seMatch.index!;
    matchLength = seMatch[0].length;
  }

  // Try ##x## pattern
  if (season === undefined) {
    const xMatch = filename.match(xPattern);
    if (xMatch) {
      season = parseInt(xMatch[1], 10);
      episode = parseInt(xMatch[2], 10);
      matchIndex = xMatch.index!;
      matchLength = xMatch[0].length;
    }
  }

  if (season === undefined || episode === undefined) {
    return null;
  }

  // Extract show name (everything before the episode pattern)
  let showName: string | undefined;
  if (matchIndex !== undefined && matchIndex > 0) {
    showName = filename
      .substring(0, matchIndex)
      .replace(/[._]/g, ' ')
      .trim();
  }

  // Extract episode title (everything after the episode pattern, before quality indicators)
  let episodeTitle: string | undefined;
  if (matchIndex !== undefined && matchLength !== undefined) {
    const afterMatch = filename.substring(matchIndex + matchLength);
    // Remove quality indicators and file info
    const titleMatch = afterMatch.match(/^[.\s_-]*(.+?)(?:\s*[.\s_-]\s*(?:\d{3,4}p|hdtv|web|bluray|x264|h\.?264|aac|mp3|proper|repack).*)?$/i);
    if (titleMatch && titleMatch[1]) {
      episodeTitle = titleMatch[1]
        .replace(/[._]/g, ' ')
        .replace(/^\s*-\s*/, '') // Remove leading dash
        .trim();
    }
  }

  return {
    showName: showName || undefined,
    season,
    episode,
    episodeTitle: episodeTitle || undefined,
  };
}

/**
 * Parse movie information from a filename
 * Supports patterns like:
 *   - Movie Name (2020)
 *   - Movie.Name.2020.1080p
 *   - Movie Name 2020
 */
export function parseMovieFromFilename(filename: string): ParsedMovie {
  // Pattern: year in parentheses or after dots/spaces
  const yearPattern = /[.\s_(-]*((?:19|20)\d{2})[\s).\]_-]*(?:\d{3,4}p|bluray|web|hdtv|dvd|brrip|x264|h\.?264|aac|$)/i;

  const yearMatch = filename.match(yearPattern);
  let year: number | undefined;
  let titleEndIndex = filename.length;

  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    titleEndIndex = yearMatch.index!;
  } else {
    // Try to find where quality indicators start
    const qualityMatch = filename.match(/[.\s_-](?:\d{3,4}p|bluray|web|hdtv|dvd|brrip|x264|h\.?264)/i);
    if (qualityMatch) {
      titleEndIndex = qualityMatch.index!;
    }
  }

  const title = filename
    .substring(0, titleEndIndex)
    .replace(/[._]/g, ' ')
    .replace(/\s*\(\s*$/, '') // Remove trailing open paren
    .trim();

  return {
    title,
    year,
  };
}

/**
 * Determine the likely show name from collection hierarchy
 * For a path like /shows/Betty/Season 1/episode.mkv:
 *   - If parent collection is "Season X", use grandparent
 *   - Otherwise use parent collection name
 */
export function getShowNameFromCollectionPath(collectionNames: string[]): string | undefined {
  if (collectionNames.length === 0) return undefined;

  // Check if immediate parent looks like a season folder
  const immediateParent = collectionNames[collectionNames.length - 1];
  const seasonPattern = /^season\s*\d+$/i;

  if (seasonPattern.test(immediateParent) && collectionNames.length > 1) {
    // Parent is "Season X", use grandparent as show name
    return collectionNames[collectionNames.length - 2];
  }

  // Use immediate parent as show name
  return immediateParent;
}

/**
 * Extract year from a string if present
 */
export function extractYear(text: string): number | undefined {
  const match = text.match(/\b((?:19|20)\d{2})\b/);
  return match ? parseInt(match[1], 10) : undefined;
}
