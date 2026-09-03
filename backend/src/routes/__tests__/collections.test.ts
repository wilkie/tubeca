import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { resetDatabase, createGroup, createLibrary, createCollection, createUser } from '../../test/db';

jest.unstable_mockModule('../../queues/collectionScrapeQueue', () => ({
  addCollectionScrapeJob: jest.fn(),
}));
jest.unstable_mockModule('../../plugins/scraperLoader', () => ({
  scraperManager: { getScrapers: () => [], getScraper: () => undefined },
}));

const { default: collectionRoutes } = await import('../collections');

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
});
