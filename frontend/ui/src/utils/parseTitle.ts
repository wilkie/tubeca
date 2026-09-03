export interface ParsedTitle {
  title: string;
  year?: number;
}

/**
 * Parse a title and optional year from a collection/folder-style name such as
 * "Blade Runner (1982)". Used to pre-fill the Identify dialog with the presumed
 * title and year. Mirrors the backend's parseTitleAndYear (mediaParser.ts).
 *
 * A parenthesised/bracketed year is preferred so digits that are part of the
 * title are preserved (e.g. "Blade Runner 2049 (2017)"); a bare trailing year is
 * only a best-effort fallback.
 *
 * @example
 * parseTitleAndYear('Blade Runner (1982)')          // { title: 'Blade Runner', year: 1982 }
 * parseTitleAndYear('The Batman (2022) [1080p]')    // { title: 'The Batman', year: 2022 }
 * parseTitleAndYear('Blade Runner 2049 (2017)')     // { title: 'Blade Runner 2049', year: 2017 }
 * parseTitleAndYear('Only Murders in the Building') // { title: 'Only Murders in the Building' }
 */
export function parseTitleAndYear(name: string): ParsedTitle {
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
