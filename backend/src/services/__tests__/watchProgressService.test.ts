import { WatchProgressService, isCompleted, MIN_RESUME_POSITION } from '../watchProgressService';
import {
  prisma,
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
  createVideoMedia,
} from '../../test/db';

const service = new WatchProgressService();

describe('isCompleted', () => {
  it('is true at or past 90% and never for zero duration', () => {
    expect(isCompleted(90, 100)).toBe(true);
    expect(isCompleted(89, 100)).toBe(false);
    expect(isCompleted(10, 0)).toBe(false);
  });
});

describe('WatchProgressService', () => {
  beforeEach(resetDatabase);

  async function fixture() {
    const library = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
    const media = await createVideoMedia({ path: '/e1.mkv', duration: 1000, collectionId: show.id });
    const { user } = await createUser();
    return { library, show, media, user };
  }

  it('upserts a position and derives completion from the threshold', async () => {
    const { media, user } = await fixture();

    const first = await service.recordProgress(user.id, media.id, 120.6);
    expect(first).toMatchObject({ position: 121, duration: 1000, completed: false });

    const second = await service.recordProgress(user.id, media.id, 950);
    expect(second).toMatchObject({ position: 950, completed: true });
    expect(second!.id).toBe(first!.id);

    // A rewatch from the start clears the flag again.
    const third = await service.recordProgress(user.id, media.id, 40);
    expect(third!.completed).toBe(false);
  });

  it('prefers a player-supplied duration over the stored one', async () => {
    const { media, user } = await fixture();
    const progress = await service.recordProgress(user.id, media.id, 95, 100);
    expect(progress).toMatchObject({ duration: 100, completed: true });
  });

  it('returns null for unknown media', async () => {
    const { user } = await fixture();
    expect(await service.recordProgress(user.id, 'nope', 10)).toBeNull();
  });

  it('markCompleted and clearProgress round-trip', async () => {
    const { media, user } = await fixture();
    await service.markCompleted(user.id, media.id);
    expect(await service.getProgress(user.id, media.id)).toMatchObject({ completed: true, position: 1000 });
    await service.clearProgress(user.id, media.id);
    expect(await service.getProgress(user.id, media.id)).toBeNull();
  });

  it('lists in-progress items newest first, skipping completed and barely-started ones', async () => {
    const { show, user } = await fixture();
    const a = await createVideoMedia({ path: '/a.mkv', duration: 1000, collectionId: show.id });
    const b = await createVideoMedia({ path: '/b.mkv', duration: 1000, collectionId: show.id });
    const done = await createVideoMedia({ path: '/done.mkv', duration: 1000, collectionId: show.id });
    const barely = await createVideoMedia({ path: '/barely.mkv', duration: 1000, collectionId: show.id });

    await service.recordProgress(user.id, a.id, 100);
    await new Promise((r) => setTimeout(r, 5));
    await service.recordProgress(user.id, b.id, 200);
    await service.recordProgress(user.id, done.id, 990);
    await service.recordProgress(user.id, barely.id, MIN_RESUME_POSITION - 1);

    const items = await service.getContinueWatching(user.id, false);
    expect(items.map((i) => i.mediaId)).toEqual([b.id, a.id]);
    expect(items[0].media.collection?.name).toBe('Show');
  });

  it('hides progress in libraries the user cannot access', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ groupIds: [group.id] });
    const film = await createCollection({ libraryId: restricted.id, name: 'Film' });
    const media = await createVideoMedia({ path: '/f.mkv', duration: 1000, collectionId: film.id });
    const { user: member } = await createUser({ groupIds: [group.id] });
    const { user: outsider } = await createUser();

    await service.recordProgress(member.id, media.id, 100);
    await service.recordProgress(outsider.id, media.id, 100);

    expect((await service.getContinueWatching(member.id, false)).map((i) => i.mediaId)).toEqual([media.id]);
    expect(await service.getContinueWatching(outsider.id, false)).toEqual([]);
    expect((await service.getContinueWatching(outsider.id, true)).map((i) => i.mediaId)).toEqual([media.id]);
  });
});

describe('WatchProgressService batch and summaries', () => {
  beforeEach(resetDatabase);

  it('returns progress keyed by media id, omitting unplayed items', async () => {
    const library = await createLibrary();
    const film = await createCollection({ libraryId: library.id, name: 'F' });
    const a = await createVideoMedia({ path: '/a.mkv', duration: 100, collectionId: film.id });
    const b = await createVideoMedia({ path: '/b.mkv', duration: 100, collectionId: film.id });
    const { user } = await createUser();
    await service.recordProgress(user.id, a.id, 50);

    const batch = await service.getProgressBatch(user.id, [a.id, b.id, 'nope']);
    expect(Object.keys(batch)).toEqual([a.id]);
    expect(batch[a.id].position).toBe(50);
    expect(await service.getProgressBatch(user.id, [])).toEqual({});
  });

  it('rolls up watched, in-progress and resume over a show tree', async () => {
    const library = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
    const s1 = await createCollection({ libraryId: library.id, name: 'S1', collectionType: 'Season', parentId: show.id });
    const s2 = await createCollection({ libraryId: library.id, name: 'S2', collectionType: 'Season', parentId: show.id });
    const e1 = await createVideoMedia({ path: '/e1.mkv', duration: 1000, collectionId: s1.id });
    const e2 = await createVideoMedia({ path: '/e2.mkv', duration: 1000, collectionId: s1.id });
    const e3 = await createVideoMedia({ path: '/e3.mkv', duration: 1000, collectionId: s2.id });
    const { user } = await createUser();
    await service.markCompleted(user.id, e1.id);
    await service.recordProgress(user.id, e2.id, 400);
    await service.recordProgress(user.id, e3.id, 5); // below the resume threshold: neither

    const summaries = await service.getCollectionSummaries(user.id, false, [show.id, s1.id, s2.id, 'missing']);
    expect(summaries[show.id]).toEqual({
      total: 3,
      watched: 1,
      inProgress: 1,
      resume: { mediaId: e2.id, position: 400, duration: 1000 },
    });
    expect(summaries[s1.id]).toMatchObject({ total: 2, watched: 1, inProgress: 1 });
    expect(summaries[s2.id]).toEqual({ total: 1, watched: 0, inProgress: 0 });
    expect(summaries).not.toHaveProperty('missing');
  });

  it('omits collections in libraries the user cannot access', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ groupIds: [group.id] });
    const film = await createCollection({ libraryId: restricted.id, name: 'Secret' });
    await createVideoMedia({ path: '/s.mkv', duration: 10, collectionId: film.id });
    const { user: outsider } = await createUser();
    const { user: admin } = await createUser({ role: 'Admin' });

    expect(await service.getCollectionSummaries(outsider.id, false, [film.id])).toEqual({});
    expect(await service.getCollectionSummaries(admin.id, true, [film.id])).toEqual({
      [film.id]: { total: 1, watched: 0, inProgress: 0 },
    });
  });

  describe('marking a whole collection', () => {
    async function showWithSeasons() {
      const library = await createLibrary({ libraryType: 'Television' });
      const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
      const s1 = await createCollection({
        libraryId: library.id,
        name: 'Season 1',
        collectionType: 'Season',
        parentId: show.id,
      });
      const s2 = await createCollection({
        libraryId: library.id,
        name: 'Season 2',
        collectionType: 'Season',
        parentId: show.id,
      });
      const e1 = await createVideoMedia({ path: '/s1e1.mkv', duration: 1000, collectionId: s1.id });
      const e2 = await createVideoMedia({ path: '/s1e2.mkv', duration: 1000, collectionId: s1.id });
      const e3 = await createVideoMedia({ path: '/s2e1.mkv', duration: 1000, collectionId: s2.id });
      const { user } = await createUser();
      return { show, s1, s2, e1, e2, e3, user };
    }

    it('marks every episode under a season', async () => {
      const { s1, e1, e2, e3, user } = await showWithSeasons();

      expect(await service.markCollectionCompleted(user.id, s1.id)).toBe(2);

      expect(await service.getProgress(user.id, e1.id)).toMatchObject({ completed: true, position: 1000 });
      expect(await service.getProgress(user.id, e2.id)).toMatchObject({ completed: true });
      // The other season is untouched.
      expect(await service.getProgress(user.id, e3.id)).toBeNull();
    });

    it('reaches through the whole subtree from a show', async () => {
      const { show, e1, e3, user } = await showWithSeasons();

      expect(await service.markCollectionCompleted(user.id, show.id)).toBe(3);

      expect(await service.getProgress(user.id, e1.id)).toMatchObject({ completed: true });
      expect(await service.getProgress(user.id, e3.id)).toMatchObject({ completed: true });
    });

    it('overwrites a part-watched position rather than leaving it behind', async () => {
      const { s1, e1, user } = await showWithSeasons();
      await service.recordProgress(user.id, e1.id, 100);

      await service.markCollectionCompleted(user.id, s1.id);

      expect(await service.getProgress(user.id, e1.id)).toMatchObject({ position: 1000, completed: true });
    });

    it('clears the subtree again, reporting what it removed', async () => {
      const { show, s1, e1, e3, user } = await showWithSeasons();
      await service.markCollectionCompleted(user.id, show.id);

      expect(await service.clearCollectionProgress(user.id, s1.id)).toBe(2);

      expect(await service.getProgress(user.id, e1.id)).toBeNull();
      expect(await service.getProgress(user.id, e3.id)).toMatchObject({ completed: true });
    });

    it('leaves another viewer\'s state alone', async () => {
      const { show, e1, user } = await showWithSeasons();
      const { user: other } = await createUser();
      await service.markCollectionCompleted(other.id, show.id);

      await service.clearCollectionProgress(user.id, show.id);

      expect(await service.getProgress(other.id, e1.id)).toMatchObject({ completed: true });
    });

    it('does nothing for an empty collection', async () => {
      const library = await createLibrary({ libraryType: 'Television' });
      const empty = await createCollection({ libraryId: library.id, name: 'Empty', collectionType: 'Show' });
      const { user } = await createUser();

      expect(await service.markCollectionCompleted(user.id, empty.id)).toBe(0);
      expect(await service.clearCollectionProgress(user.id, empty.id)).toBe(0);
    });
  });
});

describe('a collection bigger than SQLite will bind', () => {
  beforeEach(resetDatabase);

  /**
   * More than the 999 parameters SQLite allows in one statement. This is not a
   * hypothetical size: a library page asks for a roll-up over every show at
   * once, and the media beneath them run to thousands. Before the queries were
   * chunked this threw "The query parameter limit supported by your database is
   * exceeded" — reported from a running server, not from a test.
   */
  const OVER_THE_LIMIT = 1100;

  async function bigShow() {
    const library = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({
      libraryId: library.id,
      name: 'Long Runner',
      collectionType: 'Show',
    });
    await prisma.media.createMany({
      data: Array.from({ length: OVER_THE_LIMIT }, (_, i) => ({
        name: `Episode ${i}`,
        path: `/tv/long/${i}.mkv`,
        type: 'Video' as const,
        duration: 1200,
        collectionId: show.id,
      })),
    });
    const { user } = await createUser();
    return { show, user };
  }

  it('rolls up a collection with more items than one statement can name', async () => {
    const { show, user } = await bigShow();

    const summaries = await service.getCollectionSummaries(user.id, true, [show.id]);

    expect(summaries[show.id]).toMatchObject({ total: OVER_THE_LIMIT, watched: 0 });
  });

  it('marks and clears one, counting every row', async () => {
    const { show, user } = await bigShow();

    expect(await service.markCollectionCompleted(user.id, show.id)).toBe(OVER_THE_LIMIT);
    const marked = await service.getCollectionSummaries(user.id, true, [show.id]);
    expect(marked[show.id]).toMatchObject({ watched: OVER_THE_LIMIT });

    expect(await service.clearCollectionProgress(user.id, show.id)).toBe(OVER_THE_LIMIT);
  });

  it('reads progress for more media than one statement can name', async () => {
    const { show, user } = await bigShow();
    await service.markCollectionCompleted(user.id, show.id);
    const ids = (await prisma.media.findMany({ where: { collectionId: show.id }, select: { id: true } })).map(
      (m) => m.id
    );

    const progress = await service.getProgressBatch(user.id, ids);

    expect(Object.keys(progress)).toHaveLength(OVER_THE_LIMIT);
  });
});
