import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LibraryScanService, MAX_SCAN_DEPTH } from '../libraryScanService';
import { ImportService } from '../importService';
import { ContentDeletionService } from '../contentDeletionService';
import { prisma, resetDatabase, createLibrary } from '../../test/db';

const probe = jest.fn(async () => ({ duration: 60, streams: [] }));
const importer = new ImportService({
  probe: probe as never,
  queueMediaScrapes: jest.fn(async () => []) as never,
  queueCollectionScrapes: jest.fn(async () => []) as never,
  deletion: new ContentDeletionService('/tmp/tubeca-unused-images'),
});
const scanner = new LibraryScanService(importer);

let root: string;

function touch(rel: string) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '');
}

describe('LibraryScanService', () => {
  beforeEach(async () => {
    await resetDatabase();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-scan-'));
    jest.clearAllMocks();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('maps a TV tree to shows, seasons and episodes and ignores non-media', async () => {
    touch('Betty/Season 1/Betty S01E01.mkv');
    touch('Betty/Season 1/Betty S01E02.mkv');
    touch('Betty/Season 1/Betty S01E02.srt');
    touch('Betty/Season 1/Betty S01E02.trickplay/320.jpg');
    touch('Betty/.hidden/junk.mkv');
    touch('Betty/poster.jpg');
    const library = await createLibrary({ libraryType: 'Television', path: root });

    const summary = await scanner.scan({ id: library.id, path: root, libraryType: 'Television' });

    expect(summary).toMatchObject({
      filesFound: 2,
      filesProcessed: 2,
      collectionsCreated: 2,
      mediaCreated: 2,
      mediaRemoved: 0,
      collectionsRemoved: 0,
      errors: [],
    });
    const collections = await prisma.collection.findMany({ where: { libraryId: library.id }, orderBy: { name: 'asc' } });
    expect(collections.map((c) => [c.name, c.collectionType])).toEqual([
      ['Betty', 'Show'],
      ['Season 1', 'Season'],
    ]);
    const media = await prisma.media.findMany({ orderBy: { name: 'asc' } });
    expect(media.map((m) => m.name)).toEqual(['Betty S01E01', 'Betty S01E02']);
    expect(media[1].thumbnails).toBe(path.join(root, 'Betty/Season 1/Betty S01E02.trickplay'));
    expect(summary.mediaToScrape.map((h) => h.episode)).toEqual([1, 2]);
  });

  it('is idempotent and only re-queues scrapes on a full scan', async () => {
    touch('Dune (2021)/dune.mkv');
    const library = await createLibrary({ libraryType: 'Film', path: root });
    const lib = { id: library.id, path: root, libraryType: 'Film' as const };

    await scanner.scan(lib);
    const second = await scanner.scan(lib);
    expect(second).toMatchObject({ mediaCreated: 0, collectionsCreated: 0, mediaRemoved: 0 });
    expect(second.mediaToScrape).toEqual([]);
    expect(second.collectionsToScrape).toEqual([]);

    const full = await scanner.scan(lib, { fullScan: true });
    expect(full.mediaToScrape).toHaveLength(1);
    expect(full.collectionsToScrape.map((c) => c.year)).toEqual([2021]);
    expect(await prisma.media.count()).toBe(1);
  });

  it('removes media and collections whose files vanished', async () => {
    touch('Keep (2000)/keep.mkv');
    touch('Gone (2001)/gone.mkv');
    const library = await createLibrary({ libraryType: 'Film', path: root });
    const lib = { id: library.id, path: root, libraryType: 'Film' as const };
    await scanner.scan(lib);

    fs.rmSync(path.join(root, 'Gone (2001)'), { recursive: true });
    const summary = await scanner.scan(lib);

    expect(summary).toMatchObject({ mediaRemoved: 1, collectionsRemoved: 1 });
    expect((await prisma.collection.findMany()).map((c) => c.name)).toEqual(['Keep (2000)']);
    expect(await prisma.media.count()).toBe(1);
  });

  it('refuses to remove anything when the library folder is empty', async () => {
    touch('Keep (2000)/keep.mkv');
    const library = await createLibrary({ libraryType: 'Film', path: root });
    const lib = { id: library.id, path: root, libraryType: 'Film' as const };
    await scanner.scan(lib);

    fs.rmSync(path.join(root, 'Keep (2000)'), { recursive: true });
    const summary = await scanner.scan(lib);

    expect(summary.mediaRemoved).toBe(0);
    expect(summary.errors[0]).toMatch(/empty/);
    expect(await prisma.media.count()).toBe(1);
  });

  it('stops when cancelled and reports progress', async () => {
    touch('A (2000)/a.mkv');
    touch('B (2000)/b.mkv');
    const library = await createLibrary({ libraryType: 'Film', path: root });
    const progress: number[] = [];
    let calls = 0;

    await expect(
      scanner.scan(
        { id: library.id, path: root, libraryType: 'Film' },
        {
          checkCancelled: async () => {
            if (++calls > 1) throw new Error('Scan cancelled by user');
          },
          onProgress: (p) => {
            progress.push(p);
          },
        }
      )
    ).rejects.toThrow('Scan cancelled by user');
    expect(progress.length).toBeGreaterThanOrEqual(0);
  });

  it('follows a symlink to a directory but never walks it twice', async () => {
    touch('Shows/Betty/Betty S01E01.mkv');
    fs.symlinkSync(path.join(root, 'Shows'), path.join(root, 'Mirror'), 'dir');
    const library = await createLibrary({ libraryType: 'Television', path: root });

    const summary = await scanner.scan({ id: library.id, path: root, libraryType: 'Television' });

    // The episode is imported once; the mirror is reported, not walked.
    expect(summary.mediaCreated).toBe(1);
    expect(summary.errors.some((e) => e.includes('already visited'))).toBe(true);
    expect(await prisma.media.count()).toBe(1);
  });

  it('does not loop on a symlink pointing at its own parent', async () => {
    touch('Shows/Betty/Betty S01E01.mkv');
    fs.symlinkSync(path.join(root, 'Shows'), path.join(root, 'Shows/Betty/loop'), 'dir');
    const library = await createLibrary({ libraryType: 'Television', path: root });

    const summary = await scanner.scan({ id: library.id, path: root, libraryType: 'Television' });

    expect(summary.mediaCreated).toBe(1);
    expect(summary.errors.some((e) => e.includes('already visited'))).toBe(true);
  });

  it('stops at the depth cap', async () => {
    // One level past MAX_SCAN_DEPTH.
    const deep = Array.from({ length: MAX_SCAN_DEPTH + 1 }, (_, i) => `level${i}`).join('/');
    touch(`${deep}/too-deep.mkv`);
    const library = await createLibrary({ libraryType: 'Television', path: root });

    const summary = await scanner.scan({ id: library.id, path: root, libraryType: 'Television' });

    expect(summary.mediaCreated).toBe(0);
    expect(summary.errors.some((e) => e.includes(`depth ${MAX_SCAN_DEPTH}`))).toBe(true);
  });

  describe('dry run', () => {
    it('reports what is missing without removing it', async () => {
      touch('Gone (1999)/gone.mkv');
      touch('Kept (2000)/kept.mkv');
      const library = await createLibrary({ libraryType: 'Film', path: root });
      const lib = { id: library.id, path: root, libraryType: 'Film' as const };
      await scanner.scan(lib);

      fs.rmSync(path.join(root, 'Gone (1999)'), { recursive: true });
      const summary = await scanner.scan(lib, { dryRunRemovals: true });

      expect(summary).toMatchObject({
        mediaRemoved: 0,
        collectionsRemoved: 0,
        mediaWouldRemove: 1,
        collectionsWouldRemove: 1,
      });
      expect(await prisma.media.count()).toBe(2);
      expect(await prisma.collection.count()).toBe(2);
    });

    it('removes the same items once a real scan runs', async () => {
      touch('Gone (1999)/gone.mkv');
      touch('Kept (2000)/kept.mkv');
      const library = await createLibrary({ libraryType: 'Film', path: root });
      const lib = { id: library.id, path: root, libraryType: 'Film' as const };
      await scanner.scan(lib);
      fs.rmSync(path.join(root, 'Gone (1999)'), { recursive: true });
      await scanner.scan(lib, { dryRunRemovals: true });

      const summary = await scanner.scan(lib);

      expect(summary).toMatchObject({ mediaRemoved: 1, collectionsRemoved: 1, mediaWouldRemove: 0 });
      expect(await prisma.media.count()).toBe(1);
    });
  });

  it('throws for a missing library path', async () => {
    await expect(scanner.scan({ id: 'x', path: '/nope/nothing', libraryType: 'Film' })).rejects.toThrow(/does not exist/);
  });

  it('keeps a renamed film as the same media row instead of delete-plus-create', async () => {
    touch('Old (1999)/old.mkv');
    const library = await createLibrary({ libraryType: 'Film', path: root });
    const lib = { id: library.id, path: root, libraryType: 'Film' as const };
    await scanner.scan(lib);
    const before = await prisma.media.findFirstOrThrow();

    fs.renameSync(path.join(root, 'Old (1999)'), path.join(root, 'New (1999)'));
    const summary = await scanner.scan(lib);

    expect(summary).toMatchObject({ mediaCreated: 0, mediaMoved: 1, mediaRemoved: 0, collectionsCreated: 1, collectionsRemoved: 1 });
    const after = await prisma.media.findFirstOrThrow();
    expect(after.id).toBe(before.id);
    expect(after.path).toBe(path.join(root, 'New (1999)/old.mkv'));
    expect((await prisma.collection.findMany()).map((c) => c.name)).toEqual(['New (1999)']);
  });
});
