import { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia } from '../../test/db';
import { ACTIONABLE_STATUSES, getScrapeOverview, listUnmatched } from '../scrapeOverview';

describe('scrape overview', () => {
  beforeEach(resetDatabase);

  /** A library holding one collection per outcome, and one media item each. */
  async function library() {
    const lib = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: lib.id, name: 'Show', collectionType: 'Show' });
    return { lib, show };
  }

  async function collectionWith(
    libraryId: string,
    name: string,
    status: 'Matched' | 'NoMatch' | 'Failed' | 'Pending' | null,
    scrapedAt?: Date,
    parentId?: string
  ) {
    const collection = await createCollection({ libraryId, name, collectionType: 'Season', parentId });
    await prisma.collection.update({
      where: { id: collection.id },
      data: { scrapeStatus: status, scrapeMessage: status ? `${status} because` : null, scrapedAt },
    });
    return collection;
  }

  async function mediaWith(
    collectionId: string,
    name: string,
    status: 'Matched' | 'NoMatch' | 'Failed' | 'Pending' | null,
    scrapedAt?: Date
  ) {
    const media = await createVideoMedia({ name, path: `/${name}.mkv`, duration: 100, collectionId });
    await prisma.media.update({
      where: { id: media.id },
      data: { scrapeStatus: status, scrapeMessage: status ? `${status} because` : null, scrapedAt },
    });
    return media;
  }

  describe('getScrapeOverview', () => {
    it('counts collections and media separately, by outcome', async () => {
      const { lib, show } = await library();
      await collectionWith(lib.id, 'Matched season', 'Matched');
      await collectionWith(lib.id, 'Unmatched season', 'NoMatch');
      await collectionWith(lib.id, 'Never tried', null);
      await mediaWith(show.id, 'a', 'Matched');
      await mediaWith(show.id, 'b', 'Failed');
      await mediaWith(show.id, 'c', 'Failed');

      const overview = await getScrapeOverview(lib.id);

      // The show itself was never scraped, so it counts as unscraped too.
      expect(overview.collections).toEqual({
        Matched: 1,
        NoMatch: 1,
        Failed: 0,
        Pending: 0,
        Unscraped: 2,
      });
      expect(overview.media).toEqual({
        Matched: 1,
        NoMatch: 0,
        Failed: 2,
        Pending: 0,
        Unscraped: 0,
      });
    });

    it('counts nothing from another library', async () => {
      const { lib } = await library();
      const other = await createLibrary({ libraryType: 'Film' });
      await collectionWith(other.id, 'Elsewhere', 'NoMatch');

      expect((await getScrapeOverview(lib.id)).collections.NoMatch).toBe(0);
    });

    it('is all zeroes for an empty library', async () => {
      const empty = await createLibrary({ libraryType: 'Film' });

      const overview = await getScrapeOverview(empty.id);

      expect(overview.collections.Unscraped).toBe(0);
      expect(overview.media.Matched).toBe(0);
    });
  });

  describe('listUnmatched', () => {
    it('lists everything a viewer could act on, and nothing that worked', async () => {
      const { lib, show } = await library();
      await collectionWith(lib.id, 'Unmatched season', 'NoMatch');
      await collectionWith(lib.id, 'Matched season', 'Matched');
      await mediaWith(show.id, 'broken', 'Failed');
      await mediaWith(show.id, 'fine', 'Matched');

      const page = await listUnmatched(lib.id);

      expect(page.items.map((i) => i.name).sort()).toEqual(['Show', 'Unmatched season', 'broken']);
      expect(page.total).toBe(3);
    });

    it('puts the most recent attempt first, and the never-tried last', async () => {
      const { lib, show } = await library();
      await collectionWith(lib.id, 'Older', 'NoMatch', new Date('2026-01-01'));
      await collectionWith(lib.id, 'Newest', 'Failed', new Date('2026-06-01'));
      await mediaWith(show.id, 'Middle', 'NoMatch', new Date('2026-03-01'));

      const page = await listUnmatched(lib.id);

      // 'Show' was never attempted and has no timestamp to rank by.
      expect(page.items.map((i) => i.name)).toEqual(['Newest', 'Middle', 'Older', 'Show']);
    });

    it('says what each item is and what went wrong', async () => {
      const { lib, show } = await library();
      const season = await collectionWith(lib.id, 'Season 1', 'NoMatch', new Date('2026-06-01'), show.id);
      await mediaWith(season.id, 'episode', 'Failed', new Date('2026-05-01'));

      const [first, second] = (await listUnmatched(lib.id)).items;

      expect(first).toMatchObject({
        kind: 'collection',
        name: 'Season 1',
        type: 'Season',
        parentName: 'Show',
        status: 'NoMatch',
        message: 'NoMatch because',
      });
      expect(second).toMatchObject({
        kind: 'media',
        name: 'episode',
        type: 'Video',
        parentName: 'Season 1',
        status: 'Failed',
      });
    });

    it('filters to the statuses asked for', async () => {
      const { lib, show } = await library();
      await collectionWith(lib.id, 'Unmatched', 'NoMatch');
      await mediaWith(show.id, 'broken', 'Failed');

      const failed = await listUnmatched(lib.id, { statuses: ['Failed'] });

      expect(failed.items.map((i) => i.name)).toEqual(['broken']);
      expect(failed.total).toBe(1);
    });

    it('treats "Unscraped" as its own status, since it is stored as nothing', async () => {
      const { lib } = await library();
      await collectionWith(lib.id, 'Unmatched', 'NoMatch');

      const never = await listUnmatched(lib.id, { statuses: ['Unscraped'] });

      // The show from the fixture; the NoMatch season is excluded.
      expect(never.items.map((i) => i.name)).toEqual(['Show']);
    });

    it('can be narrowed to one kind', async () => {
      const { lib, show } = await library();
      await collectionWith(lib.id, 'Unmatched', 'NoMatch');
      await mediaWith(show.id, 'broken', 'Failed');

      const media = await listUnmatched(lib.id, { kind: 'media' });

      expect(media.items.map((i) => i.kind)).toEqual(['media']);
      expect(media.total).toBe(1);
    });

    it('pages across both kinds at once', async () => {
      const { lib, show } = await library();
      for (let i = 0; i < 5; i++) {
        await collectionWith(lib.id, `Season ${i}`, 'NoMatch', new Date(2026, 0, 10 - i));
      }
      for (let i = 0; i < 5; i++) {
        await mediaWith(show.id, `episode ${i}`, 'Failed', new Date(2026, 0, 5 - i));
      }

      const first = await listUnmatched(lib.id, { take: 4 });
      const second = await listUnmatched(lib.id, { skip: 4, take: 4 });

      expect(first.items).toHaveLength(4);
      expect(second.items).toHaveLength(4);
      expect(first.total).toBe(11);
      // No item appears on both pages.
      const ids = new Set([...first.items, ...second.items].map((i) => i.id));
      expect(ids.size).toBe(8);
    });

    it('caps how much can be asked for at once', async () => {
      const { lib } = await library();

      const page = await listUnmatched(lib.id, { take: 5000 });

      expect(page.items.length).toBeLessThanOrEqual(200);
    });

    it('lists the four statuses a viewer can do something about', () => {
      expect(ACTIONABLE_STATUSES).toEqual(['NoMatch', 'Failed', 'Pending', 'Unscraped']);
    });
  });
});
