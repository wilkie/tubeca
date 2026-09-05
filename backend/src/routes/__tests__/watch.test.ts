import express from 'express';
import request from 'supertest';
import watchRoutes from '../watch';
import {
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
  createVideoMedia,
} from '../../test/db';

const app = express();
app.use(express.json());
app.use('/api/watch', watchRoutes);

describe('/api/watch', () => {
  beforeEach(resetDatabase);

  async function fixture() {
    const library = await createLibrary();
    const film = await createCollection({ libraryId: library.id, name: 'Film' });
    const media = await createVideoMedia({ path: '/f.mkv', duration: 600, collectionId: film.id });
    const user = await createUser();
    return { media, user };
  }

  it('returns null progress for an unplayed item', async () => {
    const { media, user } = await fixture();
    const res = await request(app).get(`/api/watch/${media.id}`).set('Authorization', user.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.progress).toBeNull();
  });

  it('records, reads, completes and clears progress', async () => {
    const { media, user } = await fixture();
    const put = await request(app)
      .put(`/api/watch/${media.id}`)
      .set('Authorization', user.authHeader)
      .send({ position: 100 });
    expect(put.status).toBe(200);
    expect(put.body.progress).toMatchObject({ position: 100, duration: 600, completed: false });

    const cont = await request(app).get('/api/watch/continue').set('Authorization', user.authHeader);
    expect(cont.body.items).toHaveLength(1);
    expect(cont.body.items[0].media.id).toBe(media.id);
    expect(cont.body.items[0].progress.position).toBe(100);

    const complete = await request(app)
      .post(`/api/watch/${media.id}/complete`)
      .set('Authorization', user.authHeader);
    expect(complete.body.progress.completed).toBe(true);
    expect((await request(app).get('/api/watch/continue').set('Authorization', user.authHeader)).body.items).toEqual([]);

    expect((await request(app).delete(`/api/watch/${media.id}`).set('Authorization', user.authHeader)).status).toBe(204);
    expect((await request(app).get(`/api/watch/${media.id}`).set('Authorization', user.authHeader)).body.progress).toBeNull();
  });

  it('validates the position', async () => {
    const { media, user } = await fixture();
    for (const body of [{}, { position: -1 }, { position: 'ten' }, { position: 10, duration: -5 }]) {
      const res = await request(app).put(`/api/watch/${media.id}`).set('Authorization', user.authHeader).send(body);
      expect(res.status).toBe(400);
    }
  });

  it('is per user', async () => {
    const { media, user } = await fixture();
    const other = await createUser();
    await request(app).put(`/api/watch/${media.id}`).set('Authorization', user.authHeader).send({ position: 100 });
    const res = await request(app).get(`/api/watch/${media.id}`).set('Authorization', other.authHeader);
    expect(res.body.progress).toBeNull();
  });

  it('enforces library access', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ groupIds: [group.id] });
    const film = await createCollection({ libraryId: restricted.id, name: 'Secret' });
    const media = await createVideoMedia({ path: '/s.mkv', duration: 600, collectionId: film.id });
    const outsider = await createUser();
    const res = await request(app).put(`/api/watch/${media.id}`).set('Authorization', outsider.authHeader).send({ position: 10 });
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/watch/continue')).status).toBe(401);
  });
});

describe('/api/watch batch endpoints', () => {
  beforeEach(resetDatabase);

  it('serves progress batches and collection summaries', async () => {
    const library = await createLibrary();
    const film = await createCollection({ libraryId: library.id, name: 'Film' });
    const media = await createVideoMedia({ path: '/f.mkv', duration: 600, collectionId: film.id });
    const user = await createUser();
    await request(app).put(`/api/watch/${media.id}`).set('Authorization', user.authHeader).send({ position: 100 });

    const batch = await request(app).get(`/api/watch/batch?mediaIds=${media.id},other`).set('Authorization', user.authHeader);
    expect(batch.status).toBe(200);
    expect(Object.keys(batch.body.progress)).toEqual([media.id]);

    const summaries = await request(app).get(`/api/watch/collections?ids=${film.id}`).set('Authorization', user.authHeader);
    expect(summaries.status).toBe(200);
    expect(summaries.body.summaries[film.id]).toMatchObject({ total: 1, watched: 0, inProgress: 1 });
  });

  it('rejects missing or oversized id lists', async () => {
    const user = await createUser();
    expect((await request(app).get('/api/watch/batch').set('Authorization', user.authHeader)).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => `id${i}`).join(',');
    expect((await request(app).get(`/api/watch/collections?ids=${tooMany}`).set('Authorization', user.authHeader)).status).toBe(400);
  });
});

describe('/api/watch/collections/:collectionId', () => {
  beforeEach(resetDatabase);

  async function season() {
    const library = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
    const s1 = await createCollection({
      libraryId: library.id,
      name: 'Season 1',
      collectionType: 'Season',
      parentId: show.id,
    });
    const e1 = await createVideoMedia({ path: '/s1e1.mkv', duration: 600, collectionId: s1.id });
    const e2 = await createVideoMedia({ path: '/s1e2.mkv', duration: 600, collectionId: s1.id });
    const user = await createUser();
    return { show, s1, e1, e2, user };
  }

  it('marks a season watched in one call and clears it again', async () => {
    const { s1, e1, user } = await season();

    const marked = await request(app)
      .post(`/api/watch/collections/${s1.id}`)
      .set('Authorization', user.authHeader);
    expect(marked.status).toBe(200);
    expect(marked.body.count).toBe(2);

    const one = await request(app).get(`/api/watch/${e1.id}`).set('Authorization', user.authHeader);
    expect(one.body.progress).toMatchObject({ completed: true });

    const cleared = await request(app)
      .delete(`/api/watch/collections/${s1.id}`)
      .set('Authorization', user.authHeader);
    expect(cleared.status).toBe(200);
    expect(cleared.body.count).toBe(2);
  });

  it('refuses a collection in a library the viewer cannot see', async () => {
    const group = await createGroup();
    const library = await createLibrary({ groupIds: [group.id] });
    const show = await createCollection({ libraryId: library.id, name: 'Private' });
    const outsider = await createUser();

    const res = await request(app)
      .post(`/api/watch/collections/${show.id}`)
      .set('Authorization', outsider.authHeader);
    expect(res.status).toBe(404);
  });

  it('needs a token', async () => {
    const { s1 } = await season();
    expect((await request(app).post(`/api/watch/collections/${s1.id}`)).status).toBe(401);
  });
});
