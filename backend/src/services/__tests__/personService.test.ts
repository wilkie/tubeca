import { PersonService } from '../personService';
import { prisma, resetDatabase, createLibrary, createCollection } from '../../test/db';

const service = new PersonService();

beforeEach(resetDatabase);

describe('findOrCreatePerson', () => {
  it('creates a person the first time a credit names them', async () => {
    const person = await service.findOrCreatePerson({ name: 'Al Pacino', type: 'actor', tmdbId: 1158 });

    expect(person).toMatchObject({ name: 'Al Pacino', tmdbId: 1158 });
    expect(await prisma.person.count()).toBe(1);
  });

  it('matches on IMDB id before anything else, even under a different name', async () => {
    // A provider that spells the name differently must not create a second row.
    const existing = await prisma.person.create({
      data: { name: 'Al Pacino', imdbId: 'nm0000199', tmdbId: 1158 },
    });

    const found = await service.findOrCreatePerson({
      name: 'Alfredo Pacino',
      type: 'actor',
      imdbId: 'nm0000199',
    });

    expect(found.id).toBe(existing.id);
    expect(await prisma.person.count()).toBe(1);
  });

  it('matches on TMDB id when there is no IMDB id to go on', async () => {
    const existing = await prisma.person.create({ data: { name: 'Robert De Niro', tmdbId: 380 } });

    const found = await service.findOrCreatePerson({ name: 'Robert DeNiro', type: 'actor', tmdbId: 380 });

    expect(found.id).toBe(existing.id);
  });

  it('matches on TVDB id when that is all either side has', async () => {
    const existing = await prisma.person.create({ data: { name: 'Someone', tvdbId: 4242 } });

    const found = await service.findOrCreatePerson({ name: 'Someone Else', type: 'actor', tvdbId: 4242 });

    expect(found.id).toBe(existing.id);
  });

  it('prefers the IMDB match over a different person with the same name', async () => {
    const byName = await prisma.person.create({ data: { name: 'John Smith' } });
    const byImdb = await prisma.person.create({ data: { name: 'John Smith (II)', imdbId: 'nm0000123' } });

    const found = await service.findOrCreatePerson({
      name: 'John Smith',
      type: 'actor',
      imdbId: 'nm0000123',
    });

    expect(found.id).toBe(byImdb.id);
    expect(found.id).not.toBe(byName.id);
  });

  it('falls back to an exact name, which is how two namesakes become one person', async () => {
    // Documented behaviour rather than desired: with no external ids there is
    // nothing else to go on, so two different John Smiths collapse into one.
    const existing = await prisma.person.create({ data: { name: 'John Smith' } });

    const found = await service.findOrCreatePerson({ name: 'John Smith', type: 'director' });

    expect(found.id).toBe(existing.id);
    expect(await prisma.person.count()).toBe(1);
  });

  it('does not match a name that differs by case or spacing', async () => {
    await prisma.person.create({ data: { name: 'Al Pacino' } });

    await service.findOrCreatePerson({ name: 'al pacino', type: 'actor' });

    expect(await prisma.person.count()).toBe(2);
  });

  it('fills in ids it did not have before', async () => {
    const existing = await prisma.person.create({ data: { name: 'Al Pacino', tmdbId: 1158 } });

    const found = await service.findOrCreatePerson({
      name: 'Al Pacino',
      type: 'actor',
      tmdbId: 1158,
      imdbId: 'nm0000199',
      tvdbId: 77,
    });

    expect(found.id).toBe(existing.id);
    expect(found).toMatchObject({ imdbId: 'nm0000199', tvdbId: 77 });
  });

  it('never overwrites an id it already holds', async () => {
    const existing = await prisma.person.create({
      data: { name: 'Al Pacino', tmdbId: 1158, imdbId: 'nm0000199' },
    });

    const found = await service.findOrCreatePerson({
      name: 'Al Pacino',
      type: 'actor',
      tmdbId: 1158,
      imdbId: 'nm-different',
    });

    expect(found.id).toBe(existing.id);
    expect(found.imdbId).toBe('nm0000199');
  });
});

describe('searchByName', () => {
  beforeEach(async () => {
    await prisma.person.createMany({
      data: [{ name: 'Al Pacino' }, { name: 'Robert De Niro' }, { name: 'Alfre Woodard' }],
    });
  });

  it('matches a substring and orders by name', async () => {
    const results = await service.searchByName('al');

    expect(results.map((p) => p.name)).toEqual(['Al Pacino', 'Alfre Woodard']);
  });

  it('returns the photo alongside the person', async () => {
    const person = await prisma.person.findFirstOrThrow({ where: { name: 'Al Pacino' } });
    await prisma.image.create({
      data: { personId: person.id, imageType: 'Photo', isPrimary: true, path: 'people/p/photo.jpg' },
    });

    const [first] = await service.searchByName('Al Pacino');

    expect(first.images).toHaveLength(1);
  });

  it('honours the limit', async () => {
    expect(await service.searchByName('a', 1)).toHaveLength(1);
  });

  it('finds nothing for a name nobody has', async () => {
    expect(await service.searchByName('Nobody')).toEqual([]);
  });
});

describe('getPersonById', () => {
  async function personWithFilmCredit(libraryId: string) {
    const person = await prisma.person.create({ data: { name: 'Al Pacino' } });
    const collection = await createCollection({ libraryId, name: 'Heat', collectionType: 'Film' });
    await prisma.filmDetails.upsert({
      where: { collectionId: collection.id },
      create: {
        collectionId: collection.id,
        credits: { create: [{ name: 'Al Pacino', creditType: 'Actor', personId: person.id }] },
      },
      update: {
        credits: { create: [{ name: 'Al Pacino', creditType: 'Actor', personId: person.id }] },
      },
    });
    return { person, collection };
  }

  it('returns the person with their filmography', async () => {
    const library = await createLibrary({ libraryType: 'Film' });
    const { person, collection } = await personWithFilmCredit(library.id);

    const found = await service.getPersonById(person.id);

    expect(found?.name).toBe('Al Pacino');
    expect(found?.filmography.films.map((f) => f.collection.id)).toEqual([collection.id]);
  });

  it('leaves out credits in libraries the viewer cannot see', async () => {
    const library = await createLibrary({ libraryType: 'Film' });
    const { person } = await personWithFilmCredit(library.id);

    const found = await service.getPersonById(person.id, []);

    expect(found?.filmography.films).toEqual([]);
  });

  it('is null for someone who does not exist', async () => {
    expect(await service.getPersonById('nobody')).toBeNull();
  });
});
