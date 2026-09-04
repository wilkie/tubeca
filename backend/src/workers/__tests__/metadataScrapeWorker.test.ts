import { jest } from '@jest/globals';
import { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia } from '../../test/db';

const asyncMock = <T>() => jest.fn<(...args: unknown[]) => Promise<T>>();

type Processor = (job: unknown) => Promise<{ success: boolean; scraperId?: string; error?: string }>;
let processor: Processor;
let workerOptions: Record<string, unknown> = {};

jest.unstable_mockModule('bullmq', () => ({
  Worker: class {
    constructor(_name: string, fn: Processor, options: Record<string, unknown>) {
      processor = fn;
      workerOptions = options;
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

/** One scraper, whose every call the test decides. */
const scraper = {
  id: 'tmdb',
  isConfigured: () => true,
  searchVideo: asyncMock<unknown[]>(),
  getVideoMetadata: asyncMock<unknown>(),
  searchSeries: asyncMock<unknown[]>(),
  getEpisodeMetadata: asyncMock<unknown>(),
  searchAudio: asyncMock<unknown[]>(),
  getAudioMetadata: asyncMock<unknown>(),
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

// The provider cache is memoised for ten minutes at module level, which would
// let one test's answer stand in for the next one's. It has its own tests.
jest.unstable_mockModule('../../services/scrapeCache', () => ({
  cachedCall: <T>(_key: string, call: () => Promise<T>) => call(),
  scrapeCacheKey: (...parts: unknown[]) => parts.join(':'),
}));

const indexMedia = asyncMock<void>();
jest.unstable_mockModule('../../services/searchIndexService', () => ({
  searchIndexService: { indexMedia },
}));

await import('../metadataScrapeWorker');

const found = (externalId: string, title: string, year?: number) => [{ externalId, title, year }];

let mediaId: string;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
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
  indexMedia.mockResolvedValue(undefined);
  scraper.searchVideo.mockResolvedValue([]);
  scraper.searchSeries.mockResolvedValue([]);
  scraper.searchAudio.mockResolvedValue([]);
  scraper.getVideoMetadata.mockResolvedValue(null);
  scraper.getEpisodeMetadata.mockResolvedValue(null);
  scraper.getAudioMetadata.mockResolvedValue(null);

  const library = await createLibrary({ libraryType: 'Film' });
  const collection = await createCollection({ libraryId: library.id, name: 'Heat (1995)' });
  mediaId = (
    await createVideoMedia({ name: 'Heat (1995)', path: '/films/heat.mkv', duration: 170, collectionId: collection.id })
  ).id;
});

const job = (data: Record<string, unknown>) => ({ id: 'job-1', data });

const videoJob = (data: Record<string, unknown> = {}) =>
  job({ mediaId, mediaName: 'Heat (1995)', mediaType: 'Video', ...data });

const mediaRow = () => prisma.media.findUniqueOrThrow({ where: { id: mediaId } });

describe('the metadata scrape worker', () => {
  it('takes one job at a time, at a rate the providers tolerate', () => {
    expect(workerOptions.concurrency).toBe(1);
    expect(workerOptions.limiter).toEqual({ max: 10, duration: 10000 });
  });

  it('shrugs off a job for media that has since been deleted', async () => {
    const result = await processor(videoJob({ mediaId: 'gone' }));

    expect(result).toEqual({ success: false, error: 'Media not found' });
    expect(scraper.searchVideo).not.toHaveBeenCalled();
  });

  describe('a film', () => {
    beforeEach(() => {
      scraper.searchVideo.mockResolvedValue(found('tmdb-949', 'Heat', 1995));
      scraper.getVideoMetadata.mockResolvedValue({
        title: 'Heat',
        description: 'A crew of thieves.',
        releaseDate: new Date('1995-12-15'),
        // `rating` is the certificate, not the score; the score is `voteAverage`.
        rating: 'R',
      });
    });

    it('searches on the title and year read out of the name', async () => {
      await processor(videoJob());

      expect(scraper.searchVideo).toHaveBeenCalledWith('Heat', { year: 1995 });
    });

    it('prefers a year the job carries over the one in the name', async () => {
      await processor(videoJob({ year: 1996 }));

      expect(scraper.searchVideo).toHaveBeenCalledWith('Heat', { year: 1996 });
    });

    it('writes what it found and records the match', async () => {
      const result = await processor(videoJob());

      expect(result).toEqual({ success: true, scraperId: 'tmdb', externalId: 'tmdb-949' });
      expect(await prisma.videoDetails.findUniqueOrThrow({ where: { mediaId } })).toMatchObject({
        description: 'A crew of thieves.',
        rating: 'R',
      });
      expect(await mediaRow()).toMatchObject({ scrapeStatus: 'Matched', scrapeMessage: null });
    });

    it('marks the media as pending while it works', async () => {
      let statusDuringSearch: string | null | undefined;
      scraper.searchVideo.mockImplementation(async () => {
        statusDuringSearch = (await mediaRow()).scrapeStatus;
        return found('tmdb-949', 'Heat', 1995);
      });

      await processor(videoJob());

      expect(statusDuringSearch).toBe('Pending');
    });

    it('puts the artwork and the search index in order afterwards', async () => {
      await processor(videoJob());

      expect(downloadArtwork).toHaveBeenCalledWith(
        { mediaId },
        expect.objectContaining({ title: 'Heat' }),
        'tmdb',
        { reuseExisting: true }
      );
      expect(indexMedia).toHaveBeenCalledWith(mediaId);
    });

    it('leaves the artwork alone when it is already there', async () => {
      shouldDownloadArtwork.mockResolvedValue(false);

      await processor(videoJob());

      expect(downloadArtwork).not.toHaveBeenCalled();
    });

    it('is told to skip images when the job says so', async () => {
      await processor(videoJob({ skipImages: true }));

      expect(shouldDownloadArtwork).toHaveBeenCalledWith({ mediaId }, true);
    });

    it('touches nothing but the images for an images-only job', async () => {
      await processor(videoJob({ imagesOnly: true }));

      expect(downloadArtwork).toHaveBeenCalledWith({ mediaId }, expect.anything(), 'tmdb');
      expect(await prisma.videoDetails.findUnique({ where: { mediaId } })).toBeNull();
    });

    it('applies the cast it was given', async () => {
      scraper.getVideoMetadata.mockResolvedValue({
        title: 'Heat',
        credits: [{ name: 'Al Pacino', creditType: 'Actor', character: 'Hanna' }],
      });

      await processor(videoJob());

      expect(applyCredits).toHaveBeenCalledWith(
        expect.objectContaining({ scraperId: 'tmdb', downloadPhotos: true })
      );
    });

    it('goes straight to the id when the item has already been identified', async () => {
      await processor(videoJob({ scraperId: 'tmdb', externalId: 'tmdb-949' }));

      expect(scraper.getVideoMetadata).toHaveBeenCalledWith('tmdb-949');
      expect(scraper.searchVideo).not.toHaveBeenCalled();
    });

    it('does not retry a provider error that is not worth retrying', async () => {
      scraper.searchVideo.mockRejectedValue(new Error('API error: 401 Unauthorized'));

      const result = await processor(videoJob());

      expect(result).toMatchObject({ success: false });
      expect(await mediaRow()).toMatchObject({ scrapeStatus: 'Failed' });
    });

    it('reports a search that matched nothing without failing the job', async () => {
      scraper.searchVideo.mockResolvedValue(found('tmdb-1', 'Something Else', 1980));

      const result = await processor(videoJob());

      expect(result.success).toBe(false);
      expect(await mediaRow()).toMatchObject({ scrapeStatus: 'NoMatch' });
    });

    it('has nothing to do when no scraper is configured', async () => {
      scraperManager.getByMediaType.mockReturnValue([]);

      const result = await processor(videoJob());

      expect(result).toEqual({ success: false, error: 'No video scrapers configured' });
      expect(await mediaRow()).toMatchObject({
        scrapeStatus: 'NoMatch',
        scrapeMessage: 'No video scrapers configured',
      });
    });

    it('fails the job so BullMQ retries when the provider is unreachable', async () => {
      scraper.searchVideo.mockRejectedValue(new Error('fetch failed'));

      await expect(processor(videoJob())).rejects.toThrow('fetch failed');
      expect(await mediaRow()).toMatchObject({ scrapeStatus: 'Failed' });
    });

    it('records the failure when applying what it found goes wrong', async () => {
      downloadArtwork.mockRejectedValue(new Error('disk full'));

      await expect(processor(videoJob())).rejects.toThrow('disk full');
      expect(await mediaRow()).toMatchObject({
        scrapeStatus: 'Failed',
        scrapeMessage: 'disk full',
      });
    });
  });

  describe('an episode', () => {
    const episodeJob = (data: Record<string, unknown> = {}) =>
      videoJob({ mediaName: 'Breaking Bad S01E03', season: 1, episode: 3, ...data });

    beforeEach(() => {
      scraper.searchSeries.mockResolvedValue(found('tmdb-1396', 'Breaking Bad'));
      scraper.getEpisodeMetadata.mockResolvedValue({
        episodeTitle: 'Cat in the Bag...',
        season: 1,
        episode: 3,
        description: 'The bodies pile up.',
      });
    });

    it('searches for the show the job names, then asks for the episode', async () => {
      await processor(episodeJob({ showName: 'Breaking Bad' }));

      expect(scraper.searchSeries).toHaveBeenCalledWith('Breaking Bad');
      expect(scraper.getEpisodeMetadata).toHaveBeenCalledWith('tmdb-1396', 1, 3);
    });

    it('reads the show name out of the file name when the job has none', async () => {
      await processor(episodeJob());

      expect(scraper.searchSeries).toHaveBeenCalledWith('Breaking Bad');
    });

    it('renames the media to the episode title', async () => {
      await processor(episodeJob({ showName: 'Breaking Bad' }));

      expect(await mediaRow()).toMatchObject({ name: 'Cat in the Bag...' });
    });

    it('goes through the show it was identified as, without searching again', async () => {
      await processor(
        episodeJob({ scraperId: 'tmdb', showExternalId: 'tmdb-1396', showName: 'Breaking Bad' })
      );

      expect(scraper.searchSeries).not.toHaveBeenCalled();
      expect(scraper.getEpisodeMetadata).toHaveBeenCalledWith('tmdb-1396', 1, 3);
    });
  });

  describe('audio', () => {
    const audioJob = () => job({ mediaId, mediaName: 'Blue in Green', mediaType: 'Audio' });

    it('writes the track details and takes the title as the name', async () => {
      scraper.searchAudio.mockResolvedValue(found('mb-1', 'Blue in Green'));
      scraper.getAudioMetadata.mockResolvedValue({
        title: 'Blue in Green',
        artist: 'Miles Davis',
        album: 'Kind of Blue',
        track: 3,
      });

      const result = await processor(audioJob());

      expect(result.success).toBe(true);
      expect(await prisma.audioDetails.findUniqueOrThrow({ where: { mediaId } })).toMatchObject({
        artist: 'Miles Davis',
        album: 'Kind of Blue',
        track: 3,
      });
      expect(await mediaRow()).toMatchObject({ name: 'Blue in Green' });
    });

    it('has nothing to do when no audio scraper is configured', async () => {
      scraperManager.getByMediaType.mockReturnValue([]);

      expect(await processor(audioJob())).toEqual({
        success: false,
        error: 'No audio scrapers configured',
      });
    });
  });
});
