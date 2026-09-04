import type { ScraperPlugin, SearchResult } from '@tubeca/scraper-types';
import {
  resolveByIdentity,
  resolveBySearch,
  isRetryableError,
  recordCollectionScrape,
  markCollectionScrapePending,
} from '../scrapeResolution';
import { prisma, resetDatabase, createLibrary, createCollection } from '../../test/db';

type Meta = { externalId: string; title: string };

function fakeScraper(
  id: string,
  opts: {
    search?: (q: string) => Promise<SearchResult[]>
    fetch?: (id: string) => Promise<Meta | null>
  }
): ScraperPlugin {
  return {
    id,
    name: id,
    isConfigured: () => true,
    searchVideo: opts.search,
    getVideoMetadata: opts.fetch,
  } as unknown as ScraperPlugin;
}

describe('resolveByIdentity', () => {
  it('returns the metadata for a known id', async () => {
    const scraper = fakeScraper('tmdb', { fetch: async (id) => ({ externalId: id, title: 'Heat' }) });
    const attempt = await resolveByIdentity(scraper, 'tmdb', '949', (s) => s.getVideoMetadata?.('949'));
    expect(attempt).toMatchObject({ status: 'matched', scraperId: 'tmdb', externalId: '949' });
  });

  it('reports an entry the provider no longer has as a miss, without searching for a new one', async () => {
    // A plugin returns null only for a provider that answered and does not
    // have the id; a failure reaches here as a thrown error instead.
    const scraper = fakeScraper('tmdb', { fetch: async () => null });
    const attempt = await resolveByIdentity(scraper, 'tmdb', '949', (s) => s.getVideoMetadata?.('949'));
    expect(attempt).toMatchObject({ status: 'nomatch' });
    expect((attempt as { message: string }).message).toMatch(/no longer has 949; identification kept/);
  });

  it('handles a missing or incapable scraper without throwing', async () => {
    expect((await resolveByIdentity(undefined, 'gone', '1', () => undefined)).status).toBe('nomatch');
    const noFetch = fakeScraper('x', {});
    expect((await resolveByIdentity(noFetch, 'x', '1', (s) => s.getVideoMetadata?.('1'))).status).toBe('nomatch');
  });

  it('classifies thrown errors', async () => {
    const scraper = fakeScraper('tmdb', { fetch: async () => { throw new Error('fetch failed'); } });
    const attempt = await resolveByIdentity(scraper, 'tmdb', '1', (s) => s.getVideoMetadata?.('1'));
    expect(attempt).toMatchObject({ status: 'failed', retryable: true });
  });
});

describe('resolveBySearch', () => {
  const hits: SearchResult[] = [
    { externalId: 'seq', title: 'Blade Runner 2049', year: 2017, confidence: 0.9 },
    { externalId: 'orig', title: 'Blade Runner', year: 1982, confidence: 0.8 },
  ];
  const search = (s: ScraperPlugin) => s.searchVideo?.('q');
  const fetch = (s: ScraperPlugin, id: string) => s.getVideoMetadata!(id);

  it('scores hits instead of taking the first', async () => {
    const scraper = fakeScraper('tmdb', { search: async () => hits, fetch: async (id) => ({ externalId: id, title: 'x' }) });
    const attempt = await resolveBySearch([scraper], { title: 'Blade Runner', year: 1982 }, search, fetch);
    expect(attempt).toMatchObject({ status: 'matched', externalId: 'orig', scraperId: 'tmdb' });
  });

  it('reports no match when nothing scores high enough', async () => {
    const scraper = fakeScraper('tmdb', { search: async () => hits, fetch: async (id) => ({ externalId: id, title: 'x' }) });
    const attempt = await resolveBySearch([scraper], { title: 'Totally Different Film', year: 1990 }, search, fetch);
    expect(attempt).toMatchObject({ status: 'nomatch' });
    expect((attempt as { message: string }).message).toContain('Totally Different Film (1990)');
  });

  it('falls through to the next scraper when the first throws', async () => {
    const broken = fakeScraper('a', { search: async () => { throw new Error('API error: 500'); }, fetch: async () => null });
    const good = fakeScraper('b', { search: async () => hits, fetch: async (id) => ({ externalId: id, title: 'x' }) });
    const attempt = await resolveBySearch([broken, good], { title: 'Blade Runner', year: 1982 }, search, fetch);
    expect(attempt).toMatchObject({ status: 'matched', scraperId: 'b' });
  });

  it('is a retryable failure when every scraper threw a transient error', async () => {
    const broken = fakeScraper('a', { search: async () => { throw new Error('fetch failed'); }, fetch: async () => null });
    const attempt = await resolveBySearch([broken], { title: 'Heat' }, search, fetch);
    expect(attempt).toMatchObject({ status: 'failed', retryable: true });
  });

  it('is no match when no scraper supports the search', async () => {
    const attempt = await resolveBySearch([fakeScraper('a', {})], { title: 'Heat' }, search, fetch);
    expect(attempt).toMatchObject({ status: 'nomatch' });
  });
});

describe('isRetryableError', () => {
  it('recognises network and 5xx/429 errors but not definite misses', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableError(new Error('API error: 503'))).toBe(true);
    expect(isRetryableError(new Error('API error: 429'))).toBe(true);
    expect(isRetryableError(new Error('API error: 404'))).toBe(false);
    expect(isRetryableError(new Error('nothing found'))).toBe(false);
  });
});

describe('status recording', () => {
  beforeEach(resetDatabase);

  it('writes pending, then the outcome, onto the collection', async () => {
    const library = await createLibrary();
    const collection = await createCollection({ libraryId: library.id, name: 'Film' });

    await markCollectionScrapePending([collection.id]);
    expect(await prisma.collection.findUnique({ where: { id: collection.id } })).toMatchObject({ scrapeStatus: 'Pending', scrapeMessage: null });

    await recordCollectionScrape(collection.id, { status: 'nomatch', message: 'No confident match for "Film"' });
    const after = await prisma.collection.findUnique({ where: { id: collection.id } });
    expect(after).toMatchObject({ scrapeStatus: 'NoMatch', scrapeMessage: 'No confident match for "Film"' });
    expect(after!.scrapedAt).not.toBeNull();

    await recordCollectionScrape(collection.id, { status: 'matched', scraperId: 't', externalId: '1', metadata: {} });
    expect(await prisma.collection.findUnique({ where: { id: collection.id } })).toMatchObject({ scrapeStatus: 'Matched', scrapeMessage: null });
  });
});
