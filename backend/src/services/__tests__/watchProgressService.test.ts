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
