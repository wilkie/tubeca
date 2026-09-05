import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
  createVideoMedia,
  prisma,
} from '../../test/db';

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

describe('GET /api/libraries/browse', () => {
  let root: string;

  beforeEach(async () => {
    await resetDatabase();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-browse-'));
    fs.mkdirSync(path.join(root, 'Films'));
    fs.mkdirSync(path.join(root, 'Shows'));
    fs.mkdirSync(path.join(root, '.hidden'));
    fs.writeFileSync(path.join(root, 'notes.txt'), '');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('lists folders only, without hidden ones', async () => {
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).get('/api/libraries/browse').query({ path: root }).set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.directories.map((d: { name: string }) => d.name)).toEqual(['Films', 'Shows']);
    expect(res.body.path).toBe(fs.realpathSync(root) === root ? root : root);
    expect(res.body.parent).toBe(path.dirname(root));
  });

  it('is admin only', async () => {
    const { authHeader } = await createUser({ role: 'Editor' });

    const res = await request(app).get('/api/libraries/browse').query({ path: root }).set('Authorization', authHeader);

    expect(res.status).toBe(403);
  });

  it('rejects a relative path', async () => {
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).get('/api/libraries/browse').query({ path: 'films' }).set('Authorization', authHeader);

    expect(res.status).toBe(400);
  });

  it('reports a path that is not a directory', async () => {
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app)
      .get('/api/libraries/browse')
      .query({ path: path.join(root, 'notes.txt') })
      .set('Authorization', authHeader);

    expect(res.status).toBe(404);
  });

  it('is not shadowed by the library-by-id route', async () => {
    const { authHeader } = await createUser({ role: 'Admin' });

    const res = await request(app).get('/api/libraries/browse').set('Authorization', authHeader);

    // No path given: the filesystem root, which always has a listing.
    expect(res.status).toBe(200);
    expect(res.body.parent).toBeNull();
  });
});

describe('the scrape outcomes of a library', () => {
  beforeEach(resetDatabase);

  /** A library with one matched season, one unmatched, and a failed episode. */
  async function fixture(groupIds: string[] = []) {
    const library = await createLibrary({ libraryType: 'Television', groupIds });
    const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
    const matched = await createCollection({ libraryId: library.id, name: 'Season 1', collectionType: 'Season', parentId: show.id });
    const unmatched = await createCollection({ libraryId: library.id, name: 'Season 2', collectionType: 'Season', parentId: show.id });
    const episode = await createVideoMedia({ name: 'Pilot', path: '/pilot.mkv', duration: 100, collectionId: matched.id });
    await prisma.collection.update({ where: { id: matched.id }, data: { scrapeStatus: 'Matched' } });
    await prisma.collection.update({
      where: { id: unmatched.id },
      data: { scrapeStatus: 'NoMatch', scrapeMessage: 'Nothing scored high enough', scrapedAt: new Date() },
    });
    await prisma.media.update({ where: { id: episode.id }, data: { scrapeStatus: 'Failed' } });
    return { library, unmatched };
  }

  describe('GET /:id/scrape-status', () => {
    it('counts what landed and what did not', async () => {
      const { library } = await fixture();
      const { authHeader } = await createUser();

      const res = await request(app)
        .get(`/api/libraries/${library.id}/scrape-status`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.collections).toMatchObject({ Matched: 1, NoMatch: 1, Unscraped: 1 });
      expect(res.body.media).toMatchObject({ Failed: 1 });
    });

    it('is not there for a library the viewer cannot see', async () => {
      const group = await createGroup();
      const { library } = await fixture([group.id]);
      const { authHeader } = await createUser();

      const res = await request(app)
        .get(`/api/libraries/${library.id}/scrape-status`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('needs a token', async () => {
      const { library } = await fixture();

      expect((await request(app).get(`/api/libraries/${library.id}/scrape-status`)).status).toBe(401);
    });
  });

  describe('GET /:id/unmatched', () => {
    it('lists the items and what went wrong with each', async () => {
      const { library } = await fixture();
      const { authHeader } = await createUser();

      const res = await request(app)
        .get(`/api/libraries/${library.id}/unmatched`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.items[0]).toMatchObject({
        kind: 'collection',
        name: 'Season 2',
        status: 'NoMatch',
        message: 'Nothing scored high enough',
        parentName: 'Show',
      });
      // The show and the failed episode are in there too; the matched season is not.
      expect(res.body.items.map((i: { name: string }) => i.name)).not.toContain('Season 1');
      expect(res.body.total).toBe(3);
    });

    it('narrows to the requested statuses and kind', async () => {
      const { library } = await fixture();
      const { authHeader } = await createUser();

      const res = await request(app)
        .get(`/api/libraries/${library.id}/unmatched?status=Failed&kind=media`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['Pilot']);
    });

    it('refuses a status or kind it does not know', async () => {
      const { library } = await fixture();
      const { authHeader } = await createUser();

      const bad = await request(app)
        .get(`/api/libraries/${library.id}/unmatched?status=Sideways`)
        .set('Authorization', authHeader);
      expect(bad.status).toBe(400);
      expect(bad.body.error).toContain('Sideways');

      const wrongKind = await request(app)
        .get(`/api/libraries/${library.id}/unmatched?kind=person`)
        .set('Authorization', authHeader);
      expect(wrongKind.status).toBe(400);
    });

    it('is not there for a library the viewer cannot see', async () => {
      const group = await createGroup();
      const { library } = await fixture([group.id]);
      const { authHeader } = await createUser();

      const res = await request(app)
        .get(`/api/libraries/${library.id}/unmatched`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });
  });
});
