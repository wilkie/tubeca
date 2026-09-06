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

/** The season a folder names: "Season 3", "Season 03", or "Specials" for 0. */
export function parseSeasonFromFolderName(name: string): number | undefined {
  const season = /^season\s*(\d{1,3})$/i.exec(name.trim());
  if (season) return parseInt(season[1], 10);
  // Every scraper numbers specials as season 0.
  if (/^specials?$/i.test(name.trim())) return 0;
  return undefined;
}

export interface ParseEpisodeOptions {
  /**
   * The season the containing folder names, from `parseSeasonFromFolderName`.
   *
   * Two in five episodes in a real library are named `14 - Karen Peralta.mkv`
   * inside `Season 3/`: the episode number is in the filename and the season is
   * only in the folder. Without the folder there is nothing to match on, and
   * the scrape falls back to searching for a show called "14 - Karen Peralta".
   */
  seasonHint?: number
}

/**
 * Parse TV episode information from a filename
 * Supports patterns like:
 *   - s01e01, S01E01, s01e118 (three-digit episodes)
 *   - 1x01
 *   - s01e01 - Episode Title
 *   - Show Name S01E01
 *   - Show.Name.S01E01.720p
 *   - Ace Attorney S2 - 22 (season token, episode after a separator)
 * and, when `seasonHint` says which season the folder is:
 *   - 14 - Karen Peralta
 *   - Episode 14, Ep 14, E14
 */
export function parseEpisodeFromFilename(
  filename: string,
  options: ParseEpisodeOptions = {}
): ParsedEpisode | null {
  // Pattern: S##E## or S#E# (case insensitive). Three digits because long-running
  // shows number straight through: s01e118 is real, and used to parse as nothing.
  const sePattern = /(?:^|[.\s_-])s(\d{1,2})e(\d{1,3})(?:[.\s_-]|$)/i;

  // Pattern: ##x## (e.g., 1x01)
  const xPattern = /(?:^|[.\s_-])(\d{1,2})x(\d{2,3})(?:[.\s_-]|$)/i;

  // Pattern: a season token and the episode after a separator (Ace Attorney S2 - 22)
  const seasonThenEpisode = /(?:^|[^a-z0-9])s(\d{1,2})\s*[-–_]\s*(\d{1,3})(?![0-9])/i;

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

  // Season token then a separate episode number.
  if (season === undefined) {
    const pairMatch = filename.match(seasonThenEpisode);
    if (pairMatch) {
      season = parseInt(pairMatch[1], 10);
      episode = parseInt(pairMatch[2], 10);
      matchIndex = pairMatch.index!;
      matchLength = pairMatch[0].length;
    }
  }

  // Set directly by the patterns that already know them; otherwise derived from
  // where the episode pattern sat in the filename, below.
  let showName: string | undefined;
  let episodeTitle: string | undefined;

  // Nothing in the filename says which season, but the folder does. Inside a
  // season folder a leading number, or a spelled-out "Episode N", is the
  // episode: there is nothing else it could be.
  if (season === undefined && options.seasonHint !== undefined) {
    const leading = filename.trim().match(/^(\d{1,3})(?:\s*[-–_.]\s*(\S.*)?|$)/);
    // `House MD - 20 - Euphoria 1`: the show first, then the number, then the
    // title. Both dashes are required, and the number is capped at three
    // digits, so `Doctor Who - 2005 - Rose` is a year and not an episode.
    const afterShowName = filename.trim().match(/^(.+?)\s+[-–]\s+(\d{1,3})\s+[-–]\s+(\S.*)$/);
    const named = filename.match(/(?:^|[^a-z0-9])(?:episodes?|ep|e)[\s._-]*(\d{1,3})(?![0-9])/i);
    if (leading) {
      season = options.seasonHint;
      episode = parseInt(leading[1], 10);
      matchIndex = 0;
      matchLength = filename.trim().length - (leading[2]?.length ?? 0);
    } else if (afterShowName) {
      season = options.seasonHint;
      episode = parseInt(afterShowName[2], 10);
      showName = afterShowName[1].trim();
      episodeTitle = afterShowName[3].trim();
    } else if (named) {
      season = options.seasonHint;
      episode = parseInt(named[1], 10);
      matchIndex = named.index!;
      matchLength = named[0].length;
    }
  }

  if (season === undefined || episode === undefined) {
    return null;
  }

  // Extract show name (everything before the episode pattern)
  if (matchIndex !== undefined && matchIndex > 0) {
    showName = filename
      .substring(0, matchIndex)
      .replace(/[._]/g, ' ')
      .trim();
  }

  // Extract episode title (everything after the episode pattern, before quality indicators)
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
 * Parse a title and optional year from a collection/folder-style name.
 *
 * Unlike parseMovieFromFilename (tuned for release-style file names with quality
 * tags), this targets clean library folder names shaped "Name (Year)" and
 * tolerates trailing tags after the year:
 *   - "Blade Runner (1982)"          -> { title: "Blade Runner", year: 1982 }
 *   - "The Batman (2022) [1080p]"    -> { title: "The Batman",   year: 2022 }
 *   - "Blade Runner 2049 (2017)"     -> { title: "Blade Runner 2049", year: 2017 }
 *   - "Only Murders in the Building" -> { title: "Only Murders in the Building" }
 *
 * A parenthesised/bracketed year is strongly preferred (so digits that are part
 * of the title are preserved); a bare trailing year is only a best-effort fallback.
 */
export function parseTitleAndYear(name: string): ParsedMovie {
  const cleaned = name.replace(/[._]/g, ' ').trim();

  // Prefer a year in parentheses or brackets.
  const paren = cleaned.match(/^(.*?)[([]\s*((?:19|20)\d{2})\s*[)\]]/);
  if (paren && paren[1].trim()) {
    return { title: paren[1].trim(), year: parseInt(paren[2], 10) };
  }

  // Fallback: a bare 4-digit year at the very end ("Dune 2021").
  const bare = cleaned.match(/^(.*\S)\s+((?:19|20)\d{2})\s*$/);
  if (bare) {
    return { title: bare[1].trim(), year: parseInt(bare[2], 10) };
  }

  return { title: cleaned };
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
