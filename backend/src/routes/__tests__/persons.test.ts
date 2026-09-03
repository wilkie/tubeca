import personsRouter from '../persons';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function registeredPaths(method: string): string[] {
  return (personsRouter.stack as RouteLayer[])
    .filter((layer) => layer.route && layer.route.methods[method])
    .map((layer) => layer.route!.path);
}

describe('persons router', () => {
  it('registers GET /search before GET /:id so it is reachable', () => {
    const paths = registeredPaths('get');
    expect(paths).toContain('/search');
    expect(paths).toContain('/:id');
    expect(paths.indexOf('/search')).toBeLessThan(paths.indexOf('/:id'));
  });
});

// Filmography scoping needs the real router with its scraper dependency stubbed.
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
} from '../../test/db';

jest.unstable_mockModule('../../plugins/scraperLoader', () => ({
  scraperManager: { get: () => undefined, getScrapers: () => [] },
}));
const { default: scopedPersonsRouter } = await import('../persons');

describe('GET /api/persons/:id filmography scoping', () => {
  const app = express();
  app.use('/api/persons', scopedPersonsRouter);

  beforeEach(resetDatabase);

  it('omits credits from libraries the viewer cannot access', async () => {
    const group = await createGroup();
    const pub = await createLibrary({ name: 'Public' });
    const restricted = await createLibrary({ name: 'Restricted', groupIds: [group.id] });
    const openFilm = await createCollection({ libraryId: pub.id, name: 'Open Film', filmDetails: {} });
    const secretFilm = await createCollection({ libraryId: restricted.id, name: 'Secret Film', filmDetails: {} });
    const person = await prisma.person.create({ data: { name: 'Actor', biography: 'bio' } });
    for (const film of [openFilm, secretFilm]) {
      await prisma.filmCredit.create({
        data: { filmDetailsId: film.filmDetails!.id, personId: person.id, name: 'Actor', creditType: 'Actor' },
      });
    }
    const outsider = await createUser();
    const member = await createUser({ groupIds: [group.id] });

    const titles = async (auth: string) => {
      const res = await request(app).get(`/api/persons/${person.id}`).set('Authorization', auth);
      expect(res.status).toBe(200);
      return (res.body.person.filmography.films as Array<{ collection: { name: string } }>).map((f) => f.collection.name).sort();
    };
    expect(await titles(outsider.authHeader)).toEqual(['Open Film']);
    expect(await titles(member.authHeader)).toEqual(['Open Film', 'Secret Film']);
  });
});
