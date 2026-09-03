import { CollectionService } from '../collectionService';
import { syncCollectionSortFields } from '../collectionSortFields';
import { prisma, resetDatabase, createCollection, createLibrary } from '../../test/db';

const service = new CollectionService();

describe('CollectionService.getPaginatedCollections', () => {
  beforeEach(resetDatabase);

  it('pages root collections by name and reports hasMore', async () => {
    const lib = await createLibrary();
    for (const name of ['Delta', 'Alpha', 'Charlie', 'Bravo', 'Echo']) {
      await createCollection({ libraryId: lib.id, name });
    }

    const page1 = await service.getPaginatedCollections({ libraryId: lib.id, page: 1, limit: 2 });
    expect(page1.collections.map((c) => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);

    const page3 = await service.getPaginatedCollections({ libraryId: lib.id, page: 3, limit: 2 });
    expect(page3.collections.map((c) => c.name)).toEqual(['Echo']);
    expect(page3.hasMore).toBe(false);
  });

  it('excludes child collections from the root listing', async () => {
    const lib = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: lib.id, name: 'Show', collectionType: 'Show' });
    await createCollection({
      libraryId: lib.id,
      name: 'Season 1',
      collectionType: 'Season',
      parentId: show.id,
    });

    const result = await service.getPaginatedCollections({ libraryId: lib.id });
    expect(result.collections.map((c) => c.name)).toEqual(['Show']);
  });

  it('filters by name substring', async () => {
    const lib = await createLibrary();
    await createCollection({ libraryId: lib.id, name: 'The Matrix' });
    await createCollection({ libraryId: lib.id, name: 'Blade Runner' });

    const result = await service.getPaginatedCollections({ libraryId: lib.id, nameFilter: 'matrix' });
    expect(result.collections.map((c) => c.name)).toEqual(['The Matrix']);
  });

  it('requires every selected keyword (AND semantics)', async () => {
    const lib = await createLibrary();
    const both = await createCollection({ libraryId: lib.id, name: 'Both', keywords: ['noir', 'space'] });
    await createCollection({ libraryId: lib.id, name: 'One', keywords: ['noir'] });
    const keywordIds = both.keywords.map((k) => k.id);

    const result = await service.getPaginatedCollections({ libraryId: lib.id, keywordIds });
    expect(result.collections.map((c) => c.name)).toEqual(['Both']);
  });

  it('keeps unrated collections when excluding a content rating', async () => {
    const lib = await createLibrary();
    await createCollection({ libraryId: lib.id, name: 'Rated R', filmDetails: { contentRating: 'R' } });
    await createCollection({ libraryId: lib.id, name: 'Rated PG', filmDetails: { contentRating: 'PG' } });
    await createCollection({ libraryId: lib.id, name: 'Unrated' });

    const result = await service.getPaginatedCollections({ libraryId: lib.id, excludedRatings: ['R'] });
    expect(result.collections.map((c) => c.name).sort()).toEqual(['Rated PG', 'Unrated']);
  });

  it('sorts by release date within a single page', async () => {
    const lib = await createLibrary();
    await createCollection({ libraryId: lib.id, name: 'Newer', filmDetails: { releaseDate: new Date('2020-01-01') } });
    await createCollection({ libraryId: lib.id, name: 'Older', filmDetails: { releaseDate: new Date('1990-01-01') } });
    await createCollection({ libraryId: lib.id, name: 'Undated' });

    const result = await service.getPaginatedCollections({
      libraryId: lib.id,
      sortField: 'releaseDate',
      sortDirection: 'desc',
    });
    expect(result.collections.map((c) => c.name)).toEqual(['Newer', 'Older', 'Undated']);
  });

  it('sorts by release date across pages, nulls last in both directions', async () => {
    const lib = await createLibrary();
    // Insert in reverse chronological order so createdAt disagrees with releaseDate.
    for (const year of [2020, 2010, 2000, 1990]) {
      await createCollection({
        libraryId: lib.id,
        name: String(year),
        filmDetails: { releaseDate: new Date(`${year}-01-01`) },
      });
    }
    await createCollection({ libraryId: lib.id, name: 'Undated' });

    const page = (opts: { page: number; sortDirection: 'asc' | 'desc' }) =>
      service
        .getPaginatedCollections({ libraryId: lib.id, sortField: 'releaseDate', limit: 2, ...opts })
        .then((r) => r.collections.map((c) => c.name));

    expect(await page({ page: 1, sortDirection: 'asc' })).toEqual(['1990', '2000']);
    expect(await page({ page: 2, sortDirection: 'asc' })).toEqual(['2010', '2020']);
    // The undated item sorts last whichever way the others are ordered.
    expect(await page({ page: 3, sortDirection: 'asc' })).toEqual(['Undated']);
    expect(await page({ page: 1, sortDirection: 'desc' })).toEqual(['2020', '2010']);
    expect(await page({ page: 3, sortDirection: 'desc' })).toEqual(['Undated']);
  });

  it('sorts by rating and runtime across pages', async () => {
    const lib = await createLibrary();
    await createCollection({ libraryId: lib.id, name: 'Low', filmDetails: { rating: 4.1, runtime: 180 } });
    await createCollection({ libraryId: lib.id, name: 'High', filmDetails: { rating: 9.2, runtime: 90 } });
    await createCollection({ libraryId: lib.id, name: 'Mid', filmDetails: { rating: 7.0, runtime: 120 } });

    const first = (sortField: 'rating' | 'runtime', sortDirection: 'asc' | 'desc') =>
      service
        .getPaginatedCollections({ libraryId: lib.id, sortField, sortDirection, limit: 1 })
        .then((r) => r.collections[0].name);

    expect(await first('rating', 'desc')).toBe('High');
    expect(await first('rating', 'asc')).toBe('Low');
    expect(await first('runtime', 'asc')).toBe('High');
    expect(await first('runtime', 'desc')).toBe('Low');
  });

  it('takes the show release date when a collection has no film details', async () => {
    const lib = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: lib.id, name: 'Show', collectionType: 'Show' });
    await prisma.showDetails.create({
      data: { collectionId: show.id, releaseDate: new Date('2005-06-01'), rating: 8.5 },
    });
    await syncCollectionSortFields(show.id);

    const row = await prisma.collection.findUniqueOrThrow({ where: { id: show.id } });
    expect(row.sortReleaseDate).toEqual(new Date('2005-06-01'));
    expect(row.sortRating).toBe(8.5);
    expect(row.sortRuntime).toBeNull();
  });

  it('clears the sort keys when the details row goes away', async () => {
    const lib = await createLibrary();
    const film = await createCollection({
      libraryId: lib.id,
      name: 'Film',
      filmDetails: { releaseDate: new Date('1999-01-01'), rating: 7, runtime: 100 },
    });
    await prisma.filmDetails.delete({ where: { collectionId: film.id } });
    await syncCollectionSortFields(film.id);

    const row = await prisma.collection.findUniqueOrThrow({ where: { id: film.id } });
    expect([row.sortReleaseDate, row.sortRating, row.sortRuntime]).toEqual([null, null, null]);
  });
});
