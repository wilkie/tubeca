import { CollectionService } from '../collectionService';
import { resetDatabase, createCollection, createLibrary } from '../../test/db';

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

  // Known bug (specs/content-model.md): relation sorts are applied to each
  // page in memory after SQL orders by createdAt, so ordering is not global.
  // This flips to passing once sorting is pushed into the query.
  it.failing('sorts by release date across pages', async () => {
    const lib = await createLibrary();
    // Insert in reverse chronological order so createdAt disagrees with releaseDate.
    for (const year of [2020, 2010, 2000, 1990]) {
      await createCollection({
        libraryId: lib.id,
        name: String(year),
        filmDetails: { releaseDate: new Date(`${year}-01-01`) },
      });
    }

    const page1 = await service.getPaginatedCollections({
      libraryId: lib.id,
      sortField: 'releaseDate',
      sortDirection: 'asc',
      limit: 2,
      page: 1,
    });
    expect(page1.collections.map((c) => c.name)).toEqual(['1990', '2000']);
  });
});
