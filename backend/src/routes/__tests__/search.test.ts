import express from 'express';
import request from 'supertest';
import searchRoutes from '../search';
import { searchIndexService } from '../../services/searchIndexService';
import {
  prisma,
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
  createVideoMedia,
} from '../../test/db';

const app = express();
app.use(express.json());
app.use('/api/search', searchRoutes);

async function indexAll() {
  await searchIndexService.rebuild();
}

const names = (items: Array<{ name: string }>) => items.map((i) => i.name).sort();

describe('GET /api/search library scoping', () => {
  beforeEach(resetDatabase);

  async function fixture() {
    const group = await createGroup();
    const pub = await createLibrary({ name: 'Public' });
    const restricted = await createLibrary({ name: 'Restricted', groupIds: [group.id] });
    await createCollection({ libraryId: pub.id, name: 'Public Film' });
    await createCollection({ libraryId: restricted.id, name: 'Secret Film' });
    const tv = await createLibrary({ name: 'TV', libraryType: 'Television', groupIds: [group.id] });
    const show = await createCollection({ libraryId: tv.id, name: 'Secret Show', collectionType: 'Show' });
    await createVideoMedia({ name: 'Secret Episode', path: '/e.mkv', duration: 1, collectionId: show.id });
    return { group };
  }

  it('shows public libraries to users with no groups (same rule as /api/libraries)', async () => {
    await fixture();
    const { authHeader } = await createUser();
    const res = await request(app).get('/api/search?q=Film').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(names(res.body.collections)).toEqual(['Public Film']);
    expect(res.body).toHaveProperty('hasMore');
  });

  it('includes restricted libraries for members, collections and media alike', async () => {
    const { group } = await fixture();
    const { authHeader } = await createUser({ groupIds: [group.id] });
    const res = await request(app).get('/api/search?q=Secret').set('Authorization', authHeader);
    expect(names(res.body.collections)).toEqual(['Secret Film', 'Secret Show']);
    expect(names(res.body.media)).toEqual(['Secret Episode']);
  });

  it('hides restricted media from outsiders', async () => {
    await fixture();
    const { authHeader } = await createUser();
    const res = await request(app).get('/api/search?q=Secret').set('Authorization', authHeader);
    expect(res.body.collections).toEqual([]);
    expect(res.body.media).toEqual([]);
  });

  it('admins see everything', async () => {
    await fixture();
    const { authHeader } = await createUser({ role: 'Admin' });
    const res = await request(app).get('/api/search?q=Film').set('Authorization', authHeader);
    expect(names(res.body.collections)).toEqual(['Public Film', 'Secret Film']);
  });
});

describe('GET /api/search ranking and filters', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.$executeRawUnsafe('DELETE FROM search_index');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/search').query({ q: 'heat' });
    expect(res.status).toBe(401);
  });

  it('matches a word inside a title once the index is built', async () => {
    const library = await createLibrary({ libraryType: 'Film' });
    await createCollection({ libraryId: library.id, name: 'The Empire Strikes Back', collectionType: 'Film' });
    await createCollection({ libraryId: library.id, name: 'Amelie', collectionType: 'Film' });
    await indexAll();
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).get('/api/search').query({ q: 'strikes' }).set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.collections.map((c: { name: string }) => c.name)).toEqual(['The Empire Strikes Back']);
    expect(res.body.totalCollections).toBe(1);
  });

  it('falls back to a substring match when the index is empty', async () => {
    const library = await createLibrary({ libraryType: 'Film' });
    await createCollection({ libraryId: library.id, name: 'Heat', collectionType: 'Film' });
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).get('/api/search').query({ q: 'hea' }).set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.collections).toHaveLength(1);
  });

  it('finds an episode by its show name', async () => {
    const library = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: library.id, name: 'Betty', collectionType: 'Show' });
    const season = await createCollection({
      libraryId: library.id,
      name: 'Season 1',
      collectionType: 'Season',
      parentId: show.id,
    });
    await createVideoMedia({
      name: 'The Pilot',
      path: '/tv/Betty/Season 1/e01.mkv',
      duration: 100,
      collectionId: season.id,
    });
    await indexAll();
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).get('/api/search').query({ q: 'betty' }).set('Authorization', authHeader);

    expect(res.body.media.map((m: { name: string }) => m.name)).toEqual(['The Pilot']);
  });

  it('excludes a content rating from the results', async () => {
    const library = await createLibrary({ libraryType: 'Film' });
    await createCollection({
      libraryId: library.id,
      name: 'Heat One',
      collectionType: 'Film',
      filmDetails: { contentRating: 'R' },
    });
    await createCollection({
      libraryId: library.id,
      name: 'Heat Two',
      collectionType: 'Film',
      filmDetails: { contentRating: 'PG' },
    });
    await indexAll();
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app)
      .get('/api/search')
      .query({ q: 'heat', excludedRatings: 'R' })
      .set('Authorization', authHeader);

    expect(res.body.collections.map((c: { name: string }) => c.name)).toEqual(['Heat Two']);
  });

  it('lists everything when no query is given', async () => {
    const library = await createLibrary({ libraryType: 'Film' });
    await createCollection({ libraryId: library.id, name: 'Heat', collectionType: 'Film' });
    await createCollection({ libraryId: library.id, name: 'Amelie', collectionType: 'Film' });
    await indexAll();
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).get('/api/search').set('Authorization', authHeader);

    expect(res.body.totalCollections).toBe(2);
  });
});

describe('GET /api/search/facets', () => {
  beforeEach(resetDatabase);

  it('offers every keyword and rating in the accessible libraries', async () => {
    const library = await createLibrary({ libraryType: 'Film' });
    await createCollection({
      libraryId: library.id,
      name: 'Heat',
      collectionType: 'Film',
      keywords: ['heist', 'los angeles'],
      filmDetails: { contentRating: 'R' },
    });
    await createCollection({
      libraryId: library.id,
      name: 'Paddington',
      collectionType: 'Film',
      keywords: ['bear'],
      filmDetails: { contentRating: 'PG' },
    });
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).get('/api/search/facets').set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.keywords.map((k: { name: string }) => k.name)).toEqual(['bear', 'heist', 'los angeles']);
    expect(res.body.contentRatings).toEqual(['PG', 'R']);
  });

  it('leaves out keywords that only exist in a library the user cannot see', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ libraryType: 'Film', groupIds: [group.id] });
    await createCollection({
      libraryId: restricted.id,
      name: 'Secret',
      collectionType: 'Film',
      keywords: ['classified'],
    });
    const { authHeader } = await createUser();

    const res = await request(app).get('/api/search/facets').set('Authorization', authHeader);

    expect(res.body.keywords).toEqual([]);
  });
});

describe('POST /api/search/reindex', () => {
  beforeEach(resetDatabase);

  it('is admin only', async () => {
    const { authHeader } = await createUser({ role: 'Editor' });

    const res = await request(app).post('/api/search/reindex').set('Authorization', authHeader);

    expect(res.status).toBe(403);
  });

  it('rebuilds the index so a search finds what was there all along', async () => {
    const library = await createLibrary({ libraryType: 'Film' });
    await createCollection({ libraryId: library.id, name: 'Amelie', collectionType: 'Film' });
    await prisma.$executeRawUnsafe('DELETE FROM search_index');
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).post('/api/search/reindex').set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ collections: 1 });
    const search = await request(app).get('/api/search').query({ q: 'amelie' }).set('Authorization', authHeader);
    expect(search.body.collections).toHaveLength(1);
  });
});
