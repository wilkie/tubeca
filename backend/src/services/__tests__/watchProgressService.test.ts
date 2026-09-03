import { WatchProgressService, isCompleted, MIN_RESUME_POSITION } from '../watchProgressService';
import {
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
});
