import { SearchIndexService, toMatchQuery } from '../searchIndexService';
import { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia } from '../../test/db';

const index = new SearchIndexService();

describe('toMatchQuery', () => {
  it('quotes each word and prefix-matches the last', () => {
    expect(toMatchQuery('blade run')).toBe('"blade" "run"*');
    expect(toMatchQuery('heat')).toBe('"heat"*');
  });

  it('strips punctuation that would otherwise be FTS syntax', () => {
    expect(toMatchQuery('"NOT" -x*')).toBe('"not" "x"*');
    expect(toMatchQuery('Spider-Man: No Way Home')).toBe('"spider" "man" "no" "way" "home"*');
  });

  it('has nothing to search for in an empty or symbol-only query', () => {
    expect(toMatchQuery('')).toBeNull();
    expect(toMatchQuery('   ')).toBeNull();
    expect(toMatchQuery('***')).toBeNull();
  });
});

describe('SearchIndexService', () => {
  let libraryId: string;

  beforeEach(async () => {
    await resetDatabase();
    await prisma.$executeRawUnsafe('DELETE FROM search_index');
    const library = await createLibrary({ libraryType: 'Film' });
    libraryId = library.id;
  });

  async function indexedFilm(name: string, extras: {
    description?: string;
    originalTitle?: string;
    contentRating?: string;
    keywords?: string[];
    cast?: string[];
  } = {}) {
    const collection = await createCollection({
      libraryId,
      name,
      collectionType: 'Film',
      keywords: extras.keywords,
      filmDetails: extras.contentRating ? { contentRating: extras.contentRating } : undefined,
    });
    if (extras.description || extras.originalTitle || extras.cast) {
      await prisma.filmDetails.upsert({
        where: { collectionId: collection.id },
        create: {
          collectionId: collection.id,
          description: extras.description,
          originalTitle: extras.originalTitle,
          contentRating: extras.contentRating,
          credits: extras.cast
            ? { create: extras.cast.map((castName) => ({ name: castName, creditType: 'Actor' as const })) }
            : undefined,
        },
        update: {
          description: extras.description,
          originalTitle: extras.originalTitle,
          credits: extras.cast
            ? { create: extras.cast.map((castName) => ({ name: castName, creditType: 'Actor' as const })) }
            : undefined,
        },
      });
    }
    await index.indexCollection(collection.id);
    return collection;
  }

  const search = (query: string, extra: Partial<Parameters<typeof index.search>[0]> = {}) =>
    index.search({ query, entityType: 'collection', limit: 20, offset: 0, ...extra });

  it('finds a title by a word in the middle of it', async () => {
    const film = await indexedFilm('The Empire Strikes Back');

    await expect(search('strikes')).resolves.toEqual({ ids: [film.id], total: 1 });
  });

  it('matches a prefix, so results appear while typing', async () => {
    const film = await indexedFilm('Blade Runner 2049');

    await expect(search('blade runn')).resolves.toMatchObject({ ids: [film.id] });
  });

  it('ignores accents in either the query or the title', async () => {
    const film = await indexedFilm('Amélie');

    await expect(search('amelie')).resolves.toMatchObject({ ids: [film.id] });
  });

  it('finds a film by its cast', async () => {
    const film = await indexedFilm('Heat', { cast: ['Al Pacino', 'Robert De Niro'] });
    await indexedFilm('Collateral');

    await expect(search('pacino')).resolves.toEqual({ ids: [film.id], total: 1 });
  });

  it('finds a film by a keyword', async () => {
    const film = await indexedFilm('Heat', { keywords: ['heist'] });
    await indexedFilm('Amelie');

    await expect(search('heist')).resolves.toEqual({ ids: [film.id], total: 1 });
  });

  it('finds a film by its description and its original title', async () => {
    const film = await indexedFilm('Spirited Away', {
      description: 'A girl wanders into a world of spirits',
      originalTitle: 'Sen to Chihiro no Kamikakushi',
    });

    await expect(search('kamikakushi')).resolves.toMatchObject({ ids: [film.id] });
    await expect(search('wanders')).resolves.toMatchObject({ ids: [film.id] });
  });

  it('ranks a title match above a description match', async () => {
    const titled = await indexedFilm('Heat');
    await indexedFilm('Collateral', { description: 'A cab driver and a hitman in the heat of the night' });

    const hits = await search('heat');

    expect(hits.total).toBe(2);
    expect(hits.ids[0]).toBe(titled.id);
  });

  it('keeps a library the viewer cannot see out of the results', async () => {
    const film = await indexedFilm('Heat');
    const other = await createLibrary({ libraryType: 'Film', name: 'Private' });
    const hidden = await createCollection({ libraryId: other.id, name: 'Heat Two', collectionType: 'Film' });
    await index.indexCollection(hidden.id);

    await expect(search('heat', { libraryIds: [libraryId] })).resolves.toEqual({ ids: [film.id], total: 1 });
    await expect(search('heat', { libraryIds: [] })).resolves.toEqual({ ids: [], total: 0 });
  });

  it('applies the content-rating exclusion', async () => {
    const pg = await indexedFilm('Heat One', { contentRating: 'PG' });
    await indexedFilm('Heat Two', { contentRating: 'R' });

    await expect(search('heat', { excludedRatings: ['R'] })).resolves.toEqual({ ids: [pg.id], total: 1 });
  });

  it('pages through matches', async () => {
    await indexedFilm('Heat One');
    await indexedFilm('Heat Two');
    await indexedFilm('Heat Three');

    const first = await search('heat', { limit: 2, offset: 0 });
    const second = await search('heat', { limit: 2, offset: 2 });

    expect(first.ids).toHaveLength(2);
    expect(second.ids).toHaveLength(1);
    expect(first.total).toBe(3);
    expect(new Set([...first.ids, ...second.ids]).size).toBe(3);
  });

  it('replaces a row rather than adding a second one', async () => {
    const film = await indexedFilm('Heat');
    await prisma.collection.update({ where: { id: film.id }, data: { name: 'Heat Remastered' } });
    await index.indexCollection(film.id);

    await expect(search('heat')).resolves.toEqual({ ids: [film.id], total: 1 });
  });

  it('drops a removed entity from the index', async () => {
    const film = await indexedFilm('Heat');
    await index.remove(film.id);

    await expect(search('heat')).resolves.toEqual({ ids: [], total: 0 });
  });

  it('indexes an episode under its show and season names', async () => {
    const show = await createCollection({ libraryId, name: 'Betty', collectionType: 'Show' });
    const season = await createCollection({
      libraryId,
      name: 'Season 2',
      collectionType: 'Season',
      parentId: show.id,
    });
    const episode = await createVideoMedia({
      name: 'The One With The Thing',
      path: '/tv/Betty/Season 2/e01.mkv',
      duration: 100,
      collectionId: season.id,
    });
    await index.indexMedia(episode.id);

    await expect(search('betty', { entityType: 'media' })).resolves.toMatchObject({ ids: [episode.id] });
    await expect(search('thing', { entityType: 'media' })).resolves.toMatchObject({ ids: [episode.id] });
  });

  it('rebuilds everything that exists', async () => {
    await indexedFilm('Heat');
    await indexedFilm('Amelie');
    await prisma.$executeRawUnsafe('DELETE FROM search_index');
    expect(await index.size()).toBe(0);

    const result = await index.rebuild();

    expect(result.collections).toBe(2);
    expect(await index.size()).toBe(2);
    await expect(search('amelie')).resolves.toMatchObject({ total: 1 });
  });
});
