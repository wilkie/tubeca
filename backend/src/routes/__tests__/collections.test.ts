import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { resetDatabase, createGroup, createLibrary, createCollection, createUser } from '../../test/db';

const addCollectionScrapeJob = jest.fn<(...args: unknown[]) => Promise<{ id: string }>>();
jest.unstable_mockModule('../../queues/collectionScrapeQueue', () => ({
  addCollectionScrapeJob,
}));

/** One configured scraper, whose answers each test decides. */
const scraper = {
  id: 'tmdb',
  isConfigured: () => true,
  searchSeries: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  searchVideo: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
};
const scraperManager = { getByMediaType: jest.fn(() => [scraper] as unknown[]), get: () => scraper };
jest.unstable_mockModule('../../plugins/scraperLoader', () => ({ scraperManager }));

const { default: collectionRoutes } = await import('../collections');
const { prisma } = await import('../../test/db');

const app = express();
app.use(express.json());
app.use('/api/collections', collectionRoutes);

describe('collections routes enforce library access', () => {
  beforeEach(resetDatabase);

  async function fixture() {
    const group = await createGroup();
    const library = await createLibrary({ groupIds: [group.id] });
    const collection = await createCollection({ libraryId: library.id, name: 'Secret' });
    const member = await createUser({ groupIds: [group.id] });
    const outsider = await createUser();
    const outsiderEditor = await createUser({ role: 'Editor' });
    return { library, collection, member, outsider, outsiderEditor };
  }

  it('GET /:id is 404 for outsiders and 200 for members', async () => {
    const { collection, member, outsider } = await fixture();
    expect((await request(app).get(`/api/collections/${collection.id}`).set('Authorization', outsider.authHeader)).status).toBe(404);
    const ok = await request(app).get(`/api/collections/${collection.id}`).set('Authorization', member.authHeader);
    expect(ok.status).toBe(200);
    expect(ok.body.collection.name).toBe('Secret');
  });

  it('GET /library/:libraryId listing is hidden from outsiders', async () => {
    const { library, member, outsider } = await fixture();
    expect((await request(app).get(`/api/collections/library/${library.id}`).set('Authorization', outsider.authHeader)).status).toBe(404);
    expect((await request(app).get(`/api/collections/library/${library.id}`).set('Authorization', member.authHeader)).status).toBe(200);
  });

  it('an Editor outside the group cannot modify or create in the library', async () => {
    const { library, collection, outsiderEditor } = await fixture();
    const patch = await request(app)
      .patch(`/api/collections/${collection.id}`)
      .set('Authorization', outsiderEditor.authHeader)
      .send({ name: 'Renamed' });
    expect(patch.status).toBe(404);

    const create = await request(app)
      .post('/api/collections')
      .set('Authorization', outsiderEditor.authHeader)
      .send({ name: 'New', libraryId: library.id });
    expect(create.status).toBe(404);
  });

  it('a genuinely missing collection still 404s with the handler message', async () => {
    const { member } = await fixture();
    const res = await request(app).get('/api/collections/nope').set('Authorization', member.authHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Collection not found');
  });

  it('deleting a collection that is not there is a 404, not a server error', async () => {
    const admin = await createUser({ role: 'Admin' });

    const res = await request(app).delete('/api/collections/nope').set('Authorization', admin.authHeader);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Collection not found');
  });

  it('deletes a collection that is there', async () => {
    const library = await createLibrary({});
    const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
    const admin = await createUser({ role: 'Admin' });

    const res = await request(app)
      .delete(`/api/collections/${collection.id}`)
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(204);
  });
});

describe('POST /api/collections/search', () => {
  beforeEach(async () => {
    await resetDatabase();
    jest.clearAllMocks();
    scraperManager.getByMediaType.mockReturnValue([scraper]);
    scraper.searchSeries.mockResolvedValue([]);
    scraper.searchVideo.mockResolvedValue([]);
  });

  const search = async (body: Record<string, unknown>) => {
    const { authHeader } = await createUser();
    return request(app).post('/api/collections/search').set('Authorization', authHeader).send(body);
  };

  it('needs a signed-in user', async () => {
    const res = await request(app).post('/api/collections/search').send({ query: 'Heat', type: 'Film' });

    expect(res.status).toBe(401);
  });

  it('insists on a query and a type', async () => {
    expect((await search({ type: 'Film' })).status).toBe(400);
    expect((await search({ query: 'Heat' })).status).toBe(400);
  });

  it('will only look for a Show or a Film', async () => {
    const res = await search({ query: 'Kind of Blue', type: 'Album' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Type must be Show or Film');
  });

  it('searches for a series when the collection is a show', async () => {
    scraper.searchSeries.mockResolvedValue([
      { externalId: 'tv-1396', title: 'Breaking Bad', year: 2008, posterUrl: 'p.jpg', overview: 'A teacher.' },
    ]);

    const res = await search({ query: 'Breaking Bad', type: 'Show' });

    expect(scraper.searchSeries).toHaveBeenCalledWith('Breaking Bad');
    expect(res.body.results).toEqual([
      {
        externalId: 'tv-1396',
        scraperId: 'tmdb',
        title: 'Breaking Bad',
        year: 2008,
        posterUrl: 'p.jpg',
        overview: 'A teacher.',
      },
    ]);
  });

  it('searches for a movie, with the year, when the collection is a film', async () => {
    scraper.searchVideo.mockResolvedValue([{ externalId: 'movie-949', title: 'Heat', year: 1995 }]);

    const res = await search({ query: 'Heat', type: 'Film', year: 1995 });

    expect(scraper.searchVideo).toHaveBeenCalledWith('Heat', { year: 1995, videoType: 'movie' });
    expect(res.body.results[0]).toMatchObject({ externalId: 'movie-949', scraperId: 'tmdb' });
  });

  it('has nothing to offer when no scraper is configured', async () => {
    scraperManager.getByMediaType.mockReturnValue([]);

    const res = await search({ query: 'Heat', type: 'Film' });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('keeps the results of the scrapers that answered when one fails', async () => {
    const secondScraper = {
      id: 'tvdb',
      isConfigured: () => true,
      searchSeries: jest.fn<(...args: unknown[]) => Promise<unknown[]>>(),
    };
    scraper.searchSeries.mockRejectedValue(new Error('TMDB is down'));
    secondScraper.searchSeries.mockResolvedValue([{ externalId: 'series-1', title: 'Breaking Bad' }]);
    scraperManager.getByMediaType.mockReturnValue([scraper, secondScraper]);

    const res = await search({ query: 'Breaking Bad', type: 'Show' });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({ externalId: 'series-1', scraperId: 'tvdb' }),
    ]);
  });

  it('skips a scraper that cannot search for what was asked', async () => {
    scraperManager.getByMediaType.mockReturnValue([{ id: 'partial', isConfigured: () => true }]);

    const res = await search({ query: 'Heat', type: 'Film' });

    expect(res.body.results).toEqual([]);
  });
});

describe('POST /api/collections/:id/identify', () => {
  beforeEach(async () => {
    await resetDatabase();
    jest.clearAllMocks();
    addCollectionScrapeJob.mockResolvedValue({ id: 'job-1' });
  });

  async function fixture(collectionType: 'Show' | 'Film' | 'Season' = 'Film') {
    const library = await createLibrary({});
    const collection = await createCollection({
      libraryId: library.id,
      name: 'Heat (1995)',
      collectionType,
    });
    const editor = await createUser({ role: 'Editor' });
    return { collection, editor };
  }

  const identify = (id: string, authHeader: string, body: Record<string, unknown>) =>
    request(app).post(`/api/collections/${id}/identify`).set('Authorization', authHeader).send(body);

  it('is Editor only', async () => {
    const { collection } = await fixture();
    const viewer = await createUser({ role: 'Viewer' });

    const res = await identify(collection.id, viewer.authHeader, {
      externalId: 'movie-949',
      scraperId: 'tmdb',
    });

    expect(res.status).toBe(403);
  });

  it('insists on both an id and the scraper it came from', async () => {
    const { collection, editor } = await fixture();

    expect((await identify(collection.id, editor.authHeader, { externalId: 'movie-949' })).status).toBe(400);
    expect((await identify(collection.id, editor.authHeader, { scraperId: 'tmdb' })).status).toBe(400);
  });

  it('is a 404 for a collection that is not there', async () => {
    const editor = await createUser({ role: 'Editor' });

    const res = await identify('missing', editor.authHeader, {
      externalId: 'movie-949',
      scraperId: 'tmdb',
    });

    expect(res.status).toBe(404);
  });

  it('refuses a kind of collection that cannot be identified', async () => {
    const { collection, editor } = await fixture('Season');

    const res = await identify(collection.id, editor.authHeader, {
      externalId: 'season-1',
      scraperId: 'tmdb',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Only Show and Film collections can be identified');
  });

  it('writes the identity onto a film and queues a scrape for it', async () => {
    const { collection, editor } = await fixture('Film');

    const res = await identify(collection.id, editor.authHeader, {
      externalId: 'movie-949',
      scraperId: 'tmdb',
    });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: 'Identification queued', jobId: 'job-1' });
    expect(await prisma.filmDetails.findUniqueOrThrow({ where: { collectionId: collection.id } })).toMatchObject({
      scraperId: 'tmdb',
      externalId: 'movie-949',
    });
    expect(addCollectionScrapeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionId: collection.id,
        collectionType: 'Film',
        externalId: 'movie-949',
        scraperId: 'tmdb',
        cascade: undefined,
      })
    );
  });

  it('cascades the whole way down when a show is re-identified', async () => {
    const { collection, editor } = await fixture('Show');

    await identify(collection.id, editor.authHeader, { externalId: 'tv-1396', scraperId: 'tmdb' });

    expect(await prisma.showDetails.findUniqueOrThrow({ where: { collectionId: collection.id } })).toMatchObject({
      externalId: 'tv-1396',
    });
    expect(addCollectionScrapeJob).toHaveBeenCalledWith(expect.objectContaining({ cascade: 'all' }));
  });

  it('replaces an identity that was already there', async () => {
    const { collection, editor } = await fixture('Film');
    await prisma.filmDetails.create({
      data: { collectionId: collection.id, scraperId: 'tmdb', externalId: 'movie-1', description: 'Wrong film' },
    });

    await identify(collection.id, editor.authHeader, { externalId: 'movie-949', scraperId: 'tmdb' });

    expect(await prisma.filmDetails.findUniqueOrThrow({ where: { collectionId: collection.id } })).toMatchObject({
      externalId: 'movie-949',
      description: 'Wrong film',
    });
  });

  it('throws away the artwork of the title it turned out not to be', async () => {
    const { collection, editor } = await fixture('Film');
    await prisma.image.create({
      data: { collectionId: collection.id, path: 'old-poster.jpg', imageType: 'Poster', isPrimary: true },
    });

    await identify(collection.id, editor.authHeader, { externalId: 'movie-949', scraperId: 'tmdb' });

    expect(await prisma.image.count({ where: { collectionId: collection.id } })).toBe(0);
  });
});

describe('POST /api/collections/:id/refresh-metadata and refresh-images', () => {
  beforeEach(async () => {
    await resetDatabase();
    jest.clearAllMocks();
    addCollectionScrapeJob.mockResolvedValue({ id: 'job-1' });
  });

  async function fixture(collectionType: 'Show' | 'Film' | 'Generic' = 'Film') {
    const library = await createLibrary({});
    const collection = await createCollection({
      libraryId: library.id,
      name: 'Heat (1995)',
      collectionType,
    });
    const editor = await createUser({ role: 'Editor' });
    return { collection, editor };
  }

  const post = (id: string, path: string, authHeader: string) =>
    request(app).post(`/api/collections/${id}/${path}`).set('Authorization', authHeader);

  it('is Editor only', async () => {
    const { collection } = await fixture();
    const viewer = await createUser({ role: 'Viewer' });

    expect((await post(collection.id, 'refresh-metadata', viewer.authHeader)).status).toBe(403);
    expect((await post(collection.id, 'refresh-images', viewer.authHeader)).status).toBe(403);
  });

  it('refuses a kind of collection nothing scrapes', async () => {
    const { collection, editor } = await fixture('Generic');

    const res = await post(collection.id, 'refresh-metadata', editor.authHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This collection type does not support metadata scraping');
  });

  it('queues a metadata refresh that leaves the images alone', async () => {
    const { collection, editor } = await fixture('Film');

    const res = await post(collection.id, 'refresh-metadata', editor.authHeader);

    expect(res.status).toBe(202);
    expect(addCollectionScrapeJob).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: collection.id, skipImages: true })
    );
  });

  it('queues an image refresh that leaves the metadata alone', async () => {
    const { collection, editor } = await fixture('Film');

    const res = await post(collection.id, 'refresh-images', editor.authHeader);

    expect(res.status).toBe(202);
    expect(addCollectionScrapeJob).toHaveBeenCalledWith(
      expect.objectContaining({ collectionId: collection.id, imagesOnly: true })
    );
  });

  it('carries the identity it already has back to the scraper', async () => {
    const { collection, editor } = await fixture('Film');
    await prisma.filmDetails.create({
      data: { collectionId: collection.id, scraperId: 'tmdb', externalId: 'movie-949' },
    });

    await post(collection.id, 'refresh-metadata', editor.authHeader);

    expect(addCollectionScrapeJob).toHaveBeenCalledWith(
      expect.objectContaining({ scraperId: 'tmdb', externalId: 'movie-949' })
    );
  });

  it('carries a season number and its parent show', async () => {
    const library = await createLibrary({});
    const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
    const season = await createCollection({
      libraryId: library.id,
      name: 'Season 1',
      collectionType: 'Season',
      parentId: show.id,
    });
    await prisma.seasonDetails.create({
      data: { collectionId: season.id, scraperId: 'tmdb', externalId: 'season-1', seasonNumber: 1 },
    });
    const editor = await createUser({ role: 'Editor' });

    await post(season.id, 'refresh-metadata', editor.authHeader);

    expect(addCollectionScrapeJob).toHaveBeenCalledWith(
      expect.objectContaining({ parentShowId: show.id, seasonNumber: 1, externalId: 'season-1' })
    );
  });
});

describe('an Editor in a view-only group', () => {
  beforeEach(resetDatabase);

  /** A library one group grants sight of but not the right to change. */
  async function readOnly() {
    const group = await createGroup(undefined, { canEdit: false });
    const library = await createLibrary({ groupIds: [group.id] });
    const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
    const editor = await createUser({ role: 'Editor', groupIds: [group.id] });
    return { library, collection, editor };
  }

  it('can read the collection', async () => {
    const { collection, editor } = await readOnly();

    const res = await request(app)
      .get(`/api/collections/${collection.id}`)
      .set('Authorization', editor.authHeader);

    expect(res.status).toBe(200);
  });

  it('cannot rename, delete, refresh or identify it', async () => {
    const { collection, editor } = await readOnly();
    const auth = { Authorization: editor.authHeader };

    const attempts = [
      request(app).patch(`/api/collections/${collection.id}`).set(auth).send({ name: 'Renamed' }),
      request(app).delete(`/api/collections/${collection.id}`).set(auth),
      request(app).post(`/api/collections/${collection.id}/refresh-metadata`).set(auth).send({}),
      request(app).post(`/api/collections/${collection.id}/refresh-images`).set(auth).send({}),
      request(app).post(`/api/collections/${collection.id}/identify`).set(auth).send({ scraperId: 'tmdb', externalId: '1' }),
    ];

    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
    }
  });

  it('cannot create a collection in that library either', async () => {
    const { library, editor } = await readOnly();

    const res = await request(app)
      .post('/api/collections')
      .set('Authorization', editor.authHeader)
      .send({ name: 'New', collectionType: 'Film', libraryId: library.id });

    expect(res.status).toBe(403);
  });
});
