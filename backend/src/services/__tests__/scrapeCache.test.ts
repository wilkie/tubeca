import { jest } from '@jest/globals';
import { cachedCall, clearScrapeCache, scrapeCacheKey, scrapeCacheStats } from '../scrapeCache';

describe('scrapeCacheKey', () => {
  it('separates scrapers, methods and arguments', () => {
    expect(scrapeCacheKey('tmdb', 'series', '1396')).toBe('tmdb:series:1396');
    expect(scrapeCacheKey('tvdb', 'series', '1396')).not.toBe(scrapeCacheKey('tmdb', 'series', '1396'));
    expect(scrapeCacheKey('tmdb', 'season', '1396', 2)).toBe('tmdb:season:1396:2');
  });

  it('keeps a missing argument distinct from an empty one', () => {
    expect(scrapeCacheKey('tmdb', 'searchVideo', 'Heat', undefined)).toBe('tmdb:searchVideo:Heat:');
  });
});

describe('cachedCall', () => {
  beforeEach(() => clearScrapeCache());

  it('calls through on a miss and reuses the answer afterwards', async () => {
    const fetch = jest.fn(async () => 'series');

    await expect(cachedCall('k', fetch)).resolves.toBe('series');
    await expect(cachedCall('k', fetch)).resolves.toBe('series');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(scrapeCacheStats()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('shares one in-flight call between concurrent callers', async () => {
    let resolveFetch: (value: string) => void = () => {};
    const fetch = jest.fn(() => new Promise<string>((resolve) => { resolveFetch = resolve; }));

    const both = Promise.all([cachedCall('k', fetch), cachedCall('k', fetch)]);
    resolveFetch('once');

    expect(await both).toEqual(['once', 'once']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure', async () => {
    let call = 0;
    const fetch = jest.fn(async () => {
      call++;
      if (call === 1) throw new Error('network');
      return 'second try';
    });

    await expect(cachedCall('k', fetch)).rejects.toThrow('network');
    await expect(cachedCall('k', fetch)).resolves.toBe('second try');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('re-fetches once the entry has expired', async () => {
    const fetch = jest.fn(async () => 'fresh');

    await cachedCall('k', fetch, 0);
    await cachedCall('k', fetch, 0);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps different keys apart', async () => {
    const fetch = jest.fn(async () => 'x');

    await cachedCall('a', fetch);
    await cachedCall('b', fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(scrapeCacheStats().size).toBe(2);
  });
});
