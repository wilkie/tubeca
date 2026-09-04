import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import {
  prisma,
  resetDatabase,
  createUser,
  createGroup,
  createLibrary,
  createCollection,
} from '../../test/db';

const asyncMock = <T>() => jest.fn<(...args: unknown[]) => Promise<T>>();

const scraper = {
  id: 'tmdb',
  isConfigured: () => true,
  getVideoMetadata: asyncMock<unknown>(),
  getSeriesMetadata: asyncMock<unknown>(),
};
const scraperManager = { get: jest.fn(() => scraper as unknown), getByMediaType: () => [scraper] };
jest.unstable_mockModule('../../plugins/scraperLoader', () => ({ scraperManager }));

// The candidates go through the ten-minute provider cache; a test wants each
// answer to be its own.
jest.unstable_mockModule('../../services/scrapeCache', () => ({
  cachedCall: <T>(_key: string, call: () => Promise<T>) => call(),
  scrapeCacheKey: (...parts: unknown[]) => parts.join(':'),
}));

const { default: imageRoutes } = await import('../images');

const app = express();
app.use(express.json());
app.use('/api/images', imageRoutes);

let libraryId: string;
let collectionId: string;
let editorHeader: string;

const candidates = (id: string, header: string) =>
  request(app).get(`/api/images/candidates/collection/${id}`).set('Authorization', header);

/** A film identified with TMDB, which is what the endpoint needs to ask anything. */
async function identifiedFilm(externalId = 'movie-949') {
  const collection = await createCollection({ libraryId, name: 'Heat', collectionType: 'Film' });
  await prisma.filmDetails.create({
    data: { collectionId: collection.id, scraperId: 'tmdb', externalId },
  });
  return collection.id;
}

beforeEach(async () => {
  await resetDatabase();
  jest.clearAllMocks();
  scraperManager.get.mockReturnValue(scraper);
  scraper.getVideoMetadata.mockResolvedValue({
    externalId: 'movie-949',
    title: 'Heat',
    posterUrls: ['https://images/poster-1.jpg', 'https://images/poster-2.jpg'],
    backdropUrls: ['https://images/backdrop-1.jpg'],
    logoUrls: ['https://images/logo-1.png'],
  });
  scraper.getSeriesMetadata.mockResolvedValue({
    externalId: 'tv-1396',
    title: 'Breaking Bad',
    posterUrls: ['https://images/show-poster.jpg'],
  });

  libraryId = (await createLibrary({ libraryType: 'Film' })).id;
  collectionId = await identifiedFilm();
  editorHeader = (await createUser({ role: 'Editor' })).authHeader;
});

describe('GET /api/images/candidates/collection/:collectionId', () => {
  it('needs a signed-in user', async () => {
    expect((await request(app).get(`/api/images/candidates/collection/${collectionId}`)).status).toBe(401);
  });

  it('is Editor only, since it makes the provider work', async () => {
    const { authHeader } = await createUser({ role: 'Viewer' });

    expect((await candidates(collectionId, authHeader)).status).toBe(403);
  });

  it('is hidden from an Editor outside the library', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ libraryType: 'Film', groupIds: [group.id] });
    const collection = await createCollection({ libraryId: restricted.id, name: 'Secret' });
    await prisma.filmDetails.create({
      data: { collectionId: collection.id, scraperId: 'tmdb', externalId: 'movie-1' },
    });

    expect((await candidates(collection.id, editorHeader)).status).toBe(404);
  });

  it('is a 404 for a collection that is not there', async () => {
    expect((await candidates('missing', editorHeader)).status).toBe(404);
  });

  it('lists every kind of artwork the provider has', async () => {
    const res = await candidates(collectionId, editorHeader);

    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([
      { url: 'https://images/poster-1.jpg', imageType: 'Poster', saved: false },
      { url: 'https://images/poster-2.jpg', imageType: 'Poster', saved: false },
      { url: 'https://images/backdrop-1.jpg', imageType: 'Backdrop', saved: false },
      { url: 'https://images/logo-1.png', imageType: 'Logo', saved: false },
    ]);
    expect(scraper.getVideoMetadata).toHaveBeenCalledWith('movie-949');
  });

  it('marks the ones already saved, so the dialog does not offer them twice', async () => {
    await prisma.image.create({
      data: {
        collectionId,
        imageType: 'Poster',
        path: 'poster.jpg',
        sourceUrl: 'https://images/poster-2.jpg',
      },
    });

    const res = await candidates(collectionId, editorHeader);

    expect(res.body.candidates.filter((c: { saved: boolean }) => c.saved)).toEqual([
      { url: 'https://images/poster-2.jpg', imageType: 'Poster', saved: true },
    ]);
  });

  it('asks for a show rather than a film when the collection is a show', async () => {
    const show = await createCollection({ libraryId, name: 'Breaking Bad', collectionType: 'Show' });
    await prisma.showDetails.create({
      data: { collectionId: show.id, scraperId: 'tmdb', externalId: 'tv-1396' },
    });

    const res = await candidates(show.id, editorHeader);

    expect(scraper.getSeriesMetadata).toHaveBeenCalledWith('tv-1396');
    expect(res.body.candidates).toEqual([
      { url: 'https://images/show-poster.jpg', imageType: 'Poster', saved: false },
    ]);
  });

  it('says so when the collection has never been identified', async () => {
    const unidentified = await createCollection({ libraryId, name: 'Mystery' });

    const res = await candidates(unidentified.id, editorHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not been identified/);
  });

  it('says so when the scraper that identified it is no longer configured', async () => {
    scraperManager.get.mockReturnValue(undefined);

    const res = await candidates(collectionId, editorHeader);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configured/);
  });

  it('offers nothing rather than failing when the provider has forgotten the title', async () => {
    scraper.getVideoMetadata.mockResolvedValue(null);

    const res = await candidates(collectionId, editorHeader);

    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
  });

  it('offers nothing for a provider that has the title but no artwork lists', async () => {
    scraper.getVideoMetadata.mockResolvedValue({ externalId: 'movie-949', title: 'Heat' });

    expect((await candidates(collectionId, editorHeader)).body.candidates).toEqual([]);
  });
});
