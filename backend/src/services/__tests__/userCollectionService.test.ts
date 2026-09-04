import { UserCollectionService } from '../userCollectionService';
import { NotFoundError, ValidationError, ConflictError } from '../errors';
import { prisma, resetDatabase, createUser, createLibrary, createCollection, createVideoMedia } from '../../test/db';

const service = new UserCollectionService();

let ownerId: string;
let strangerId: string;
let libraryId: string;

beforeEach(async () => {
  await resetDatabase();
  ownerId = (await createUser()).user.id;
  strangerId = (await createUser()).user.id;
  libraryId = (await createLibrary({ libraryType: 'Film' })).id;
});

async function aFilm(name = 'Heat') {
  return createCollection({ libraryId, name, collectionType: 'Film' });
}

async function anEpisode(name = 'Pilot') {
  return createVideoMedia({ name, path: `/tv/${name}.mkv`, duration: 100 });
}

describe('ownership', () => {
  it('hides another user collection behind a not-found', async () => {
    const mine = await service.createCollection(ownerId, { name: 'Mine' });

    await expect(service.updateCollection(mine.id, strangerId, { name: 'Yours' })).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(service.deleteCollection(mine.id, strangerId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.addItem(mine.id, strangerId, { mediaId: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('addItem', () => {
  it('needs exactly one reference', async () => {
    const list = await service.createCollection(ownerId, { name: 'List' });
    const film = await aFilm();

    await expect(service.addItem(list.id, ownerId, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.addItem(list.id, ownerId, { collectionId: film.id, mediaId: 'also' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses the same item twice', async () => {
    const list = await service.createCollection(ownerId, { name: 'List' });
    const film = await aFilm();
    await service.addItem(list.id, ownerId, { collectionId: film.id });

    await expect(service.addItem(list.id, ownerId, { collectionId: film.id })).rejects.toBeInstanceOf(
      ConflictError
    );
  });

  it('refuses a collection that contains itself', async () => {
    const list = await service.createCollection(ownerId, { name: 'List' });

    await expect(service.addItem(list.id, ownerId, { userCollectionId: list.id })).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

describe('system collections', () => {
  it('returns the same collection every time rather than making another', async () => {
    const first = await service.getFavoritesCollection(ownerId);
    const second = await service.getFavoritesCollection(ownerId);

    expect(second.id).toBe(first.id);
    expect(await prisma.userCollection.count({ where: { userId: ownerId, systemType: 'Favorites' } })).toBe(1);
  });

  it('gives each user their own', async () => {
    const mine = await service.getFavoritesCollection(ownerId);
    const theirs = await service.getFavoritesCollection(strangerId);

    expect(theirs.id).not.toBe(mine.id);
  });

  it('survives two requests racing to create it', async () => {
    const [a, b] = await Promise.all([
      service.getWatchLaterCollection(ownerId),
      service.getWatchLaterCollection(ownerId),
    ]);

    expect(a.id).toBe(b.id);
    expect(await prisma.userCollection.count({ where: { userId: ownerId, systemType: 'WatchLater' } })).toBe(1);
  });

  it('refuses to be renamed, deleted or added to directly', async () => {
    const favorites = await service.getFavoritesCollection(ownerId);
    const film = await aFilm();

    await expect(
      service.updateCollection(favorites.id, ownerId, { name: 'Renamed' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(service.deleteCollection(favorites.id, ownerId)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.addItem(favorites.id, ownerId, { collectionId: film.id })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('still takes items through the toggle', async () => {
    const film = await aFilm();

    expect(await service.toggleFavorite(ownerId, { collectionId: film.id })).toEqual({ favorited: true });
    expect(await service.toggleFavorite(ownerId, { collectionId: film.id })).toEqual({ favorited: false });
    expect(await service.toggleFavorite(ownerId, { collectionId: film.id })).toEqual({ favorited: true });

    const favorites = await service.getFavoritesCollection(ownerId);
    expect(favorites.items).toHaveLength(1);
  });
});

describe('reorderItems', () => {
  async function listOfThree() {
    const list = await service.createCollection(ownerId, { name: 'Playlist' });
    for (const name of ['A', 'B', 'C']) {
      await service.addItem(list.id, ownerId, { collectionId: (await aFilm(name)).id });
    }
    const items = await prisma.userCollectionItem.findMany({
      where: { userCollectionId: list.id },
      orderBy: { position: 'asc' },
    });
    return { list, ids: items.map((i) => i.id) };
  }

  it('renumbers the items into the order given', async () => {
    const { list, ids } = await listOfThree();

    await service.reorderItems(list.id, ownerId, [ids[2], ids[0], ids[1]]);

    const after = await prisma.userCollectionItem.findMany({
      where: { userCollectionId: list.id },
      orderBy: { position: 'asc' },
    });
    expect(after.map((i) => i.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(after.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it('refuses an item from another collection', async () => {
    const { list, ids } = await listOfThree();
    const other = await service.createCollection(strangerId, { name: 'Theirs' });
    await service.addItem(other.id, strangerId, { collectionId: (await aFilm('Elsewhere')).id });
    const foreign = await prisma.userCollectionItem.findFirstOrThrow({ where: { userCollectionId: other.id } });

    await expect(
      service.reorderItems(list.id, ownerId, [ids[0], ids[1], foreign.id])
    ).rejects.toBeInstanceOf(ValidationError);

    // The other collection's item keeps its position.
    expect((await prisma.userCollectionItem.findUniqueOrThrow({ where: { id: foreign.id } })).position).toBe(0);
  });

  it('refuses a list that repeats an item', async () => {
    const { list, ids } = await listOfThree();

    await expect(service.reorderItems(list.id, ownerId, [ids[0], ids[0], ids[1]])).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('puts a partial list first and keeps the rest behind it', async () => {
    // A viewer who cannot see one of the libraries involved is shown, and
    // therefore sends, fewer items than the collection holds.
    const { list, ids } = await listOfThree();

    await service.reorderItems(list.id, ownerId, [ids[2], ids[0]]);

    const after = await prisma.userCollectionItem.findMany({
      where: { userCollectionId: list.id },
      orderBy: { position: 'asc' },
    });
    expect(after.map((i) => i.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(after.map((i) => i.position)).toEqual([0, 1, 2]);
  });
});

describe('playback queue', () => {
  it('replaces its contents in the order given', async () => {
    const first = await anEpisode('One');
    const second = await anEpisode('Two');

    await service.setPlaybackQueue(ownerId, [{ mediaId: first.id }, { mediaId: second.id }]);
    const queue = await service.setPlaybackQueue(ownerId, [{ mediaId: second.id }]);

    expect(queue.items.map((i) => i.mediaId)).toEqual([second.id]);
  });

  it('holds media, not collections', async () => {
    const film = await aFilm();

    await expect(service.setPlaybackQueue(ownerId, [{ collectionId: film.id }])).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(service.addToPlaybackQueue(ownerId, { collectionId: film.id })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('refuses an item that names nothing', async () => {
    await expect(service.setPlaybackQueue(ownerId, [{}])).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses media that does not exist', async () => {
    await expect(service.setPlaybackQueue(ownerId, [{ mediaId: 'gone' }])).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(service.addToPlaybackQueue(ownerId, { mediaId: 'gone' })).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('refuses the same item twice in one queue', async () => {
    const episode = await anEpisode();

    await expect(
      service.setPlaybackQueue(ownerId, [{ mediaId: episode.id }, { mediaId: episode.id }])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('leaves a bad queue untouched', async () => {
    const good = await anEpisode('Keep');
    await service.setPlaybackQueue(ownerId, [{ mediaId: good.id }]);

    await expect(service.setPlaybackQueue(ownerId, [{ mediaId: 'gone' }])).rejects.toThrow();

    const queue = await service.getPlaybackQueue(ownerId);
    expect(queue.items.map((i) => i.mediaId)).toEqual([good.id]);
  });

  it('appends to the end and ignores a repeat', async () => {
    const first = await anEpisode('One');
    const second = await anEpisode('Two');
    await service.setPlaybackQueue(ownerId, [{ mediaId: first.id }]);

    await service.addToPlaybackQueue(ownerId, { mediaId: second.id });
    const queue = await service.addToPlaybackQueue(ownerId, { mediaId: second.id });

    expect(queue.items.map((i) => i.mediaId)).toEqual([first.id, second.id]);
  });
});
