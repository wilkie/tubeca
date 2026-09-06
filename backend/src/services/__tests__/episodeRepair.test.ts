import { jest } from '@jest/globals';

const addBulkMetadataScrapeJobs = jest.fn<(jobs: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule('../../queues/metadataScrapeQueue', () => ({
  addBulkMetadataScrapeJobs,
  addMetadataScrapeJob: jest.fn(),
}));

const { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia } = await import(
  '../../test/db'
);
const { readEpisodeFromPath, repairEpisodeNumbers } = await import('../episodeRepair');

/** A show with one season, optionally already identified with a provider. */
async function show(identified = true) {
  const library = await createLibrary({ libraryType: 'Television' });
  const parent = await createCollection({
    libraryId: library.id,
    name: 'Brooklyn Nine-Nine',
    collectionType: 'Show',
  });
  if (identified) {
    await prisma.showDetails.create({
      data: { collectionId: parent.id, scraperId: 'tmdb', externalId: 'tv-48891' },
    });
  }
  const season = await createCollection({
    libraryId: library.id,
    name: 'Season 3',
    collectionType: 'Season',
    parentId: parent.id,
  });
  return { library, parent, season };
}

beforeEach(async () => {
  await resetDatabase();
  jest.clearAllMocks();
  addBulkMetadataScrapeJobs.mockResolvedValue([]);
});

describe('readEpisodeFromPath', () => {
  it('takes the season from the folder and the episode from the name', () => {
    expect(readEpisodeFromPath('/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv')).toEqual({
      season: 3,
      episode: 14,
    });
  });

  it('prefers what the filename says over the folder', () => {
    expect(readEpisodeFromPath('/tv/Show/Season 1/s02e05 - Title.mkv')).toEqual({
      season: 2,
      episode: 5,
    });
  });

  it('says nothing when neither the folder nor the name does', () => {
    expect(readEpisodeFromPath('/tv/Show/Extras/Behind the scenes.mkv')).toBeNull();
  });
});

describe('repairEpisodeNumbers', () => {
  it('gives an episode the numbers its path always carried', async () => {
    const { library, season } = await show();
    const media = await createVideoMedia({
      name: '14 - Karen Peralta',
      path: '/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv',
      duration: 1300,
      collectionId: season.id,
    });

    const report = await repairEpisodeNumbers(library.id, { rescrape: false });

    expect(report).toMatchObject({ examined: 1, repaired: 1, unreadable: 0 });
    const details = await prisma.videoDetails.findUniqueOrThrow({ where: { mediaId: media.id } });
    expect(details).toMatchObject({ season: 3, episode: 14 });
  });

  it('fills in a detail row that exists but never learned its numbers', async () => {
    const { library, season } = await show();
    const media = await createVideoMedia({
      name: '14 - Karen Peralta',
      path: '/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv',
      duration: 1300,
      collectionId: season.id,
    });
    await prisma.videoDetails.create({
      data: { mediaId: media.id, description: 'Scraped once, long ago' },
    });

    await repairEpisodeNumbers(library.id, { rescrape: false });

    const details = await prisma.videoDetails.findUniqueOrThrow({ where: { mediaId: media.id } });
    // The description is why this updates rather than replaces.
    expect(details).toMatchObject({ season: 3, episode: 14, description: 'Scraped once, long ago' });
  });

  it('leaves an episode that already has its numbers alone', async () => {
    const { library, season } = await show();
    const media = await createVideoMedia({
      name: 's03e14',
      path: '/tv/Brooklyn Nine-Nine/Season 3/s03e14.mkv',
      duration: 1300,
      collectionId: season.id,
    });
    await prisma.videoDetails.create({ data: { mediaId: media.id, season: 3, episode: 14 } });

    const report = await repairEpisodeNumbers(library.id, { rescrape: false });

    expect(report.examined).toBe(0);
  });

  it('counts what it cannot read rather than guessing', async () => {
    const { library, parent } = await show();
    const extras = await createCollection({
      libraryId: library.id,
      name: 'Extras',
      collectionType: 'Season',
      parentId: parent.id,
    });
    await createVideoMedia({
      name: 'Behind the scenes',
      path: '/tv/Brooklyn Nine-Nine/Extras/Behind the scenes.mkv',
      duration: 600,
      collectionId: extras.id,
    });

    const report = await repairEpisodeNumbers(library.id, { rescrape: false });

    expect(report).toMatchObject({ examined: 1, repaired: 0, unreadable: 1 });
  });

  it('writes nothing on a dry run, but says what it would do', async () => {
    const { library, season } = await show();
    const media = await createVideoMedia({
      name: '14 - Karen Peralta',
      path: '/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv',
      duration: 1300,
      collectionId: season.id,
    });

    const report = await repairEpisodeNumbers(library.id, { dryRun: true, rescrape: true });

    expect(report).toMatchObject({ examined: 1, repaired: 1, queued: 0 });
    expect(await prisma.videoDetails.findUnique({ where: { mediaId: media.id } })).toBeNull();
    expect(addBulkMetadataScrapeJobs).not.toHaveBeenCalled();
  });

  it('queues each repaired episode with the show it belongs to', async () => {
    const { library, season } = await show();
    const media = await createVideoMedia({
      name: '14 - Karen Peralta',
      path: '/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv',
      duration: 1300,
      collectionId: season.id,
    });

    const report = await repairEpisodeNumbers(library.id, { rescrape: true });

    expect(report.queued).toBe(1);
    const [jobs] = addBulkMetadataScrapeJobs.mock.calls[0] as [Record<string, unknown>[]];
    // With all three the worker fetches the episode instead of searching.
    expect(jobs[0]).toMatchObject({
      mediaId: media.id,
      season: 3,
      episode: 14,
      scraperId: 'tmdb',
      showExternalId: 'tv-48891',
      showName: 'Brooklyn Nine-Nine',
    });
  });

  it('marks the queued episodes pending, so the page does not still say NoMatch', async () => {
    const { library, season } = await show();
    const media = await createVideoMedia({
      name: '14 - Karen Peralta',
      path: '/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv',
      duration: 1300,
      collectionId: season.id,
    });
    await prisma.media.update({
      where: { id: media.id },
      data: { scrapeStatus: 'NoMatch', scrapeMessage: 'No confident match' },
    });

    await repairEpisodeNumbers(library.id, { rescrape: true });

    const row = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    expect(row.scrapeStatus).toBe('Pending');
  });

  it('still queues an episode whose show was never identified', async () => {
    // Without an external id the worker searches by show name, which is the
    // path it had before and still better than searching for the filename.
    const { library, season } = await show(false);
    await createVideoMedia({
      name: '14 - Karen Peralta',
      path: '/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv',
      duration: 1300,
      collectionId: season.id,
    });

    await repairEpisodeNumbers(library.id, { rescrape: true });

    const [jobs] = addBulkMetadataScrapeJobs.mock.calls[0] as [Record<string, unknown>[]];
    expect(jobs[0]).toMatchObject({ season: 3, episode: 14, showName: 'Brooklyn Nine-Nine' });
    expect(jobs[0].showExternalId).toBeUndefined();
  });

  it('leaves other libraries alone', async () => {
    const { season } = await show();
    await createVideoMedia({
      name: '14 - Karen Peralta',
      path: '/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv',
      duration: 1300,
      collectionId: season.id,
    });
    const other = await createLibrary({ libraryType: 'Television' });

    const report = await repairEpisodeNumbers(other.id, { rescrape: false });

    expect(report.examined).toBe(0);
  });

  it('does every television library when no one is named', async () => {
    const { season } = await show();
    await createVideoMedia({
      name: '14 - Karen Peralta',
      path: '/tv/Brooklyn Nine-Nine/Season 3/14 - Karen Peralta.mkv',
      duration: 1300,
      collectionId: season.id,
    });

    const report = await repairEpisodeNumbers(undefined, { rescrape: false });

    expect(report.repaired).toBe(1);
  });
});
