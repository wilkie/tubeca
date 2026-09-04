import { syncCollectionSortFields } from '../collectionSortFields';
import { prisma, resetDatabase, createLibrary, createCollection } from '../../test/db';

let libraryId: string;

beforeEach(async () => {
  await resetDatabase();
  libraryId = (await createLibrary({ libraryType: 'Film' })).id;
});

const sortFields = (id: string) =>
  prisma.collection.findUniqueOrThrow({
    where: { id },
    select: { sortReleaseDate: true, sortRating: true, sortRuntime: true },
  });

describe('syncCollectionSortFields', () => {
  it('copies a film details row onto the collection', async () => {
    const collection = await createCollection({ libraryId, name: 'Heat', collectionType: 'Film' });
    await prisma.filmDetails.upsert({
      where: { collectionId: collection.id },
      create: {
        collectionId: collection.id,
        releaseDate: new Date('1995-12-15'),
        rating: 8.3,
        runtime: 170,
      },
      update: { releaseDate: new Date('1995-12-15'), rating: 8.3, runtime: 170 },
    });

    await syncCollectionSortFields(collection.id);

    expect(await sortFields(collection.id)).toEqual({
      sortReleaseDate: new Date('1995-12-15'),
      sortRating: 8.3,
      sortRuntime: 170,
    });
  });

  it('takes a show its date and rating, and leaves runtime empty', async () => {
    const collection = await createCollection({ libraryId, name: 'Betty', collectionType: 'Show' });
    await prisma.showDetails.create({
      data: { collectionId: collection.id, releaseDate: new Date('2019-05-05'), rating: 7.1 },
    });

    await syncCollectionSortFields(collection.id);

    expect(await sortFields(collection.id)).toEqual({
      sortReleaseDate: new Date('2019-05-05'),
      sortRating: 7.1,
      sortRuntime: null,
    });
  });

  it('takes a season its air date', async () => {
    const show = await createCollection({ libraryId, name: 'Betty', collectionType: 'Show' });
    const season = await createCollection({
      libraryId,
      name: 'Season 1',
      collectionType: 'Season',
      parentId: show.id,
    });
    await prisma.seasonDetails.create({
      data: { collectionId: season.id, seasonNumber: 1, releaseDate: new Date('2019-05-05') },
    });

    await syncCollectionSortFields(season.id);

    expect((await sortFields(season.id)).sortReleaseDate).toEqual(new Date('2019-05-05'));
  });

  it('prefers the film row when a collection somehow has two', async () => {
    const collection = await createCollection({ libraryId, name: 'Odd', collectionType: 'Film' });
    await prisma.showDetails.create({
      data: { collectionId: collection.id, releaseDate: new Date('2000-01-01'), rating: 1 },
    });
    await prisma.filmDetails.upsert({
      where: { collectionId: collection.id },
      create: { collectionId: collection.id, releaseDate: new Date('2010-01-01'), rating: 9 },
      update: { releaseDate: new Date('2010-01-01'), rating: 9 },
    });

    await syncCollectionSortFields(collection.id);

    expect(await sortFields(collection.id)).toMatchObject({
      sortReleaseDate: new Date('2010-01-01'),
      sortRating: 9,
    });
  });

  it('clears the keys when the details are cleared', async () => {
    const collection = await createCollection({
      libraryId,
      name: 'Heat',
      collectionType: 'Film',
      filmDetails: { releaseDate: new Date('1995-12-15'), rating: 8.3, runtime: 170 },
    });
    expect((await sortFields(collection.id)).sortRating).toBe(8.3);

    await prisma.filmDetails.update({
      where: { collectionId: collection.id },
      data: { releaseDate: null, rating: null, runtime: null },
    });
    await syncCollectionSortFields(collection.id);

    expect(await sortFields(collection.id)).toEqual({
      sortReleaseDate: null,
      sortRating: null,
      sortRuntime: null,
    });
  });

  it('leaves everything empty for a collection with no details at all', async () => {
    const collection = await createCollection({ libraryId, name: 'Extras', collectionType: 'Generic' });

    await syncCollectionSortFields(collection.id);

    expect(await sortFields(collection.id)).toEqual({
      sortReleaseDate: null,
      sortRating: null,
      sortRuntime: null,
    });
  });

  it('does nothing for a collection that no longer exists', async () => {
    await expect(syncCollectionSortFields('gone')).resolves.toBeUndefined();
  });
});
