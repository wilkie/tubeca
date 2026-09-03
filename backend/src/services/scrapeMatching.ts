import type { SearchResult } from '@tubeca/scraper-types';

/** What we know about the item we are trying to identify. */
export interface MatchQuery {
  title: string
  year?: number
}

export interface ScoredResult {
  result: SearchResult
  score: number
}

/** Minimum score for a search hit to be accepted automatically. */
export const DEFAULT_MIN_SCORE = 0.55;

/**
 * Normalise a title for comparison: lower-case, strip diacritics and
 * punctuation, collapse whitespace, drop a leading article.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
    .replace(/\s+/g, ' ');
}

function tokens(s: string): Set<string> {
  return new Set(s.split(' ').filter(Boolean));
}

/** 0..1 similarity between two titles. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    // Prefix/substring: scale by how much of the longer title is covered
    return 0.6 + 0.3 * (Math.min(na.length, nb.length) / Math.max(na.length, nb.length));
  }
  const ta = tokens(na);
  const tb = tokens(nb);
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  const union = ta.size + tb.size - common;
  return union === 0 ? 0 : (common / union) * 0.7;
}

/**
 * Score one search result against the query. Title similarity dominates; a
 * known year confirms or contradicts; the scraper's own confidence and
 * ordering only break ties.
 */
export function scoreCandidate(query: MatchQuery, candidate: SearchResult, index = 0): number {
  let score = titleSimilarity(query.title, candidate.title);

  if (query.year && candidate.year) {
    const delta = Math.abs(query.year - candidate.year);
    if (delta === 0) score += 0.25;
    else if (delta === 1) score += 0.1;
    else score -= 0.3;
  }

  score += (candidate.confidence ?? 0) * 0.05;
  score -= index * 0.01;
  return score;
}

/**
 * Pick the best-scoring result, or null when nothing clears `minScore`.
 * Returning null is what lets a bad first hit become "No match, use Identify"
 * instead of silently wrong metadata.
 */
export function pickBestMatch(
  query: MatchQuery,
  results: SearchResult[],
  minScore = DEFAULT_MIN_SCORE
): ScoredResult | null {
  let best: ScoredResult | null = null;
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    const score = scoreCandidate(query, result, index);
    if (best === null || score > best.score) {
      best = { result, score };
    }
  }
  if (best === null) return null;
  return best.score >= minScore ? best : null;
}
