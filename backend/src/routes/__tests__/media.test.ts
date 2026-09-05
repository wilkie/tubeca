import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import {
  prisma,
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
  createVideoMedia,
} from '../../test/db';

// The router reaches for Redis and the loaded scrapers; neither belongs here.
const addMetadataScrapeJob = jest.fn(async () => ({ id: 'job-1' }));
jest.unstable_mockModule('../../queues/metadataScrapeQueue', () => ({
  addMetadataScrapeJob,
  getMetadataScrapeQueueStatus: jest.fn(async () => ({ waiting: 0, active: 0 })),
}));
jest.unstable_mockModule('../../plugins/scraperLoader', () => ({
  scraperManager: { list: () => [], getByMediaType: () => [], get: () => undefined },
}));
const addTrickplayJob = jest.fn(async () => ({ id: 'trickplay-job-1' }));
jest.unstable_mockModule('../../queues/trickplayQueue', () => ({
  addTrickplayJob,
  getTrickplayJob: jest.fn(async () => undefined),
}));

const { default: mediaRoutes } = await import('../media');

const app = express();
app.use(express.json());
app.use('/api/media', mediaRoutes);

async function fixture() {
  const group = await createGroup();
  const library = await createLibrary({ groupIds: [group.id] });
  const collection = await createCollection({ libraryId: library.id, name: 'Betty', collectionType: 'Show' });
  const media = await createVideoMedia({
    name: 'Pilot',
    path: '/tv/Betty/pilot.mkv',
    duration: 1200,
    collectionId: collection.id,
  });
  return {
    media,
    member: await createUser({ role: 'Editor', groupIds: [group.id] }),
    outsider: await createUser({ role: 'Editor' }),
    admin: await createUser({ role: 'Admin' }),
    viewer: await createUser({ role: 'Viewer', groupIds: [group.id] }),
  };
}

beforeEach(async () => {
  await resetDatabase();
  jest.clearAllMocks();
});

describe('GET /api/media/:id', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/media/anything');
    expect(res.status).toBe(401);
  });

  it('serves a member and hides the item from an outsider', async () => {
    const { media, member, outsider } = await fixture();

    const allowed = await request(app).get(`/api/media/${media.id}`).set('Authorization', member.authHeader);
    const denied = await request(app).get(`/api/media/${media.id}`).set('Authorization', outsider.authHeader);

    expect(allowed.status).toBe(200);
    expect(allowed.body.media.name).toBe('Pilot');
    // 404 rather than 403, so the response does not confirm it exists.
    expect(denied.status).toBe(404);
  });

  it('is a 404 for an id that does not exist', async () => {
    const { admin } = await fixture();

    const res = await request(app).get('/api/media/nope').set('Authorization', admin.authHeader);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/media/:id', () => {
  it('deletes a media row', async () => {
    const { media, member } = await fixture();

    const res = await request(app).delete(`/api/media/${media.id}`).set('Authorization', member.authHeader);

    expect(res.status).toBe(204);
    expect(await prisma.media.count()).toBe(0);
  });

  it('answers 404 for a media item that is not there, rather than a server error', async () => {
    const { admin } = await fixture();

    const res = await request(app).delete('/api/media/nope').set('Authorization', admin.authHeader);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Media not found');
  });

  it('needs an editor', async () => {
    const { media, viewer } = await fixture();

    const res = await request(app).delete(`/api/media/${media.id}`).set('Authorization', viewer.authHeader);

    expect(res.status).toBe(403);
    expect(await prisma.media.count()).toBe(1);
  });

  it('hides an item in another group behind a 404 and leaves it alone', async () => {
    const { media, outsider } = await fixture();

    const res = await request(app).delete(`/api/media/${media.id}`).set('Authorization', outsider.authHeader);

    expect(res.status).toBe(404);
    expect(await prisma.media.count()).toBe(1);
  });
});

describe('POST /api/media/:id/refresh-metadata', () => {
  it('queues a scrape that keeps the existing artwork', async () => {
    const { media, member } = await fixture();

    const res = await request(app)
      .post(`/api/media/${media.id}/refresh-metadata`)
      .set('Authorization', member.authHeader)
      .send({});

    expect(res.status).toBe(202);
    expect(addMetadataScrapeJob).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: media.id, mediaType: 'Video', skipImages: true })
    );
  });

  it('passes on a scraper and external id when one is chosen', async () => {
    const { media, member } = await fixture();

    await request(app)
      .post(`/api/media/${media.id}/refresh-metadata`)
      .set('Authorization', member.authHeader)
      .send({ scraperId: 'tmdb', externalId: '1396' });

    expect(addMetadataScrapeJob).toHaveBeenCalledWith(
      expect.objectContaining({ scraperId: 'tmdb', externalId: '1396' })
    );
  });

  it('queues nothing for an item the caller cannot see', async () => {
    const { media, outsider } = await fixture();

    const res = await request(app)
      .post(`/api/media/${media.id}/refresh-metadata`)
      .set('Authorization', outsider.authHeader)
      .send({});

    expect(res.status).toBe(404);
    expect(addMetadataScrapeJob).not.toHaveBeenCalled();
  });

  it('needs an editor', async () => {
    const { media, viewer } = await fixture();

    const res = await request(app)
      .post(`/api/media/${media.id}/refresh-metadata`)
      .set('Authorization', viewer.authHeader)
      .send({});

    expect(res.status).toBe(403);
    expect(addMetadataScrapeJob).not.toHaveBeenCalled();
  });
});

describe('POST /api/media/:id/refresh-images', () => {
  it('queues a scrape that only fetches artwork', async () => {
    const { media, member } = await fixture();

    const res = await request(app)
      .post(`/api/media/${media.id}/refresh-images`)
      .set('Authorization', member.authHeader)
      .send({});

    expect(res.status).toBe(202);
    expect(addMetadataScrapeJob).toHaveBeenCalledWith(expect.objectContaining({ imagesOnly: true }));
  });
});

describe('GET /api/media/scrapers/queue-status', () => {
  it('is admin only', async () => {
    const { member, admin } = await fixture();

    expect(
      (await request(app).get('/api/media/scrapers/queue-status').set('Authorization', member.authHeader)).status
    ).toBe(403);
    expect(
      (await request(app).get('/api/media/scrapers/queue-status').set('Authorization', admin.authHeader)).status
    ).toBe(200);
  });
});

describe('POST /api/media/:id/trickplay', () => {
  beforeEach(async () => {
    await resetDatabase();
    jest.clearAllMocks();
  });

  async function video() {
    const library = await createLibrary({ libraryType: 'Film' });
    const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
    const media = await createVideoMedia({
      name: 'Heat',
      path: '/films/heat.mkv',
      duration: 10200,
      collectionId: collection.id,
    });
    return { media, library };
  }

  const generate = (id: string, authHeader: string) =>
    request(app).post(`/api/media/${id}/trickplay`).set('Authorization', authHeader);

  it('is Editor only, since it spends the machine', async () => {
    const { media } = await video();
    const { authHeader } = await createUser({ role: 'Viewer' });

    expect((await generate(media.id, authHeader)).status).toBe(403);
  });

  it('is a 404 for a media item that is not there', async () => {
    const { authHeader } = await createUser({ role: 'Editor' });

    expect((await generate('missing', authHeader)).status).toBe(404);
  });

  it('is hidden from an Editor outside the library', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ libraryType: 'Film', groupIds: [group.id] });
    const collection = await createCollection({ libraryId: restricted.id, name: 'Secret' });
    const media = await createVideoMedia({ path: '/films/secret.mkv', duration: 1, collectionId: collection.id });
    const { authHeader } = await createUser({ role: 'Editor' });

    expect((await generate(media.id, authHeader)).status).toBe(404);
  });

  it('queues one job for the video', async () => {
    const { media } = await video();
    const { authHeader } = await createUser({ role: 'Editor' });

    const res = await generate(media.id, authHeader);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: 'Preview generation queued', jobId: 'trickplay-job-1' });
    expect(addTrickplayJob).toHaveBeenCalledWith({ mediaId: media.id, mediaName: 'Heat' });
  });
});
