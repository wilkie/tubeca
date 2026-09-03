import { jest } from '@jest/globals';
import { queueEpisodeScrapes, queueSeasonScrapes, seasonNumberFromName } from '../scrapeCascade';
import { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia } from '../../test/db';
import type { CollectionScrapeJobData } from '../../queues/collectionScrapePlan';
import type { MetadataScrapeJobData } from '../../queues/metadataScrapeQueue';

const identity = { scraperId: 'tmdb', externalId: '1396' };

describe('seasonNumberFromName', () => {
  it.each([
    ['Season 1', 1],
    ['season 12', 12],
    ['Season03', 3],
    ['Specials', 0],
    ['Extras', undefined],
  ])('reads %s as %s', (name, expected) => {
    expect(seasonNumberFromName(name)).toBe(expected);
  });
});

describe('queueSeasonScrapes', () => {
  let showId: string;
  let queued: CollectionScrapeJobData[];
  let queueCollectionScrapes: (jobs: CollectionScrapeJobData[]) => Promise<unknown>;

  beforeEach(async () => {
    await resetDatabase();
    queued = [];
    queueCollectionScrapes = jest.fn(async (jobs: CollectionScrapeJobData[]) => {
      queued = jobs;
      return [];
    });

    const library = await createLibrary({ name: 'TV', libraryType: 'Television' });
    const show = await createCollection({ libraryId: library.id, name: 'Breaking Bad', collectionType: 'Show' });
    showId = show.id;
  });

  async function addSeason(name: string, seasonNumber?: number) {
    const season = await prisma.collection.create({
      data: {
        libraryId: (await prisma.collection.findUniqueOrThrow({ where: { id: showId } })).libraryId,
        name,
        collectionType: 'Season',
        parentId: showId,
        seasonDetails: seasonNumber === undefined ? undefined : { create: { seasonNumber } },
      },
    });
    return season;
  }

  it('queues every season with the show identity', async () => {
    await addSeason('Season 1', 1);
    await addSeason('Season 2', 2);

    const count = await queueSeasonScrapes(showId, identity, {}, { queueCollectionScrapes });

    expect(count).toBe(2);
    expect(queued).toHaveLength(2);
    expect(queued[0]).toMatchObject({
      collectionType: 'Season',
      parentShowId: showId,
      parentExternalId: '1396',
      parentScraperId: 'tmdb',
    });
    expect(queued.map((j) => j.seasonNumber).sort()).toEqual([1, 2]);
  });

  it('falls back to the folder name when the season has no details row', async () => {
    await addSeason('Season 4');

    await queueSeasonScrapes(showId, identity, {}, { queueCollectionScrapes });

    expect(queued[0].seasonNumber).toBe(4);
  });

  it('skips a folder with no season number in it', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      await addSeason('Bonus Features');

      const count = await queueSeasonScrapes(showId, identity, {}, { queueCollectionScrapes });

      expect(count).toBe(0);
      expect(queueCollectionScrapes).not.toHaveBeenCalled();
    } finally {
      console.warn = warn;
    }
  });

  it('passes the scrape options and cascade depth on', async () => {
    await addSeason('Season 1', 1);

    await queueSeasonScrapes(showId, identity, { skipImages: true, cascade: 'all' }, { queueCollectionScrapes });

    expect(queued[0]).toMatchObject({ skipImages: true, cascade: 'all' });
  });

  it('does nothing for a show with no seasons', async () => {
    const count = await queueSeasonScrapes(showId, identity, {}, { queueCollectionScrapes });

    expect(count).toBe(0);
    expect(queueCollectionScrapes).not.toHaveBeenCalled();
  });
});

describe('queueEpisodeScrapes', () => {
  let seasonId: string;
  let queued: MetadataScrapeJobData[];
  let queueMediaScrapes: (jobs: MetadataScrapeJobData[]) => Promise<unknown>;

  beforeEach(async () => {
    await resetDatabase();
    queued = [];
    queueMediaScrapes = jest.fn(async (jobs: MetadataScrapeJobData[]) => {
      queued = jobs;
      return [];
    });

    const library = await createLibrary({ name: 'TV', libraryType: 'Television' });
    const show = await createCollection({ libraryId: library.id, name: 'Breaking Bad', collectionType: 'Show' });
    const season = await createCollection({
      libraryId: library.id,
      name: 'Season 1',
      collectionType: 'Season',
      parentId: show.id,
    });
    seasonId = season.id;
  });

  it('queues each episode with the show identity and the parent show name', async () => {
    await createVideoMedia({
      name: 'Pilot',
      path: '/tv/Breaking Bad/Season 1/Breaking Bad - S01E01 - Pilot.mkv',
      duration: 3000,
      collectionId: seasonId,
    });

    const count = await queueEpisodeScrapes(seasonId, identity, 1, {}, { queueMediaScrapes });

    expect(count).toBe(1);
    expect(queued[0]).toMatchObject({
      mediaType: 'Video',
      showName: 'Breaking Bad',
      season: 1,
      episode: 1,
      scraperId: 'tmdb',
      showExternalId: '1396',
    });
  });

  it('prefers the numbers already stored over the ones in the filename', async () => {
    const media = await createVideoMedia({
      name: 'Mislabelled',
      path: '/tv/Breaking Bad/Season 1/S01E01.mkv',
      duration: 3000,
      collectionId: seasonId,
    });
    await prisma.videoDetails.create({ data: { mediaId: media.id, season: 1, episode: 7 } });

    await queueEpisodeScrapes(seasonId, identity, 1, {}, { queueMediaScrapes });

    expect(queued[0]).toMatchObject({ season: 1, episode: 7 });
  });

  it('skips a file with no episode number anywhere', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      await createVideoMedia({
        name: 'Behind the scenes',
        path: '/tv/Breaking Bad/Season 1/behind the scenes.mkv',
        duration: 600,
        collectionId: seasonId,
      });

      const count = await queueEpisodeScrapes(seasonId, identity, 1, {}, { queueMediaScrapes });

      expect(count).toBe(0);
    } finally {
      console.warn = warn;
    }
  });

  it('does nothing for a season that no longer exists', async () => {
    const count = await queueEpisodeScrapes('gone', identity, 1, {}, { queueMediaScrapes });

    expect(count).toBe(0);
    expect(queueMediaScrapes).not.toHaveBeenCalled();
  });
});
