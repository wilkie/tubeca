import express from 'express';
import request from 'supertest';
import searchRoutes from '../search';
import {
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
  createVideoMedia,
} from '../../test/db';

const app = express();
app.use('/api/search', searchRoutes);

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
