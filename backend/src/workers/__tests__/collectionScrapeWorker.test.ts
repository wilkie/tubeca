import { jest } from '@jest/globals';
import { prisma, resetDatabase, createLibrary, createCollection } from '../../test/db';

const asyncMock = <T>() => jest.fn<(...args: unknown[]) => Promise<T>>();

type Processor = (job: unknown) => Promise<{ success: boolean; scraperId?: string; error?: string }>;
let processor: Processor;

jest.unstable_mockModule('bullmq', () => ({
  Worker: class {
    constructor(_name: string, fn: Processor) {
      processor = fn;
    }
    on() {
      return this;
    }
  },
  Queue: class {
    on() {
      return this;
    }
  },
}));
jest.unstable_mockModule('../../config/redis', () => ({ redisConnection: {} }));

const scraper = {
  id: 'tmdb',
  name: 'TMDB',
  isConfigured: () => true,
  searchSeries: asyncMock<unknown[]>(),
  getSeriesMetadata: asyncMock<unknown>(),
  getSeasonMetadata: asyncMock<unknown>(),
  searchVideo: asyncMock<unknown[]>(),
  getVideoMetadata: asyncMock<unknown>(),
};
const scraperManager = {
  get: jest.fn(() => scraper as unknown),
  getByMediaType: jest.fn(() => [scraper] as unknown[]),
};
jest.unstable_mockModule('../../plugins/scraperLoader', () => ({ scraperManager }));

const downloadArtwork = asyncMock<void>();
const shouldDownloadArtwork = asyncMock<boolean>();
const applyCredits = asyncMock<void>();
jest.unstable_mockModule('../../services/scrapeApply', () => ({
  downloadArtwork,
  shouldDownloadArtwork,
  applyCredits,
  mapCreditType: (type: string) => type,
}));

const queueSeasonScrapes = asyncMock<number>();
const queueEpisodeScrapes = asyncMock<number>();
jest.unstable_mockModule('../../services/scrapeCascade', () => ({
  queueSeasonScrapes,
  queueEpisodeScrapes,
  seasonNumberFromName: () => undefined,
}));

// Answers are memoised for ten minutes at module level, which would let one
// test's answer stand in for the next one's. The cache has its own tests.
jest.unstable_mockModule('../../services/scrapeCache', () => ({
  cachedCall: <T>(_key: string, call: () => Promise<T>) => call(),
  scrapeCacheKey: (...parts: unknown[]) => parts.join(':'),
}));

const indexCollection = asyncMock<void>();
jest.unstable_mockModule('../../services/searchIndexService', () => ({
  searchIndexService: { indexCollection },
}));

await import('../collectionScrapeWorker');

const found = (externalId: string, title: string, year?: number) => [{ externalId, title, year }];

let libraryId: string;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(async () => {
  await resetDatabase();
  jest.clearAllMocks();
  scraperManager.get.mockReturnValue(scraper);
  scraperManager.getByMediaType.mockReturnValue([scraper]);
  shouldDownloadArtwork.mockResolvedValue(true);
  downloadArtwork.mockResolvedValue(undefined);
  applyCredits.mockResolvedValue(undefined);
  indexCollection.mockResolvedValue(undefined);
  queueSeasonScrapes.mockResolvedValue(0);
  queueEpisodeScrapes.mockResolvedValue(0);
  scraper.searchSeries.mockResolvedValue([]);
  scraper.searchVideo.mockResolvedValue([]);
  scraper.getSeriesMetadata.mockResolvedValue(null);
  scraper.getSeasonMetadata.mockResolvedValue(null);
  scraper.getVideoMetadata.mockResolvedValue(null);
  libraryId = (await createLibrary({ libraryType: 'Television' })).id;
});

const job = (data: Record<string, unknown>) => ({ id: 'job-1', data });

const collectionRow = (id: string) => prisma.collection.findUniqueOrThrow({ where: { id } });

describe('the collection scrape worker', () => {
  it('shrugs off a job for a collection that has since been deleted', async () => {
    const result = await processor(
      job({ collectionId: 'gone', collectionName: 'Show', collectionType: 'Show' })
    );

    expect(result).toEqual({ success: false, error: 'Collection not found' });
    expect(scraper.searchSeries).not.toHaveBeenCalled();
  });

  it('has nothing to do with a kind of collection it does not scrape', async () => {
    const generic = await createCollection({ libraryId, name: 'Extras', collectionType: 'Generic' });

    const result = await processor(
      job({ collectionId: generic.id, collectionName: 'Extras', collectionType: 'Generic' })
    );

    expect(result).toEqual({ success: false, error: 'Unsupported collection type: Generic' });
    expect(await collectionRow(generic.id)).toMatchObject({ scrapeStatus: 'NoMatch' });
  });

  it('says music is not implemented rather than pretending to scrape it', async () => {
    const artist = await createCollection({ libraryId, name: 'Miles Davis', collectionType: 'Artist' });

    expect(
      await processor(job({ collectionId: artist.id, collectionName: 'Miles Davis', collectionType: 'Artist' }))
    ).toEqual({ success: false, error: 'Artist scraping not yet implemented' });
  });

  describe('a show', () => {
    let showId: string;
    const showJob = (data: Record<string, unknown> = {}) =>
      job({ collectionId: showId, collectionName: 'Breaking Bad (2008)', collectionType: 'Show', ...data });

    beforeEach(async () => {
      showId = (
        await createCollection({ libraryId, name: 'Breaking Bad (2008)', collectionType: 'Show' })
      ).id;
      scraper.searchSeries.mockResolvedValue(found('tmdb-1396', 'Breaking Bad', 2008));
      scraper.getSeriesMetadata.mockResolvedValue({
        externalId: 'tmdb-1396',
        title: 'Breaking Bad',
        description: 'A teacher turns to crime.',
        firstAirDate: new Date('2008-01-20'),
        status: 'Ended',
        genres: ['Drama', 'Crime'],
      });
    });

    it('searches on the title without the year in brackets', async () => {
      await processor(showJob());

      expect(scraper.searchSeries).toHaveBeenCalledWith('Breaking Bad');
    });

    it('writes the show details and records the match', async () => {
      const result = await processor(showJob());

      expect(result).toEqual({ success: true, scraperId: 'tmdb', externalId: 'tmdb-1396' });
      expect(await prisma.showDetails.findUniqueOrThrow({ where: { collectionId: showId } })).toMatchObject({
        scraperId: 'tmdb',
        externalId: 'tmdb-1396',
        description: 'A teacher turns to crime.',
        status: 'Ended',
        genres: 'Drama, Crime',
      });
      expect(await collectionRow(showId)).toMatchObject({ scrapeStatus: 'Matched' });
    });

    it('saves the keywords it was given, folded to lower case', async () => {
      scraper.getSeriesMetadata.mockResolvedValue({
        externalId: 'tmdb-1396',
        title: 'Breaking Bad',
        keywords: ['Drug Trade', ' Albuquerque '],
      });

      await processor(showJob());

      const withKeywords = await prisma.collection.findUniqueOrThrow({
        where: { id: showId },
        include: { keywords: true },
      });
      expect(withKeywords.keywords.map((k) => k.name).sort()).toEqual(['albuquerque', 'drug trade']);
    });

    it('keeps the sort fields and the search index in step', async () => {
      await processor(showJob());

      expect(indexCollection).toHaveBeenCalledWith(showId);
      expect(await collectionRow(showId)).toMatchObject({ sortReleaseDate: new Date('2008-01-20') });
    });

    it('queues the seasons once it knows the show id', async () => {
      await processor(showJob({ cascade: 'seasons' }));

      expect(queueSeasonScrapes).toHaveBeenCalledWith(
        showId,
        { scraperId: 'tmdb', externalId: 'tmdb-1396' },
        { skipImages: undefined, imagesOnly: undefined, cascade: 'seasons' }
      );
    });

    it('queues no seasons for a job that did not ask for a cascade', async () => {
      await processor(showJob());

      expect(queueSeasonScrapes).not.toHaveBeenCalled();
    });

    it('queues no seasons when it never found the show', async () => {
      scraper.searchSeries.mockResolvedValue([]);

      await processor(showJob({ cascade: 'seasons' }));

      expect(queueSeasonScrapes).not.toHaveBeenCalled();
    });

    it('passes over a scraper that can find a show but not fetch it', async () => {
      const partial = {
        id: 'partial',
        isConfigured: () => true,
        searchSeries: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
      };
      partial.searchSeries.mockResolvedValue(found('p-1', 'Breaking Bad', 2008));
      scraperManager.getByMediaType.mockReturnValue([partial, scraper]);

      const result = await processor(showJob());

      expect(partial.searchSeries).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, scraperId: 'tmdb' });
    });

    it('goes straight to the id once the show has been identified', async () => {
      await processor(showJob({ scraperId: 'tmdb', externalId: 'tmdb-1396' }));

      expect(scraper.getSeriesMetadata).toHaveBeenCalledWith('tmdb-1396');
      expect(scraper.searchSeries).not.toHaveBeenCalled();
    });

    it('touches nothing but the images for an images-only job', async () => {
      await processor(showJob({ scraperId: 'tmdb', externalId: 'tmdb-1396', imagesOnly: true }));

      expect(downloadArtwork).toHaveBeenCalledWith({ collectionId: showId }, expect.anything(), 'tmdb', {
        label: 'show collection',
      });
      expect(await prisma.showDetails.findUnique({ where: { collectionId: showId } })).toBeNull();
    });

    it('records a miss without failing the job', async () => {
      scraper.searchSeries.mockResolvedValue(found('tmdb-1', 'Something Else'));

      const result = await processor(showJob());

      expect(result.success).toBe(false);
      expect(await collectionRow(showId)).toMatchObject({ scrapeStatus: 'NoMatch' });
    });

    it('fails the job so BullMQ retries when the provider is unreachable', async () => {
      scraper.searchSeries.mockRejectedValue(new Error('fetch failed'));

      await expect(processor(showJob())).rejects.toThrow('fetch failed');
      expect(await collectionRow(showId)).toMatchObject({ scrapeStatus: 'Failed' });
    });
  });

  describe('a season', () => {
    let showId: string;
    let seasonId: string;
    const seasonJob = (data: Record<string, unknown> = {}) =>
      job({
        collectionId: seasonId,
        collectionName: 'Season 1',
        collectionType: 'Season',
        seasonNumber: 1,
        ...data,
      });

    beforeEach(async () => {
      showId = (await createCollection({ libraryId, name: 'Breaking Bad', collectionType: 'Show' })).id;
      seasonId = (
        await createCollection({ libraryId, name: 'Season 1', collectionType: 'Season', parentId: showId })
      ).id;
      scraper.getSeasonMetadata.mockResolvedValue({
        externalId: 'tmdb-1396-1',
        seasonNumber: 1,
        description: 'The first season.',
        airDate: new Date('2008-01-20'),
      });
    });

    it('asks for the season by the show id the job carries', async () => {
      const result = await processor(
        seasonJob({ parentScraperId: 'tmdb', parentExternalId: 'tmdb-1396' })
      );

      expect(scraper.getSeasonMetadata).toHaveBeenCalledWith('tmdb-1396', 1);
      expect(result).toEqual({ success: true, scraperId: 'tmdb', externalId: 'tmdb-1396-1' });
      expect(await prisma.seasonDetails.findUniqueOrThrow({ where: { collectionId: seasonId } })).toMatchObject({
        seasonNumber: 1,
        description: 'The first season.',
      });
    });

    it('falls back to the identity stored on the parent show', async () => {
      await prisma.showDetails.create({
        data: { collectionId: showId, scraperId: 'tmdb', externalId: 'tmdb-1396' },
      });

      await processor(seasonJob({ parentShowId: showId }));

      expect(scraper.getSeasonMetadata).toHaveBeenCalledWith('tmdb-1396', 1);
    });

    it('gives up when the show has no identity anywhere', async () => {
      const result = await processor(seasonJob({ parentShowId: showId }));

      expect(result).toEqual({ success: false, error: 'Missing parent show info for season scrape' });
      expect(scraper.getSeasonMetadata).not.toHaveBeenCalled();
    });

    it('gives up when the job carries no season number', async () => {
      const result = await processor(
        seasonJob({ parentScraperId: 'tmdb', parentExternalId: 'tmdb-1396', seasonNumber: undefined })
      );

      expect(result).toEqual({ success: false, error: 'Missing parent show info for season scrape' });
    });

    it('gives up when the scraper cannot fetch seasons', async () => {
      scraperManager.get.mockReturnValue({ ...scraper, getSeasonMetadata: undefined });

      const result = await processor(
        seasonJob({ parentScraperId: 'tvdb', parentExternalId: 'tvdb-1396' })
      );

      expect(result).toEqual({ success: false, error: 'Scraper does not support season metadata' });
    });

    it('queues the episodes when the job asks for the whole cascade', async () => {
      await processor(
        seasonJob({ parentScraperId: 'tmdb', parentExternalId: 'tmdb-1396', cascade: 'all' })
      );

      expect(queueEpisodeScrapes).toHaveBeenCalledWith(
        seasonId,
        { scraperId: 'tmdb', externalId: 'tmdb-1396' },
        1,
        { skipImages: undefined, imagesOnly: undefined }
      );
    });

    it('queues no episodes for a seasons-only cascade', async () => {
      await processor(
        seasonJob({ parentScraperId: 'tmdb', parentExternalId: 'tmdb-1396', cascade: 'seasons' })
      );

      expect(queueEpisodeScrapes).not.toHaveBeenCalled();
    });

    it('treats a provider error as a miss rather than a retry', async () => {
      scraper.getSeasonMetadata.mockRejectedValue(new Error('fetch failed'));

      const result = await processor(
        seasonJob({ parentScraperId: 'tmdb', parentExternalId: 'tmdb-1396' })
      );

      expect(result).toEqual({ success: false, error: 'No season metadata found' });
      expect(await collectionRow(seasonId)).toMatchObject({ scrapeStatus: 'NoMatch' });
    });
  });

  describe('a film', () => {
    let filmId: string;
    const filmJob = (data: Record<string, unknown> = {}) =>
      job({ collectionId: filmId, collectionName: 'Heat (1995)', collectionType: 'Film', ...data });

    beforeEach(async () => {
      filmId = (await createCollection({ libraryId, name: 'Heat (1995)', collectionType: 'Film' })).id;
      scraper.searchVideo.mockResolvedValue(found('tmdb-949', 'Heat', 1995));
      scraper.getVideoMetadata.mockResolvedValue({
        externalId: 'tmdb-949',
        title: 'Heat',
        description: 'A crew of thieves.',
        releaseDate: new Date('1995-12-15'),
        runtime: 170,
        rating: 'R',
        voteAverage: 8.3,
        originalTitle: 'Heat',
      });
    });

    it('searches for a film, not a series', async () => {
      await processor(filmJob());

      expect(scraper.searchVideo).toHaveBeenCalledWith('Heat', { year: 1995, videoType: 'movie' });
    });

    it('prefers a year the job carries over the one in the folder name', async () => {
      await processor(filmJob({ year: 1996 }));

      expect(scraper.searchVideo).toHaveBeenCalledWith('Heat', { year: 1996, videoType: 'movie' });
    });

    it('keeps the certificate and the score apart', async () => {
      await processor(filmJob());

      expect(await prisma.filmDetails.findUniqueOrThrow({ where: { collectionId: filmId } })).toMatchObject({
        contentRating: 'R',
        rating: 8.3,
        runtime: 170,
        originalTitle: 'Heat',
      });
    });

    it('fills in the sort fields from what it wrote', async () => {
      await processor(filmJob());

      expect(await collectionRow(filmId)).toMatchObject({
        sortRating: 8.3,
        sortRuntime: 170,
        sortReleaseDate: new Date('1995-12-15'),
      });
    });

    it('applies the cast', async () => {
      scraper.getVideoMetadata.mockResolvedValue({
        externalId: 'tmdb-949',
        title: 'Heat',
        credits: [{ name: 'Al Pacino', creditType: 'Actor' }],
      });

      await processor(filmJob());

      expect(applyCredits).toHaveBeenCalledWith(
        expect.objectContaining({ scraperId: 'tmdb', downloadPhotos: true })
      );
    });

    it('asks for no photos when the job skips images', async () => {
      await processor(filmJob({ skipImages: true }));

      expect(shouldDownloadArtwork).toHaveBeenCalledWith({ collectionId: filmId }, true);
      expect(applyCredits).toHaveBeenCalledWith(expect.objectContaining({ downloadPhotos: false }));
    });

    it('has nothing to do when no scraper is configured', async () => {
      scraperManager.getByMediaType.mockReturnValue([]);

      expect(await processor(filmJob())).toEqual({
        success: false,
        error: 'No video scrapers configured',
      });
    });
  });
});
