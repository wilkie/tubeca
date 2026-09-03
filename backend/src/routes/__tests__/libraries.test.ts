import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { resetDatabase, createGroup, createLibrary, createUser } from '../../test/db';

// The router pulls in the scan queue (Redis) and the file watcher; neither is
// wanted in a route test.
jest.unstable_mockModule('../../queues/libraryScanQueue', () => ({
  addLibraryScanJob: jest.fn(),
  getLibraryScanJob: jest.fn(),
  cancelLibraryScanJob: jest.fn(),
}));
jest.unstable_mockModule('../../services/fileWatcherService', () => ({
  fileWatcherService: { sync: jest.fn(async () => undefined) },
}));

const { default: libraryRoutes } = await import('../libraries');

const app = express();
app.use(express.json());
app.use('/api/libraries', libraryRoutes);

describe('GET /api/libraries', () => {
  beforeEach(resetDatabase);

  it('requires authentication', async () => {
    const res = await request(app).get('/api/libraries');
    expect(res.status).toBe(401);
  });

  it('filters by group membership for non-admins', async () => {
    const group = await createGroup();
    const pub = await createLibrary({ name: 'Public' });
    const restricted = await createLibrary({ name: 'Restricted', groupIds: [group.id] });
    const { authHeader: outsider } = await createUser();
    const { authHeader: member } = await createUser({ groupIds: [group.id] });

    const outsiderRes = await request(app).get('/api/libraries').set('Authorization', outsider);
    expect(outsiderRes.status).toBe(200);
    expect(outsiderRes.body.libraries.map((l: { id: string }) => l.id)).toEqual([pub.id]);

    const memberRes = await request(app).get('/api/libraries').set('Authorization', member);
    expect(memberRes.body.libraries.map((l: { id: string }) => l.id).sort()).toEqual(
      [pub.id, restricted.id].sort()
    );
  });

  it('hides a restricted library by id from non-members with 404', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ groupIds: [group.id] });
    const { authHeader } = await createUser();

    const res = await request(app).get(`/api/libraries/${restricted.id}`).set('Authorization', authHeader);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/libraries', () => {
  beforeEach(resetDatabase);

  it('is Admin only', async () => {
    const { authHeader } = await createUser({ role: 'Editor' });
    const res = await request(app)
      .post('/api/libraries')
      .set('Authorization', authHeader)
      .send({ name: 'X', path: '/tmp', libraryType: 'Film' });
    expect(res.status).toBe(403);
  });

  it('rejects unknown and hidden library types', async () => {
    const { authHeader } = await createUser({ role: 'Admin' });
    for (const libraryType of ['Podcast', 'Music']) {
      const res = await request(app)
        .post('/api/libraries')
        .set('Authorization', authHeader)
        .send({ name: 'X', path: '/tmp', libraryType });
      expect(res.status).toBe(400);
    }
  });

  it('creates a library for an Admin', async () => {
    const { authHeader } = await createUser({ role: 'Admin' });
    const res = await request(app)
      .post('/api/libraries')
      .set('Authorization', authHeader)
      .send({ name: 'Films', path: '/tmp', libraryType: 'Film' });
    expect(res.status).toBe(201);
    expect(res.body.library).toMatchObject({ name: 'Films', libraryType: 'Film' });
  });
});
