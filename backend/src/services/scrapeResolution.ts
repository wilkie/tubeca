import type { ScrapeStatus } from '@prisma/client';
import type { ScraperPlugin, SearchResult } from '@tubeca/scraper-types';
import { prisma } from '../config/database';
import { pickBestMatch, type MatchQuery } from './scrapeMatching';

/** Outcome of trying to obtain metadata for one item. */
export type ScrapeAttempt<T> =
  | { status: 'matched'; scraperId: string; externalId: string; metadata: T; score?: number }
  | { status: 'nomatch'; message: string }
  | { status: 'failed'; message: string; error: Error; retryable: boolean };

/** Network/API errors worth retrying through BullMQ, as opposed to a definite miss. */
export function isRetryableError(error: Error): boolean {
  if (error.name === 'AbortError') return true;
  const message = error.message.toLowerCase();
  if (
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('api error: 5') ||
    message.includes('api error: 429')
  ) {
    return true;
  }
  const cause = (error as { cause?: { code?: string } }).cause;
  return Boolean(cause?.code?.startsWith('UND_ERR_') || cause?.code?.startsWith('ECONN'));
}

/**
 * Fetch metadata for an item that already has an identity (from a previous
 * match or from Identify). This never falls back to a name search: a transient
 * failure must not overwrite a user's explicit choice with the first search hit.
 */
export async function resolveByIdentity<T>(
  scraper: ScraperPlugin | undefined,
  scraperId: string,
  externalId: string,
  fetch: (scraper: ScraperPlugin) => Promise<T | null> | undefined
): Promise<ScrapeAttempt<T>> {
  if (!scraper) {
    return { status: 'nomatch', message: `Scraper "${scraperId}" is not configured; identification kept` };
  }
  try {
    const metadata = await fetch(scraper);
    if (metadata === undefined) {
      return { status: 'nomatch', message: `Scraper "${scraperId}" does not support this item type` };
    }
    if (metadata === null) {
      // A plugin returns null only when the provider answered and does not
      // have the entry: the title was deleted or merged there. Retrying three
      // times cannot help, so this is a no-match, and the identification is
      // kept so a person can see what it was pointing at.
      return {
        status: 'nomatch',
        message: `Scraper "${scraperId}" no longer has ${externalId}; identification kept`,
      };
    }
    return { status: 'matched', scraperId, externalId, metadata };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { status: 'failed', message: err.message, error: err, retryable: isRetryableError(err) };
  }
}

/**
 * Search each scraper in turn, score the hits against the query and fetch
 * metadata for the best one. Scrapers that throw are skipped; if every
 * scraper threw, the attempt is reported as failed (retryable if the errors
 * looked transient).
 */
export async function resolveBySearch<T>(
  scrapers: ScraperPlugin[],
  query: MatchQuery,
  search: (scraper: ScraperPlugin) => Promise<SearchResult[]> | undefined,
  fetch: (scraper: ScraperPlugin, externalId: string) => Promise<T | null>,
  minScore?: number
): Promise<ScrapeAttempt<T>> {
  const errors: Error[] = [];
  let attempted = 0;

  for (const scraper of scrapers) {
    const searching = search(scraper);
    if (!searching) continue;
    attempted++;
    try {
      const results = await searching;
      const best = pickBestMatch(query, results, minScore);
      if (!best) continue;
      const metadata = await fetch(scraper, best.result.externalId);
      if (metadata) {
        return {
          status: 'matched',
          scraperId: scraper.id,
          externalId: best.result.externalId,
          metadata,
          score: best.score,
        };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (attempted === 0) {
    return { status: 'nomatch', message: 'No configured scraper supports this item type' };
  }
  if (errors.length > 0 && errors.length === attempted) {
    const last = errors[errors.length - 1];
    return { status: 'failed', message: last.message, error: last, retryable: isRetryableError(last) };
  }
  const label = query.year ? `${query.title} (${query.year})` : query.title;
  return { status: 'nomatch', message: `No confident match for "${label}"` };
}

/** Map an attempt to the status stored on the entity. */
export function statusOf(attempt: ScrapeAttempt<unknown>): { scrapeStatus: ScrapeStatus; scrapeMessage: string | null } {
  switch (attempt.status) {
    case 'matched':
      return { scrapeStatus: 'Matched', scrapeMessage: null };
    case 'nomatch':
      return { scrapeStatus: 'NoMatch', scrapeMessage: attempt.message };
    case 'failed':
      return { scrapeStatus: 'Failed', scrapeMessage: attempt.message };
  }
}

export async function recordCollectionScrape(collectionId: string, attempt: ScrapeAttempt<unknown>): Promise<void> {
  await prisma.collection.updateMany({
    where: { id: collectionId },
    data: { ...statusOf(attempt), scrapedAt: new Date() },
  });
}

export async function recordMediaScrape(mediaId: string, attempt: ScrapeAttempt<unknown>): Promise<void> {
  await prisma.media.updateMany({
    where: { id: mediaId },
    data: { ...statusOf(attempt), scrapedAt: new Date() },
  });
}

export async function markCollectionScrapePending(collectionIds: string[]): Promise<void> {
  if (collectionIds.length === 0) return;
  await prisma.collection.updateMany({
    where: { id: { in: collectionIds } },
    data: { scrapeStatus: 'Pending', scrapeMessage: null },
  });
}

export async function markMediaScrapePending(mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  await prisma.media.updateMany({
    where: { id: { in: mediaIds } },
    data: { scrapeStatus: 'Pending', scrapeMessage: null },
  });
}
