import { jest } from '@jest/globals';
import { TMDBScraper } from '../index';

/** Every TMDB response the test wants, keyed by the path it comes back for. */
let routes: Record<string, unknown>;
let requested: string[];

const fetchMock = jest.fn(async (input: unknown) => {
  const url = new URL(String(input));
  requested.push(url.pathname + url.search);
  const body = routes[url.pathname];
  if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => body };
});

async function scraper(config: Record<string, unknown> = {}) {
  const plugin = new TMDBScraper();
  await plugin.initialize({ apiKey: 'test-key', ...config });
  return plugin;
}

/** The query string of the request that hit this path. */
const queryFor = (path: string) =>
  new URLSearchParams(requested.find((r) => r.startsWith(path))!.split('?')[1]);

beforeEach(() => {
  routes = {};
  requested = [];
  fetchMock.mockClear();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe('configuration', () => {
  it('is not usable without an API key', async () => {
    const plugin = new TMDBScraper();
    await plugin.initialize({});

    expect(plugin.isConfigured()).toBe(false);
    await expect(plugin.searchVideo!('Heat')).rejects.toThrow('TMDB API key not configured');
  });

  it('sends the key, and English by default', async () => {
    routes['/3/search/multi'] = { results: [] };
    await (await scraper()).searchVideo!('Heat');

    expect(queryFor('/3/search/multi').get('api_key')).toBe('test-key');
    expect(queryFor('/3/search/multi').get('language')).toBe('en-US');
    expect(queryFor('/3/search/multi').get('region')).toBeNull();
  });

  it('follows the language and region it was configured with', async () => {
    routes['/3/search/multi'] = { results: [] };
    await (await scraper({ language: 'fr-FR', region: 'FR' })).searchVideo!('Heat');

    expect(queryFor('/3/search/multi').get('language')).toBe('fr-FR');
    expect(queryFor('/3/search/multi').get('region')).toBe('FR');
  });

  it('announces what it can do', async () => {
    const plugin = await scraper();

    expect(plugin.id).toBe('tmdb');
    expect(plugin.supportedTypes).toContain('video');
  });
});

describe('searching', () => {
  it('asks the movie endpoint for a film, with the year', async () => {
    routes['/3/search/movie'] = { results: [] };

    await (await scraper()).searchVideo!('Heat', { year: 1995, videoType: 'movie' });

    expect(queryFor('/3/search/movie').get('query')).toBe('Heat');
    expect(queryFor('/3/search/movie').get('year')).toBe('1995');
  });

  it('asks the tv endpoint for a series', async () => {
    routes['/3/search/tv'] = { results: [] };

    await (await scraper()).searchSeries!('Breaking Bad');

    expect(requested[0]).toContain('/3/search/tv');
  });

  it('asks for both when it is not told which', async () => {
    routes['/3/search/multi'] = { results: [] };

    await (await scraper()).searchVideo!('Heat');

    expect(requested[0]).toContain('/3/search/multi');
  });

  it('maps a film result, prefixing the id with its type', async () => {
    routes['/3/search/movie'] = {
      results: [
        {
          id: 949,
          title: 'Heat',
          release_date: '1995-12-15',
          overview: 'A crew of thieves.',
          poster_path: '/heat.jpg',
          vote_average: 7.9,
          media_type: 'movie',
        },
      ],
    };

    const [result] = await (await scraper()).searchVideo!('Heat', { videoType: 'movie' });

    expect(result).toEqual({
      externalId: 'movie-949',
      title: 'Heat',
      year: 1995,
      overview: 'A crew of thieves.',
      posterUrl: 'https://image.tmdb.org/t/p/w500/heat.jpg',
      videoType: 'movie',
      confidence: 0.79,
    });
  });

  it('maps a series result from its own fields', async () => {
    routes['/3/search/tv'] = {
      results: [{ id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20', media_type: 'tv' }],
    };

    const [result] = await (await scraper()).searchSeries!('Breaking Bad');

    expect(result).toMatchObject({ externalId: 'tv-1396', title: 'Breaking Bad', year: 2008 });
  });

  it('drops the people a multi search returns', async () => {
    routes['/3/search/multi'] = {
      results: [
        { id: 1, name: 'Al Pacino', media_type: 'person' },
        { id: 949, title: 'Heat', media_type: 'movie' },
      ],
    };

    const results = await (await scraper()).searchVideo!('Heat');

    expect(results.map((r) => r.externalId)).toEqual(['movie-949']);
  });

  it('asks for images at the configured size', async () => {
    routes['/3/search/movie'] = { results: [{ id: 949, title: 'Heat', poster_path: '/heat.jpg' }] };

    const [result] = await (await scraper({ imageSize: 'w780' })).searchVideo!('Heat', {
      videoType: 'movie',
    });

    expect(result.posterUrl).toBe('https://image.tmdb.org/t/p/w780/heat.jpg');
  });
});

describe('a film', () => {
  beforeEach(() => {
    routes['/3/movie/949'] = {
      id: 949,
      title: 'Heat',
      original_title: 'Heat',
      overview: 'A crew of thieves.',
      release_date: '1995-12-15',
      runtime: 170,
      vote_average: 7.9,
      genres: [{ id: 80, name: 'Crime' }],
      poster_path: '/heat.jpg',
      backdrop_path: '/heat-backdrop.jpg',
      keywords: { keywords: [{ id: 1, name: 'heist' }] },
      release_dates: {
        results: [
          { iso_3166_1: 'GB', release_dates: [{ certification: '15' }] },
          { iso_3166_1: 'US', release_dates: [{ certification: '' }, { certification: 'R' }] },
        ],
      },
      credits: {
        cast: [{ id: 1158, name: 'Al Pacino', character: 'Hanna', order: 0, profile_path: '/ap.jpg' }],
        crew: [
          { id: 4, name: 'Michael Mann', job: 'Director', profile_path: '/mm.jpg' },
          { id: 5, name: 'Someone', job: 'Best Boy' },
        ],
      },
    };
    routes['/3/movie/949/images'] = { backdrops: [], logos: [] };
  });

  it('maps the details', async () => {
    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata).toMatchObject({
      externalId: 'movie-949',
      title: 'Heat',
      description: 'A crew of thieves.',
      releaseDate: new Date('1995-12-15'),
      runtime: 170,
      voteAverage: 7.9,
      genres: ['Crime'],
      keywords: ['heist'],
    });
  });

  it('takes the certificate from the US release, skipping the blank one', async () => {
    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.rating).toBe('R');
  });

  it('leaves out an original title that is the same as the title', async () => {
    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.originalTitle).toBeUndefined();
  });

  it('keeps an original title that differs', async () => {
    (routes['/3/movie/949'] as { original_title: string }).original_title = 'Chaleur';

    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.originalTitle).toBe('Chaleur');
  });

  it('takes the top cast and the crew jobs it cares about', async () => {
    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.credits).toEqual([
      {
        name: 'Al Pacino',
        role: 'Hanna',
        type: 'actor',
        order: 0,
        photoUrl: 'https://image.tmdb.org/t/p/w185/ap.jpg',
        tmdbId: 1158,
      },
      {
        name: 'Michael Mann',
        role: 'Director',
        type: 'director',
        photoUrl: 'https://image.tmdb.org/t/p/w185/mm.jpg',
        tmdbId: 4,
      },
    ]);
  });

  it('keeps only the first twenty of a long cast', async () => {
    (routes['/3/movie/949'] as { credits: { cast: unknown[] } }).credits.cast = Array.from(
      { length: 30 },
      (_, i) => ({ id: i, name: `Actor ${i}`, character: 'Someone', order: i })
    );

    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.credits!.filter((c) => c.type === 'actor')).toHaveLength(20);
  });

  // The catch in getVideoMetadata returns null, but the movie and tv branches
  // return the promise instead of awaiting it, so a TMDB error is thrown past
  // it. The worker turns that into a retryable Failed rather than a miss, so
  // this is pinned as it stands rather than quietly changed.
  it('lets a TMDB error escape rather than reporting a miss', async () => {
    await expect((await scraper()).getVideoMetadata!('movie-404')).rejects.toThrow(
      'TMDB API error: 404'
    );
  });

  it('does report a miss for an id shaped for another provider', async () => {
    expect(await (await scraper()).getVideoMetadata!('imdb-tt0113277')).toBeNull();
  });
});

describe('artwork selection', () => {
  beforeEach(() => {
    routes['/3/movie/949'] = {
      id: 949,
      title: 'Heat',
      genres: [],
      backdrop_path: '/fallback.jpg',
    };
  });

  it('takes the best rated backdrop overall, and the best English one for the thumbnail', async () => {
    routes['/3/movie/949/images'] = {
      backdrops: [
        { file_path: '/best-fr.jpg', vote_average: 9, iso_639_1: 'fr' },
        { file_path: '/good-en.jpg', vote_average: 7, iso_639_1: 'en' },
      ],
      logos: [],
    };

    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.backdropUrl).toBe('https://image.tmdb.org/t/p/original/best-fr.jpg');
    expect(metadata!.thumbnailUrl).toBe('https://image.tmdb.org/t/p/original/good-en.jpg');
  });

  it('settles for the best overall when none is English', async () => {
    routes['/3/movie/949/images'] = {
      backdrops: [{ file_path: '/only.jpg', vote_average: 5, iso_639_1: 'de' }],
      logos: [],
    };

    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.thumbnailUrl).toBe('https://image.tmdb.org/t/p/original/only.jpg');
  });

  it('prefers an English logo over a better rated one', async () => {
    routes['/3/movie/949/images'] = {
      backdrops: [],
      logos: [
        { file_path: '/logo-ja.png', vote_average: 9, iso_639_1: 'ja' },
        { file_path: '/logo-en.png', vote_average: 3, iso_639_1: 'en' },
      ],
    };

    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.logoUrl).toBe('https://image.tmdb.org/t/p/original/logo-en.png');
  });

  it('falls back to the backdrop on the record when the images call is empty', async () => {
    routes['/3/movie/949/images'] = { backdrops: [], logos: [] };

    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.backdropUrl).toBe('https://image.tmdb.org/t/p/original/fallback.jpg');
  });

  it('falls back the same way when the images call fails outright', async () => {
    const metadata = await (await scraper()).getVideoMetadata!('movie-949');

    expect(metadata!.backdropUrl).toBe('https://image.tmdb.org/t/p/original/fallback.jpg');
    expect(metadata!.logoUrl).toBeUndefined();
  });
});

describe('a series', () => {
  beforeEach(() => {
    routes['/3/tv/1396'] = {
      id: 1396,
      name: 'Breaking Bad',
      original_name: 'Breaking Bad',
      overview: 'A teacher turns to crime.',
      first_air_date: '2008-01-20',
      last_air_date: '2013-09-29',
      status: 'Ended',
      vote_average: 8.9,
      number_of_seasons: 5,
      episode_run_time: [47],
      genres: [{ id: 18, name: 'Drama' }],
      keywords: { results: [{ id: 1, name: 'drug trade' }] },
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
      credits: { cast: [], crew: [] },
    };
    routes['/3/tv/1396/images'] = { backdrops: [], logos: [] };
  });

  it('maps the series, taking keywords from the field TV uses', async () => {
    const metadata = await (await scraper()).getSeriesMetadata!('tv-1396');

    expect(metadata).toMatchObject({
      externalId: 'tv-1396',
      title: 'Breaking Bad',
      firstAirDate: new Date('2008-01-20'),
      lastAirDate: new Date('2013-09-29'),
      status: 'Ended',
      rating: 8.9,
      seasonCount: 5,
      keywords: ['drug trade'],
    });
  });

  it('takes a bare id as well as a prefixed one', async () => {
    expect(await (await scraper()).getSeriesMetadata!('1396')).toMatchObject({ title: 'Breaking Bad' });
  });

  it('gives the US content rating as the certificate on the video form', async () => {
    const metadata = await (await scraper()).getVideoMetadata!('tv-1396');

    expect(metadata).toMatchObject({ rating: 'TV-MA', runtime: 47, showName: 'Breaking Bad' });
  });

  it('says nothing when the series is gone', async () => {
    expect(await (await scraper()).getSeriesMetadata!('tv-404')).toBeNull();
  });
});

describe('a season', () => {
  it('maps the season and drops a name that says nothing', async () => {
    routes['/3/tv/1396/season/1'] = {
      id: 3572,
      season_number: 1,
      name: 'Season 1',
      overview: 'The first season.',
      air_date: '2008-01-20',
      episode_count: 7,
      poster_path: '/s1.jpg',
    };

    const metadata = await (await scraper()).getSeasonMetadata!('tv-1396', 1);

    expect(metadata).toEqual({
      externalId: 'season-3572',
      seasonNumber: 1,
      name: undefined,
      description: 'The first season.',
      airDate: new Date('2008-01-20'),
      posterUrl: 'https://image.tmdb.org/t/p/w500/s1.jpg',
      episodeCount: 7,
    });
  });

  it('keeps a season name that means something', async () => {
    routes['/3/tv/1396/season/1'] = { id: 1, season_number: 1, name: 'The Beginning' };

    const metadata = await (await scraper()).getSeasonMetadata!('tv-1396', 1);

    expect(metadata!.name).toBe('The Beginning');
  });

  it('says nothing for a season that is not there', async () => {
    expect(await (await scraper()).getSeasonMetadata!('tv-1396', 99)).toBeNull();
  });
});

describe('an episode', () => {
  beforeEach(() => {
    routes['/3/tv/1396'] = { id: 1396, name: 'Breaking Bad', genres: [], episode_run_time: [] };
    routes['/3/tv/1396/season/1/episode/3'] = {
      id: 62087,
      name: 'Cat in the Bag...',
      overview: 'The bodies pile up.',
      air_date: '2008-02-10',
      runtime: 48,
      season_number: 1,
      episode_number: 3,
      still_path: '/still.jpg',
      credits: {
        cast: [{ id: 1, name: 'Bryan Cranston', character: 'Walter White', order: 0 }],
        guest_stars: [{ id: 2, name: 'Guest', character: 'Neighbour', order: 1 }],
        crew: [{ id: 3, name: 'Adam Bernstein', job: 'Director' }],
      },
    };
  });

  it('maps the episode and names the show it belongs to', async () => {
    const metadata = await (await scraper()).getEpisodeMetadata!('tv-1396', 1, 3);

    expect(metadata).toMatchObject({
      externalId: 'episode-62087',
      title: 'Cat in the Bag...',
      episodeTitle: 'Cat in the Bag...',
      season: 1,
      episode: 3,
      runtime: 48,
      showName: 'Breaking Bad',
      releaseDate: new Date('2008-02-10'),
    });
  });

  it('counts the guest stars among the cast', async () => {
    const metadata = await (await scraper()).getEpisodeMetadata!('tv-1396', 1, 3);

    expect(metadata!.credits!.map((c) => c.name)).toEqual([
      'Bryan Cranston',
      'Guest',
      'Adam Bernstein',
    ]);
  });

  it('says nothing for an episode that does not exist', async () => {
    expect(await (await scraper()).getEpisodeMetadata!('tv-1396', 9, 9)).toBeNull();
  });
});

describe('a person', () => {
  it('maps the person, keeping the IMDB id when there is one', async () => {
    routes['/3/person/1158'] = {
      id: 1158,
      name: 'Al Pacino',
      biography: 'An actor.',
      birthday: '1940-04-25',
      deathday: null,
      place_of_birth: 'New York',
      known_for_department: 'Acting',
      profile_path: '/ap.jpg',
      imdb_id: 'nm0000199',
    };

    const person = await (await scraper()).getPersonMetadata!('tmdb-1158');

    expect(person).toEqual({
      externalId: 'tmdb-1158',
      name: 'Al Pacino',
      biography: 'An actor.',
      birthDate: '1940-04-25',
      deathDate: undefined,
      birthPlace: 'New York',
      knownFor: 'Acting',
      photoUrl: 'https://image.tmdb.org/t/p/w500/ap.jpg',
      tmdbId: 1158,
      imdbId: 'nm0000199',
    });
  });

  it('says nothing for a person it cannot fetch', async () => {
    expect(await (await scraper()).getPersonMetadata!('tmdb-404')).toBeNull();
  });
});

describe('when TMDB misbehaves', () => {
  it('gives up on a client error rather than retrying', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as never);

    await expect((await scraper()).searchVideo!('Heat')).rejects.toThrow('TMDB API error: 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a server error, then gives up with the error', async () => {
    jest.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as never);
      const plugin = await scraper();
      const searching = plugin.searchVideo!('Heat');
      const settled = expect(searching).rejects.toThrow('TMDB API error: 503');

      await jest.advanceTimersByTimeAsync(10000);
      await settled;

      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries a rate limit as well', async () => {
    jest.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) } as never)
        .mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) } as never);
      const plugin = await scraper();
      const searching = plugin.searchVideo!('Heat');

      await jest.advanceTimersByTimeAsync(10000);

      expect(await searching).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
