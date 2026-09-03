import express from 'express';
import request from 'supertest';
import { authenticate } from '../auth';
import {
  requireLibraryAccess,
  collectionParam,
  mediaParam,
  imageParam,
  entityInBody,
} from '../libraryAccess';
import {
  prisma,
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
  createVideoMedia,
} from '../../test/db';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticate);
  const ok = (_req: express.Request, res: express.Response) => res.json({ ok: true });
  app.get('/collections/:id', requireLibraryAccess(collectionParam('id')), ok);
  app.get('/media/:id', requireLibraryAccess(mediaParam('id')), ok);
  app.get('/images/:id', requireLibraryAccess(imageParam('id')), ok);
  app.post('/body', requireLibraryAccess(entityInBody), ok);
  return app;
}

describe('requireLibraryAccess', () => {
  const app = buildApp();

  beforeEach(resetDatabase);

  async function restrictedFixture() {
    const group = await createGroup();
    const library = await createLibrary({ groupIds: [group.id] });
    const collection = await createCollection({ libraryId: library.id, name: 'Film' });
    const media = await createVideoMedia({ path: '/m.mkv', duration: 10, collectionId: collection.id });
    const member = await createUser({ groupIds: [group.id] });
    const outsider = await createUser();
    const admin = await createUser({ role: 'Admin' });
    return { group, library, collection, media, member, outsider, admin };
  }

  it('lets admins through without resolving anything', async () => {
    const { admin } = await restrictedFixture();
    const res = await request(app).get('/collections/does-not-exist').set('Authorization', admin.authHeader);
    expect(res.status).toBe(200);
  });

  it('allows group members and hides the collection from outsiders with 404', async () => {
    const { collection, member, outsider } = await restrictedFixture();
    expect((await request(app).get(`/collections/${collection.id}`).set('Authorization', member.authHeader)).status).toBe(200);
    expect((await request(app).get(`/collections/${collection.id}`).set('Authorization', outsider.authHeader)).status).toBe(404);
  });

  it('resolves media through its collection', async () => {
    const { media, member, outsider } = await restrictedFixture();
    expect((await request(app).get(`/media/${media.id}`).set('Authorization', member.authHeader)).status).toBe(200);
    expect((await request(app).get(`/media/${media.id}`).set('Authorization', outsider.authHeader)).status).toBe(404);
  });

  it('allows everyone into a public (group-less) library', async () => {
    const library = await createLibrary();
    const collection = await createCollection({ libraryId: library.id, name: 'Open' });
    const { authHeader } = await createUser();
    expect((await request(app).get(`/collections/${collection.id}`).set('Authorization', authHeader)).status).toBe(200);
  });

  it('hides orphaned media (no collection) from non-admins', async () => {
    const media = await createVideoMedia({ path: '/orphan.mkv', duration: 10 });
    const viewer = await createUser();
    const admin = await createUser({ role: 'Admin' });
    expect((await request(app).get(`/media/${media.id}`).set('Authorization', viewer.authHeader)).status).toBe(404);
    expect((await request(app).get(`/media/${media.id}`).set('Authorization', admin.authHeader)).status).toBe(200);
  });

  it('falls through for a missing entity so the handler decides', async () => {
    const { authHeader } = await createUser();
    const res = await request(app).get('/collections/nope').set('Authorization', authHeader);
    expect(res.status).toBe(200); // the stub handler answers; real routes 404 themselves
  });

  it('scopes images by their owning collection or media, and leaves person photos unscoped', async () => {
    const { collection, media, member, outsider } = await restrictedFixture();
    const collectionImage = await prisma.image.create({
      data: { collectionId: collection.id, imageType: 'Poster', path: 'c.jpg' },
    });
    const mediaImage = await prisma.image.create({
      data: { mediaId: media.id, imageType: 'Thumbnail', path: 'm.jpg' },
    });
    const person = await prisma.person.create({ data: { name: 'Someone' } });
    const personImage = await prisma.image.create({
      data: { personId: person.id, imageType: 'Photo', path: 'p.jpg' },
    });

    for (const image of [collectionImage, mediaImage]) {
      expect((await request(app).get(`/images/${image.id}`).set('Authorization', member.authHeader)).status).toBe(200);
      expect((await request(app).get(`/images/${image.id}`).set('Authorization', outsider.authHeader)).status).toBe(404);
    }
    expect((await request(app).get(`/images/${personImage.id}`).set('Authorization', outsider.authHeader)).status).toBe(200);
  });

  it('checks the entity named in a request body', async () => {
    const { collection, library, member, outsider } = await restrictedFixture();
    const post = (auth: string, body: object) =>
      request(app).post('/body').set('Authorization', auth).send(body);

    expect((await post(member.authHeader, { collectionId: collection.id })).status).toBe(200);
    expect((await post(outsider.authHeader, { collectionId: collection.id })).status).toBe(404);
    expect((await post(outsider.authHeader, { libraryId: library.id })).status).toBe(404);
    expect((await post(outsider.authHeader, {})).status).toBe(200);
  });

  it('returns 401 when no user is attached', async () => {
    const res = await request(app).get('/collections/x');
    expect(res.status).toBe(401);
  });
});
