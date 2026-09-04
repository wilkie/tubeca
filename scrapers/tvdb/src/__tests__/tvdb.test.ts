import { jest } from '@jest/globals';
import { TVDBScraper } from '../index';

/** Every TVDB response the test wants, keyed by the path it comes back for. */
let routes: Record<string, unknown>;
let requests: Array<{ path: string; headers: Record<string, string>; method?: string }>;

/** Answer from `routes`, and remember what was asked. */
const respond = async (input: unknown, init?: unknown) => {
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
};

const fetchMock = jest.fn(respond);

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
  // A reset, not a clear: a test that makes fetch misbehave must not leave it
  // misbehaving for the next one, which signs in before it sets its own mocks.
  fetchMock.mockReset();
  fetchMock.mockImplementation(respond);
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
  it('searches series unless a film was asked for', async () => {
    routes['/v4/search'] = { data: [] };
    const plugin = await scraper();

    await plugin.searchVideo!('Breaking Bad', { videoType: 'tv_series' });

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

    // A search endpoint that 404s is TVDB not answering, not "no such show".
    await expect(plugin.searchSeries!('Dark')).rejects.toThrow(/TVDB has no/);
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
          { id: 3, type: 23, image: 'https://artworks.thetvdb.com/logo.png' },
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

describe('a show', () => {
  const seriesRecord = {
    id: 328724,
    name: 'Dark',
    originalName: 'Dark',
    overview: 'A missing child.',
    firstAired: '2017-12-01',
    lastAired: '2020-06-27',
    status: { name: 'Ended' },
    image: 'https://artworks.thetvdb.com/fallback.jpg',
    genres: [{ name: 'Drama' }],
    tags: [{ name: 'time travel' }, { tagName: 'category', name: 'mystery' }],
    artworks: [
      { type: 2, image: 'https://artworks.thetvdb.com/poster.jpg' },
      { type: 3, image: 'https://artworks.thetvdb.com/backdrop.jpg' },
      { type: 23, image: 'https://artworks.thetvdb.com/logo.png' },
    ],
    characters: [
      { id: 1, name: 'Jonas', personName: 'Louis Hofmann', type: 3, sort: 1, peopleId: 10 },
    ],
    seasons: [
      { id: 700, number: 0, type: { type: 'official' } },
      { id: 701, number: 1, type: { type: 'official' }, image: 'https://artworks.thetvdb.com/s1.jpg' },
      { id: 702, number: 2, type: { type: 'official' } },
      { id: 800, number: 1, type: { type: 'dvd' } },
    ],
  };

  beforeEach(() => {
    routes['/v4/series/328724/extended'] = { data: seriesRecord };
  });

  it('maps the show a Show collection needs', async () => {
    const plugin = await scraper();

    expect(await plugin.getSeriesMetadata!('series-328724')).toMatchObject({
      externalId: 'series-328724',
      title: 'Dark',
      description: 'A missing child.',
      firstAirDate: new Date('2017-12-01'),
      lastAirDate: new Date('2020-06-27'),
      status: 'Ended',
      genres: ['Drama'],
      keywords: ['time travel', 'mystery'],
      posterUrl: 'https://artworks.thetvdb.com/poster.jpg',
      backdropUrl: 'https://artworks.thetvdb.com/backdrop.jpg',
      logoUrl: 'https://artworks.thetvdb.com/logo.png',
    });
  });

  it('offers every poster it has as a candidate, the first one being the one it uses', async () => {
    routes['/v4/series/328724/extended'] = {
      data: {
        id: 328724,
        name: 'Dark',
        artworks: [
          { type: 2, image: 'https://artworks.thetvdb.com/poster-1.jpg' },
          { type: 7, image: 'https://artworks.thetvdb.com/season-poster.jpg' },
          { type: 2, image: 'https://artworks.thetvdb.com/poster-2.jpg' },
          { type: 3, image: 'https://artworks.thetvdb.com/backdrop.jpg' },
        ],
      },
    };
    const plugin = await scraper();

    const metadata = await plugin.getSeriesMetadata!('series-328724');

    expect(metadata!.posterUrl).toBe('https://artworks.thetvdb.com/poster-1.jpg');
    // The season poster in the middle belongs to a season, not to the show.
    expect(metadata!.posterUrls).toEqual([
      'https://artworks.thetvdb.com/poster-1.jpg',
      'https://artworks.thetvdb.com/poster-2.jpg',
    ]);
    expect(metadata!.backdropUrls).toEqual(['https://artworks.thetvdb.com/backdrop.jpg']);
    expect(metadata!.logoUrls).toBeUndefined();
  });

  it('offers no rating, since TVDB scores in the millions rather than out of ten', async () => {
    const plugin = await scraper();

    expect((await plugin.getSeriesMetadata!('series-328724'))!.rating).toBeUndefined();
  });

  it('takes the logo from the series clearlogo, not the season banner id', async () => {
    // Artwork ids are per record type: 6 is a season banner, so a series record
    // never carries one and the old mapping could not resolve a logo at all.
    routes['/v4/series/328724/extended'] = {
      data: {
        id: 328724,
        name: 'Dark',
        artworks: [{ type: 6, image: 'https://artworks.thetvdb.com/banner.jpg' }],
      },
    };
    const plugin = await scraper();

    expect((await plugin.getSeriesMetadata!('series-328724'))!.logoUrl).toBeUndefined();
  });

  it('counts the aired seasons, leaving out specials and other orderings', async () => {
    const plugin = await scraper();

    expect((await plugin.getSeriesMetadata!('series-328724'))!.seasonCount).toBe(2);
  });

  it('carries the cast through', async () => {
    const plugin = await scraper();

    expect((await plugin.getSeriesMetadata!('series-328724'))!.credits).toEqual([
      { name: 'Louis Hofmann', role: 'Jonas', type: 'actor', order: 1, photoUrl: undefined, tvdbId: 10 },
    ]);
  });

  it('leaves out an original name that says the same thing', async () => {
    const plugin = await scraper();

    expect((await plugin.getSeriesMetadata!('series-328724'))!.originalTitle).toBeUndefined();
  });

  it('takes a bare id as well as a prefixed one', async () => {
    const plugin = await scraper();

    expect(await plugin.getSeriesMetadata!('328724')).toMatchObject({ title: 'Dark' });
  });

  it('says nothing when the show is not there', async () => {
    const plugin = await scraper();

    expect(await plugin.getSeriesMetadata!('series-999')).toBeNull();
  });
});

describe('a season', () => {
  beforeEach(() => {
    routes['/v4/series/328724/extended'] = {
      data: {
        id: 328724,
        name: 'Dark',
        seasons: [
          { id: 700, number: 0, type: { type: 'official' } },
          { id: 701, number: 1, type: { type: 'official' }, image: 'https://artworks.thetvdb.com/s1-summary.jpg' },
          { id: 800, number: 1, type: { type: 'dvd' } },
        ],
      },
    };
    routes['/v4/seasons/701/extended'] = {
      data: {
        id: 701,
        seriesId: 328724,
        number: 1,
        image: 'https://artworks.thetvdb.com/s1.jpg',
        overviewTranslations: ['eng,deu'],
        episodes: [
          { id: 2, name: 'Lies', seasonNumber: 1, number: 2, aired: '2017-12-01' },
          { id: 1, name: 'Secrets', seasonNumber: 1, number: 1, aired: '2017-11-30' },
        ],
      },
    };
    routes['/v4/seasons/701/translations/eng'] = {
      data: { name: 'Season 1', overview: 'The first season.' },
    };
  });

  it('resolves the season number to its own id before asking for it', async () => {
    const plugin = await scraper();

    const metadata = await plugin.getSeasonMetadata!('series-328724', 1);

    expect(requests.map((r) => r.path)).toContain('/v4/seasons/701/extended');
    expect(metadata).toMatchObject({ externalId: 'season-701', seasonNumber: 1, episodeCount: 2 });
  });

  it('dates the season from the earliest episode in it', async () => {
    const plugin = await scraper();

    expect((await plugin.getSeasonMetadata!('series-328724', 1))!.airDate).toEqual(
      new Date('2017-11-30')
    );
  });

  it('reads the name and overview from the translation the record lacks', async () => {
    const plugin = await scraper();

    const metadata = await plugin.getSeasonMetadata!('series-328724', 1);

    expect(metadata!.description).toBe('The first season.');
    // "Season 1" is what the UI would have said anyway.
    expect(metadata!.name).toBeUndefined();
  });

  it('keeps a season name worth having', async () => {
    routes['/v4/seasons/701/translations/eng'] = {
      data: { name: 'The Beginning', overview: 'The first season.' },
    };
    const plugin = await scraper();

    expect((await plugin.getSeasonMetadata!('series-328724', 1))!.name).toBe('The Beginning');
  });

  it('asks for no translation when the record carries both name and overview', async () => {
    const season = (routes['/v4/seasons/701/extended'] as { data: Record<string, unknown> }).data;
    season.name = 'The Beginning';
    season.overview = 'On the record.';
    const plugin = await scraper();

    const metadata = await plugin.getSeasonMetadata!('series-328724', 1);

    expect(metadata).toMatchObject({ name: 'The Beginning', description: 'On the record.' });
    expect(requests.map((r) => r.path)).not.toContain('/v4/seasons/701/translations/eng');
  });

  // The record has a name field but never an overview, so a name alone must not
  // stop the fetch that gets the overview.
  it('still asks for the translation when only the name is on the record', async () => {
    (routes['/v4/seasons/701/extended'] as { data: Record<string, unknown> }).data.name =
      'The Beginning';
    routes['/v4/seasons/701/translations/eng'] = {
      data: { name: 'Ignored', overview: 'The first season.' },
    };
    const plugin = await scraper();

    const metadata = await plugin.getSeasonMetadata!('series-328724', 1);

    expect(metadata).toMatchObject({ name: 'The Beginning', description: 'The first season.' });
  });

  it('still returns the season when the translation it lists turns out to be missing', async () => {
    delete routes['/v4/seasons/701/translations/eng'];
    const plugin = await scraper();

    expect(await plugin.getSeasonMetadata!('series-328724', 1)).toMatchObject({
      externalId: 'season-701',
      description: undefined,
    });
  });

  it('asks for no translation for a season that lists none in this language', async () => {
    (routes['/v4/seasons/701/extended'] as { data: Record<string, unknown> }).data
      .overviewTranslations = [];
    const plugin = await scraper();

    const metadata = await plugin.getSeasonMetadata!('series-328724', 1);

    expect(metadata).toMatchObject({ externalId: 'season-701', description: undefined });
    expect(requests.map((r) => r.path)).not.toContain('/v4/seasons/701/translations/eng');
  });

  it('reads a language list that arrives comma-joined in one entry', async () => {
    (routes['/v4/seasons/701/extended'] as { data: Record<string, unknown> }).data
      .overviewTranslations = ['pol,ell,deu,eng,swe'];
    const plugin = await scraper();

    expect((await plugin.getSeasonMetadata!('series-328724', 1))!.description).toBe(
      'The first season.'
    );
  });

  it('follows the configured language when it asks', async () => {
    routes['/v4/seasons/701/translations/deu'] = { data: { overview: 'Die erste Staffel.' } };
    const plugin = await scraper({ language: 'deu' });

    expect((await plugin.getSeasonMetadata!('series-328724', 1))!.description).toBe(
      'Die erste Staffel.'
    );
  });

  it('says nothing for a season the show does not have', async () => {
    const plugin = await scraper();

    expect(await plugin.getSeasonMetadata!('series-328724', 9)).toBeNull();
  });

  it('says nothing when the show itself is gone', async () => {
    const plugin = await scraper();

    expect(await plugin.getSeasonMetadata!('series-999', 1)).toBeNull();
  });
});

describe('when TVDB misbehaves', () => {
  it('gives up on a client error rather than retrying', async () => {
    const plugin = await scraper();
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as never);

    await expect(plugin.searchSeries!('Dark')).rejects.toThrow('TVDB API error: 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a record the provider says it does not have', async () => {
    const plugin = await scraper();
    fetchMock.mockClear();

    await expect(plugin.searchSeries!('Dark')).rejects.toThrow(/TVDB has no/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a server error, then gives up with it', async () => {
    jest.useFakeTimers();
    try {
      const plugin = await scraper();
      fetchMock.mockClear();
      fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as never);
      const searching = plugin.searchSeries!('Dark');
      const settled = expect(searching).rejects.toThrow('TVDB API error: 503');

      await jest.advanceTimersByTimeAsync(10000);
      await settled;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries a rate limit, and keeps the answer when it comes', async () => {
    jest.useFakeTimers();
    try {
      const plugin = await scraper();
      fetchMock.mockClear();
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) } as never)
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) } as never);
      const searching = plugin.searchSeries!('Dark');

      await jest.advanceTimersByTimeAsync(10000);

      expect(await searching).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives a request that never answers a deadline', async () => {
    jest.useFakeTimers();
    try {
      const plugin = await scraper();
      fetchMock.mockClear();
      fetchMock.mockImplementation(
        (_input: unknown, init?: unknown) =>
          new Promise((_resolve, reject) => {
            const signal = (init as { signal?: AbortSignal }).signal;
            signal?.addEventListener('abort', () => {
              const error = new Error('This operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      );
      const searching = plugin.searchSeries!('Dark');
      const settled = expect(searching).rejects.toThrow(/aborted/);

      await jest.advanceTimersByTimeAsync(60000);
      await settled;

      // Three attempts, each abandoned after ten seconds.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('a film', () => {
  const movieRecord = {
    id: 1305,
    name: 'Heat',
    year: '1995',
    runtime: 170,
    status: { name: 'Released' },
    image: 'https://artworks.thetvdb.com/movies/fallback.jpg',
    genres: [{ name: 'Crime' }, { name: 'Drama' }],
    contentRatings: [
      { country: 'bra', name: '14' },
      { country: 'usa', name: 'R' },
    ],
    first_release: { date: '1995-12-15' },
    overviewTranslations: ['eng', 'fra'],
    artworks: [
      { type: 14, image: 'https://artworks.thetvdb.com/movies/poster-1.jpg' },
      { type: 14, image: 'https://artworks.thetvdb.com/movies/poster-2.jpg' },
      { type: 15, image: 'https://artworks.thetvdb.com/movies/background.jpg' },
      { type: 25, image: 'https://artworks.thetvdb.com/movies/logo.png' },
      // A series poster id, which a film record does not use.
      { type: 2, image: 'https://artworks.thetvdb.com/series-poster.jpg' },
    ],
    characters: [
      { id: 1, name: 'Lt. Vincent Hanna', personName: 'Al Pacino', type: 3, sort: 1, peopleId: 10 },
    ],
  };

  beforeEach(() => {
    routes['/v4/movies/1305/extended'] = { data: movieRecord };
    routes['/v4/movies/1305/translations/eng'] = {
      data: { name: 'Heat', overview: 'A crew of thieves and the detective chasing them.' },
    };
  });

  it('searches the films when it is asked for one', async () => {
    routes['/v4/search'] = { data: [] };
    const plugin = await scraper();

    await plugin.searchVideo!('Heat', { year: 1995, videoType: 'movie' });

    expect(requests[1].path).toContain('type=movie');
    expect(requests[1].path).toContain('year=1995');
  });

  it('says a film result is a film', async () => {
    routes['/v4/search'] = {
      data: [{ objectID: 'movie-1305', name: 'Heat', year: '1995', image_url: 'p.jpg' }],
    };
    const plugin = await scraper();

    expect(await plugin.searchVideo!('Heat', { videoType: 'movie' })).toEqual([
      {
        externalId: 'movie-1305',
        title: 'Heat',
        year: 1995,
        overview: undefined,
        posterUrl: 'p.jpg',
        videoType: 'movie',
      },
    ]);
  });

  it('still searches series for everything else', async () => {
    routes['/v4/search'] = { data: [] };
    const plugin = await scraper();

    await plugin.searchVideo!('Breaking Bad');

    expect(requests[1].path).toContain('type=series');
  });

  it('maps the film record, taking its artwork ids rather than a series own', async () => {
    const plugin = await scraper();

    expect(await plugin.getVideoMetadata!('movie-1305')).toMatchObject({
      externalId: 'movie-1305',
      title: 'Heat',
      description: 'A crew of thieves and the detective chasing them.',
      releaseDate: new Date('1995-12-15'),
      runtime: 170,
      rating: 'R',
      genres: ['Crime', 'Drama'],
      posterUrl: 'https://artworks.thetvdb.com/movies/poster-1.jpg',
      backdropUrl: 'https://artworks.thetvdb.com/movies/background.jpg',
      logoUrl: 'https://artworks.thetvdb.com/movies/logo.png',
      posterUrls: [
        'https://artworks.thetvdb.com/movies/poster-1.jpg',
        'https://artworks.thetvdb.com/movies/poster-2.jpg',
      ],
    });
  });

  it('asks the movie endpoint, not the series one', async () => {
    const plugin = await scraper();

    await plugin.getVideoMetadata!('movie-1305');

    expect(requests.map((r) => r.path)).toContain('/v4/movies/1305/extended');
    expect(requests.map((r) => r.path)).not.toContain('/v4/series/1305/extended');
  });

  it('asks for no translation for a film that has none in this language', async () => {
    (routes['/v4/movies/1305/extended'] as { data: Record<string, unknown> }).data
      .overviewTranslations = ['fra'];
    const plugin = await scraper();

    const film = await plugin.getVideoMetadata!('movie-1305');

    expect(film!.description).toBeUndefined();
    expect(requests.map((r) => r.path)).not.toContain('/v4/movies/1305/translations/eng');
  });

  it('falls back to the record image when the film has no poster artwork', async () => {
    (routes['/v4/movies/1305/extended'] as { data: Record<string, unknown> }).data.artworks = [];
    const plugin = await scraper();

    expect((await plugin.getVideoMetadata!('movie-1305'))!.posterUrl).toBe(
      'https://artworks.thetvdb.com/movies/fallback.jpg'
    );
  });

  it('says nothing for a film that is not there', async () => {
    const plugin = await scraper();

    expect(await plugin.getVideoMetadata!('movie-999')).toBeNull();
  });

  it('lets a provider failure escape rather than passing it off as a miss', async () => {
    jest.useFakeTimers();
    try {
      const plugin = await scraper();
      fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as never);
      const fetching = plugin.getVideoMetadata!('movie-1305');
      const settled = expect(fetching).rejects.toThrow('TVDB API error: 503');

      await jest.advanceTimersByTimeAsync(10000);
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps only the top twenty of a long cast, as TMDB does', async () => {
    (routes['/v4/movies/1305/extended'] as { data: Record<string, unknown> }).data.characters =
      Array.from({ length: 57 }, (_, i) => ({
        id: i,
        name: `Character ${i}`,
        personName: `Actor ${i}`,
        type: 3,
        sort: i,
        peopleId: i,
      }));
    const plugin = await scraper();

    expect((await plugin.getVideoMetadata!('movie-1305'))!.credits).toHaveLength(20);
  });
});
