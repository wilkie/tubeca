import { jest } from '@jest/globals';
import { TVDBScraper } from '../index';

/** Every TVDB response the test wants, keyed by the path it comes back for. */
let routes: Record<string, unknown>;
let requests: Array<{ path: string; headers: Record<string, string>; method?: string }>;

const fetchMock = jest.fn(async (input: unknown, init?: unknown) => {
  const url = new URL(String(input));
  const options = (init ?? {}) as { headers?: Record<string, string>; method?: string };
  requests.push({
    path: url.pathname + url.search,
    headers: options.headers ?? {},
    method: options.method,
  });
  const body = routes[url.pathname + url.search] ?? routes[url.pathname];
  if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => body };
});

const loggedIn = { data: { token: 'a-token' } };

async function scraper(config: Record<string, unknown> = {}) {
  routes['/v4/login'] = loggedIn;
  const plugin = new TVDBScraper();
  await plugin.initialize({ apiKey: 'test-key', ...config });
  return plugin;
}

beforeEach(() => {
  routes = {};
  requests = [];
  fetchMock.mockClear();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe('signing in', () => {
  it('trades the API key for a token when it starts up', async () => {
    const plugin = await scraper();

    expect(requests[0]).toMatchObject({ path: '/v4/login', method: 'POST' });
    expect(plugin.isConfigured()).toBe(true);
  });

  it('is not configured without a key, and does not try to sign in', async () => {
    const plugin = new TVDBScraper();
    await plugin.initialize({});

    expect(plugin.isConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets a rejected key surface rather than starting up half-ready', async () => {
    const plugin = new TVDBScraper();
    routes = {};

    await expect(plugin.initialize({ apiKey: 'wrong' })).rejects.toThrow(
      'TVDB authentication failed: 404'
    );
    expect(plugin.isConfigured()).toBe(false);
  });

  it('sends the token and the configured language on every call after that', async () => {
    routes['/v4/search'] = { data: [] };
    const plugin = await scraper({ language: 'deu' });

    await plugin.searchSeries!('Dark');

    expect(requests[1].headers).toMatchObject({
      Authorization: 'Bearer a-token',
      'Accept-Language': 'deu',
    });
  });

  it('signs in again once the token has expired', async () => {
    jest.useFakeTimers();
    try {
      routes['/v4/search'] = { data: [] };
      const plugin = await scraper();

      jest.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await plugin.searchSeries!('Dark');

      expect(requests.filter((r) => r.path === '/v4/login')).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('searching', () => {
  it('only ever searches for series', async () => {
    routes['/v4/search'] = { data: [] };
    const plugin = await scraper();

    await plugin.searchVideo!('Heat', { videoType: 'movie' });

    expect(requests[1].path).toContain('type=series');
  });

  it('passes a year through', async () => {
    routes['/v4/search'] = { data: [] };
    const plugin = await scraper();

    await plugin.searchVideo!('Dark', { year: 2017 });

    expect(requests[1].path).toContain('year=2017');
  });

  it('maps a result, keeping TVDB’s own id', async () => {
    routes['/v4/search'] = {
      data: [
        {
          objectID: 'series-328724',
          name: 'Dark',
          year: '2017',
          overview: 'A missing child.',
          image_url: 'https://artworks.thetvdb.com/dark.jpg',
        },
      ],
    };
    const plugin = await scraper();

    expect(await plugin.searchSeries!('Dark')).toEqual([
      {
        externalId: 'series-328724',
        title: 'Dark',
        year: 2017,
        overview: 'A missing child.',
        posterUrl: 'https://artworks.thetvdb.com/dark.jpg',
        videoType: 'tv_series',
      },
    ]);
  });

  it('lets a search failure through rather than reporting no results', async () => {
    const plugin = await scraper();

    await expect(plugin.searchSeries!('Dark')).rejects.toThrow('TVDB API error: 404');
  });
});

describe('a series', () => {
  beforeEach(() => {
    routes['/v4/series/328724/extended'] = {
      data: {
        id: 328724,
        name: 'Dark',
        originalName: 'Dark',
        overview: 'A missing child.',
        firstAired: '2017-12-01',
        image: 'https://artworks.thetvdb.com/fallback.jpg',
        genres: [{ id: 1, name: 'Drama' }],
        contentRatings: [
          { country: 'deu', name: '16' },
          { country: 'usa', name: 'TV-MA' },
        ],
        artworks: [
          { id: 1, type: 3, image: 'https://artworks.thetvdb.com/backdrop.jpg' },
          { id: 2, type: 2, image: 'https://artworks.thetvdb.com/poster.jpg' },
          { id: 3, type: 6, image: 'https://artworks.thetvdb.com/logo.png' },
        ],
        characters: [
          { id: 1, name: 'Jonas', personName: 'Louis Hofmann', type: 3, sort: 1, peopleId: 10 },
          { id: 2, name: '', personName: 'Baran bo Odar', type: 1, sort: 0, peopleId: 11 },
        ],
      },
    };
  });

  it('maps the series and picks artwork out by type', async () => {
    const plugin = await scraper();

    expect(await plugin.getVideoMetadata!('series-328724')).toMatchObject({
      externalId: 'series-328724',
      title: 'Dark',
      description: 'A missing child.',
      releaseDate: new Date('2017-12-01'),
      genres: ['Drama'],
      posterUrl: 'https://artworks.thetvdb.com/poster.jpg',
      backdropUrl: 'https://artworks.thetvdb.com/backdrop.jpg',
      logoUrl: 'https://artworks.thetvdb.com/logo.png',
    });
  });

  it('takes the US certificate, whatever language it was asked in', async () => {
    const plugin = await scraper({ language: 'deu' });

    expect((await plugin.getVideoMetadata!('series-328724'))!.rating).toBe('TV-MA');
  });

  it('falls back to the series image when there is no poster artwork', async () => {
    (routes['/v4/series/328724/extended'] as { data: { artworks: unknown[] } }).data.artworks = [];
    const plugin = await scraper();

    expect((await plugin.getVideoMetadata!('series-328724'))!.posterUrl).toBe(
      'https://artworks.thetvdb.com/fallback.jpg'
    );
  });

  it('maps characters to credits, crew first by sort order', async () => {
    const plugin = await scraper();

    expect((await plugin.getVideoMetadata!('series-328724'))!.credits).toEqual([
      { name: 'Baran bo Odar', role: '', type: 'director', order: 0, photoUrl: undefined, tvdbId: 11 },
      { name: 'Louis Hofmann', role: 'Jonas', type: 'actor', order: 1, photoUrl: undefined, tvdbId: 10 },
    ]);
  });

  it('says nothing when the series is not there', async () => {
    const plugin = await scraper();

    expect(await plugin.getVideoMetadata!('series-999')).toBeNull();
  });
});

describe('an episode', () => {
  beforeEach(() => {
    routes['/v4/series/328724/episodes/default?season=1'] = {
      data: {
        series: { id: 328724, name: 'Dark' },
        episodes: [
          { id: 6493135, name: 'Secrets', seasonNumber: 1, number: 1, aired: '2017-12-01', runtime: 51 },
          { id: 6493136, name: 'Lies', seasonNumber: 1, number: 2 },
        ],
      },
    };
    routes['/v4/episodes/6493135/extended'] = {
      data: {
        id: 6493135,
        characters: [
          { id: 1, name: 'Jonas', personName: 'Louis Hofmann', type: 3, sort: 1, peopleId: 10 },
        ],
      },
    };
  });

  it('finds the episode in the season it asked for', async () => {
    const plugin = await scraper();

    expect(await plugin.getEpisodeMetadata!('series-328724', 1, 1)).toMatchObject({
      externalId: 'episode-6493135',
      title: 'Secrets',
      episodeTitle: 'Secrets',
      season: 1,
      episode: 1,
      runtime: 51,
      showName: 'Dark',
    });
  });

  it('takes the credits from the extended record', async () => {
    const plugin = await scraper();

    const metadata = await plugin.getEpisodeMetadata!('series-328724', 1, 1);

    expect(metadata!.credits!.map((c) => c.name)).toEqual(['Louis Hofmann']);
  });

  it('still returns the episode when the extended record is unavailable', async () => {
    delete routes['/v4/episodes/6493135/extended'];
    const plugin = await scraper();

    const metadata = await plugin.getEpisodeMetadata!('series-328724', 1, 1);

    expect(metadata).toMatchObject({ title: 'Secrets' });
    expect(metadata!.credits).toEqual([]);
  });

  it('says nothing for an episode the season does not hold', async () => {
    const plugin = await scraper();

    expect(await plugin.getEpisodeMetadata!('series-328724', 1, 99)).toBeNull();
  });
});

describe('a person', () => {
  it('maps the person, taking the English biography', async () => {
    routes['/v4/people/10/extended'] = {
      data: {
        id: 10,
        name: 'Louis Hofmann',
        birth: '1997-06-03',
        birthPlace: 'Bergisch Gladbach',
        image: 'https://artworks.thetvdb.com/lh.jpg',
        biographies: [
          { language: 'deu', biography: 'Ein Schauspieler.' },
          { language: 'eng', biography: 'An actor.' },
        ],
      },
    };
    const plugin = await scraper();

    expect(await plugin.getPersonMetadata!('tvdb-10')).toEqual({
      externalId: 'tvdb-10',
      name: 'Louis Hofmann',
      biography: 'An actor.',
      birthDate: '1997-06-03',
      deathDate: undefined,
      birthPlace: 'Bergisch Gladbach',
      photoUrl: 'https://artworks.thetvdb.com/lh.jpg',
      tvdbId: 10,
    });
  });

  it('says nothing for a person it cannot fetch', async () => {
    const plugin = await scraper();

    expect(await plugin.getPersonMetadata!('tvdb-404')).toBeNull();
  });
});

describe('what it cannot do', () => {
  it('offers no series or season metadata, so a collection job cannot complete', async () => {
    // The worker asks a plugin for these before using it; TVDB has neither, so
    // a Show or Season job that picks TVDB can only report no match.
    const plugin = (await scraper()) as unknown as Record<string, unknown>;

    expect(plugin.getSeriesMetadata).toBeUndefined();
    expect(plugin.getSeasonMetadata).toBeUndefined();
  });
});
