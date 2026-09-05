import { jest } from '@jest/globals';
import {
  ImportService,
  buildMediaHints,
  buildCollectionHints,
  shouldScrapeMedia,
} from '../importService';
import { ContentDeletionService } from '../contentDeletionService';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia, createUser } from '../../test/db';

const probe = jest.fn(async () => ({
  duration: 1234,
  streams: [
    { streamIndex: 0, streamType: 'Video', codec: 'h264', isDefault: true, isForced: false },
    { streamIndex: 1, streamType: 'Audio', codec: 'aac', language: 'eng', isDefault: true, isForced: false },
  ],
}));
const queueMediaScrapes = jest.fn(async () => []);
const queueCollectionScrapes = jest.fn(async () => []);

const service = new ImportService({
  probe: probe as never,
  queueMediaScrapes: queueMediaScrapes as never,
  queueCollectionScrapes: queueCollectionScrapes as never,
  deletion: new ContentDeletionService('/tmp/tubeca-unused-images'),
});

describe('buildMediaHints', () => {
  it('detects episodes and takes the show name from the folder chain', () => {
    expect(buildMediaHints('m', 'Television', 'S01E02 - Pilot', ['Betty', 'Season 1'], 'Video')).toMatchObject({
      name: 'S01E02 - Pilot',
      season: 1,
      episode: 2,
      showName: 'Betty',
    });
  });

  it('names film media after the folder and pulls the year from it', () => {
    expect(buildMediaHints('m', 'Film', 'the.matrix.1999.1080p', ['The Matrix (1999)'], 'Video')).toEqual({
      id: 'm',
      name: 'The Matrix (1999)',
      type: 'Video',
      year: 1999,
    });
  });

  it('does not mistake a leading number in a folder for a year', () => {
    expect(buildMediaHints('m', 'Film', 'file', ['2001 A Space Odyssey'], 'Video').year).toBeUndefined();
  });

  it('adds no video hints for audio', () => {
    expect(buildMediaHints('m', 'Music', 'track01', ['Artist', 'Album'], 'Audio')).toEqual({
      id: 'm',
      name: 'track01',
      type: 'Audio',
    });
  });
});

describe('buildCollectionHints', () => {
  it('parses season numbers and film years', () => {
    expect(buildCollectionHints('c', 'Season 3', 'Season', 'p').seasonNumber).toBe(3);
    expect(buildCollectionHints('c', 'Blade Runner (1982)', 'Film', null).year).toBe(1982);
    expect(buildCollectionHints('c', 'Extras', 'Generic', 'p')).toEqual({
      id: 'c',
      name: 'Extras',
      collectionType: 'Generic',
      parentId: 'p',
    });
  });
});

describe('shouldScrapeMedia', () => {
  it('scrapes media only for Television libraries', () => {
    expect(shouldScrapeMedia('Film')).toBe(false);
    expect(shouldScrapeMedia('Television')).toBe(true);
    expect(shouldScrapeMedia('Music')).toBe(false);
  });
});

describe('ImportService', () => {
  beforeEach(async () => {
    await resetDatabase();
    jest.clearAllMocks();
  });

  it('ensureCollectionPath creates the chain with layout types and is idempotent', async () => {
    const library = await createLibrary({ libraryType: 'Television' });
    const first = await service.ensureCollectionPath(library.id, 'Television', ['Betty', 'Season 1']);
    expect(first.collections.map((c) => [c.collectionType, c.created])).toEqual([
      ['Show', true],
      ['Season', true],
    ]);
    expect(first.collections[1].hints.seasonNumber).toBe(1);

    const second = await service.ensureCollectionPath(library.id, 'Television', ['Betty', 'Season 1']);
    expect(second.leafId).toBe(first.leafId);
    expect(second.collections.every((c) => !c.created)).toBe(true);
    expect(await prisma.collection.count({ where: { libraryId: library.id } })).toBe(2);
  });

  it('re-types an existing collection when the layout rule disagrees', async () => {
    const library = await createLibrary({ libraryType: 'Television' });
    const generic = await createCollection({ libraryId: library.id, name: 'Betty', collectionType: 'Generic' });
    const ensured = await service.ensureCollection(library.id, 'Television', 'Betty', null, 0);
    expect(ensured.id).toBe(generic.id);
    expect(ensured.collectionType).toBe('Show');
    expect((await prisma.collection.findUnique({ where: { id: generic.id } }))!.collectionType).toBe('Show');
  });

  it('importMediaFile probes, stores streams and is idempotent on path', async () => {
    const library = await createLibrary({ libraryType: 'Television' });
    const { leafId } = await service.ensureCollectionPath(library.id, 'Television', ['Betty', 'Season 1']);

    const first = await service.importMediaFile({
      libraryId: library.id,
      libraryType: 'Television',
      filePath: '/lib/Betty/Season 1/Betty S01E02.mkv',
      parentCollectionId: leafId,
      collectionPath: ['Betty', 'Season 1'],
    });
    expect(first.created).toBe(true);
    expect(first.hints).toMatchObject({ season: 1, episode: 2, showName: 'Betty' });
    expect(probe).toHaveBeenCalledTimes(1);

    const stored = await prisma.media.findUnique({ where: { id: first.mediaId }, include: { streams: true } });
    expect(stored).toMatchObject({ duration: 1234, type: 'Video', collectionId: leafId });
    expect(stored!.streams).toHaveLength(2);

    const again = await service.importMediaFile({
      libraryId: library.id,
      libraryType: 'Television',
      filePath: '/lib/Betty/Season 1/Betty S01E02.mkv',
      parentCollectionId: leafId,
      collectionPath: ['Betty', 'Season 1'],
    });
    expect(again).toMatchObject({ mediaId: first.mediaId, created: false });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('queues media scrapes except for Film libraries', async () => {
    const hints = [{ id: 'm', name: 'X', type: 'Video' as const, year: 2000 }];
    expect(await service.queueMediaScrapes('Film', hints)).toBe(0);
    expect(queueMediaScrapes).not.toHaveBeenCalled();
    expect(await service.queueMediaScrapes('Television', hints)).toBe(1);
    expect(queueMediaScrapes).toHaveBeenCalledWith([
      { mediaId: 'm', mediaName: 'X', mediaType: 'Video', year: 2000, showName: undefined, season: undefined, episode: undefined },
    ]);
  });

  it('queues collection scrapes parents first and skips Generic, Artist and Album', async () => {
    await service.queueCollectionScrapes([
      buildCollectionHints('s1', 'Season 1', 'Season', 'show'),
      buildCollectionHints('x', 'Extras', 'Generic', 'show'),
      buildCollectionHints('show', 'Betty', 'Show', null),
      buildCollectionHints('f', 'Dune (2021)', 'Film', null),
      buildCollectionHints('artist', 'Radiohead', 'Artist', null),
      buildCollectionHints('album', 'OK Computer', 'Album', 'artist'),
    ]);
    const jobs = (queueCollectionScrapes.mock.calls[0] as unknown[])[0] as Array<{ collectionId: string; parentShowId?: string; year?: number }>;
    expect(jobs.map((j) => j.collectionId)).toEqual(['show', 's1', 'f']);
    expect(jobs[1].parentShowId).toBe('show');
    expect(jobs[2].year).toBe(2021);
  });

  it('removeMissing deletes what the walk did not see', async () => {
    const library = await createLibrary();
    const keep = await createCollection({ libraryId: library.id, name: 'Keep' });
    const gone = await createCollection({ libraryId: library.id, name: 'Gone' });
    const keptMedia = await createVideoMedia({ path: '/k.mkv', duration: 1, collectionId: keep.id });
    const staleMedia = await createVideoMedia({ path: '/stale.mkv', duration: 1, collectionId: keep.id });
    await createVideoMedia({ path: '/g.mkv', duration: 1, collectionId: gone.id });

    const removed = await service.removeMissing(library.id, new Set([keep.id]), new Set([keptMedia.id]));
    expect(removed).toEqual({ collections: 1, media: 2 });
    expect(await prisma.collection.findUnique({ where: { id: gone.id } })).toBeNull();
    expect(await prisma.media.findUnique({ where: { id: staleMedia.id } })).toBeNull();
    expect(await prisma.media.findUnique({ where: { id: keptMedia.id } })).not.toBeNull();
  });

  describe('external subtitles', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-subs-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    async function importVideo(name = 'Betty S01E01.mkv') {
      const library = await createLibrary({ libraryType: 'Television' });
      const filePath = path.join(dir, name);
      fs.writeFileSync(filePath, '');
      const imported = await service.importMediaFile({
        libraryId: library.id,
        libraryType: 'Television',
        filePath,
        parentCollectionId: null,
        collectionPath: [],
      });
      return { libraryId: library.id, filePath, mediaId: imported.mediaId };
    }

    it('imports a sidecar found next to the video', async () => {
      fs.writeFileSync(path.join(dir, 'Betty S01E01.eng.forced.srt'), '');
      const { mediaId } = await importVideo();

      const streams = await prisma.mediaStream.findMany({ where: { mediaId, streamType: 'Subtitle' } });
      expect(streams).toHaveLength(1);
      expect(streams[0]).toMatchObject({
        streamIndex: -1,
        codec: 'subrip',
        language: 'eng',
        isForced: true,
        externalPath: path.join(dir, 'Betty S01E01.eng.forced.srt'),
      });
    });

    it('numbers sidecars below the container streams', async () => {
      fs.writeFileSync(path.join(dir, 'Betty S01E01.en.srt'), '');
      fs.writeFileSync(path.join(dir, 'Betty S01E01.fr.srt'), '');
      const { mediaId } = await importVideo();

      const streams = await prisma.mediaStream.findMany({
        where: { mediaId, streamType: 'Subtitle' },
        orderBy: { streamIndex: 'desc' },
      });
      expect(streams.map((s) => s.streamIndex)).toEqual([-1, -2]);
    });

    it('picks up a subtitle added after the video was imported', async () => {
      const { mediaId, filePath } = await importVideo();
      expect(await prisma.mediaStream.count({ where: { mediaId, streamType: 'Subtitle' } })).toBe(0);

      fs.writeFileSync(path.join(dir, 'Betty S01E01.en.srt'), '');
      const result = await service.syncExternalSubtitles(mediaId, filePath);

      expect(result).toEqual({ added: 1, removed: 0 });
    });

    it('drops a subtitle that was deleted from disk', async () => {
      const sidecar = path.join(dir, 'Betty S01E01.en.srt');
      fs.writeFileSync(sidecar, '');
      const { mediaId, filePath } = await importVideo();

      fs.rmSync(sidecar);
      const result = await service.syncExternalSubtitles(mediaId, filePath);

      expect(result).toEqual({ added: 0, removed: 1 });
      expect(await prisma.mediaStream.count({ where: { mediaId, streamType: 'Subtitle' } })).toBe(0);
    });

    it('does not duplicate a sidecar on a second scan', async () => {
      fs.writeFileSync(path.join(dir, 'Betty S01E01.en.srt'), '');
      const { mediaId, filePath, libraryId } = await importVideo();

      await service.importMediaFile({
        libraryId,
        libraryType: 'Television',
        filePath,
        parentCollectionId: null,
        collectionPath: [],
      });

      expect(await prisma.mediaStream.count({ where: { mediaId, streamType: 'Subtitle' } })).toBe(1);
    });

    it('keeps sidecars when the video itself is re-probed', async () => {
      fs.writeFileSync(path.join(dir, 'Betty S01E01.en.srt'), '');
      const { mediaId, filePath } = await importVideo();

      await service.reprobeMediaFile(filePath);

      const streams = await prisma.mediaStream.findMany({ where: { mediaId, streamType: 'Subtitle' } });
      expect(streams).toHaveLength(1);
      expect(streams[0].externalPath).toBe(path.join(dir, 'Betty S01E01.en.srt'));
    });
  });

  describe('reprobeMediaFile', () => {
    it('refreshes duration and streams for a file that was re-encoded', async () => {
      const library = await createLibrary({ libraryType: 'Television' });
      const { leafId } = await service.ensureCollectionPath(library.id, 'Television', ['Betty', 'Season 1']);
      const filePath = '/lib/Betty/Season 1/Betty S01E01.mkv';
      const imported = await service.importMediaFile({
        libraryId: library.id,
        libraryType: 'Television',
        filePath,
        parentCollectionId: leafId,
        collectionPath: ['Betty', 'Season 1'],
      });

      probe.mockResolvedValueOnce({
        duration: 2000,
        streams: [
          { streamIndex: 0, streamType: 'Video', codec: 'hevc', isDefault: true, isForced: false },
          { streamIndex: 1, streamType: 'Audio', codec: 'opus', language: 'eng', isDefault: true, isForced: false },
          { streamIndex: 2, streamType: 'Subtitle', codec: 'subrip', language: 'eng', isDefault: false, isForced: false },
        ],
      } as never);

      const result = await service.reprobeMediaFile(filePath);

      expect(result).toEqual({ updated: true, streams: 3 });
      const stored = await prisma.media.findUniqueOrThrow({
        where: { id: imported.mediaId },
        include: { streams: { orderBy: { streamIndex: 'asc' } } },
      });
      expect(stored.duration).toBe(2000);
      expect(stored.streams.map((s) => s.codec)).toEqual(['hevc', 'opus', 'subrip']);
    });

    it('keeps the row, its name and its collection', async () => {
      const library = await createLibrary({ libraryType: 'Television' });
      const { leafId } = await service.ensureCollectionPath(library.id, 'Television', ['Betty', 'Season 1']);
      const filePath = '/lib/Betty/Season 1/Betty S01E01.mkv';
      const imported = await service.importMediaFile({
        libraryId: library.id,
        libraryType: 'Television',
        filePath,
        parentCollectionId: leafId,
        collectionPath: ['Betty', 'Season 1'],
      });
      await prisma.media.update({ where: { id: imported.mediaId }, data: { name: 'Scraped Title' } });

      await service.reprobeMediaFile(filePath);

      const stored = await prisma.media.findUniqueOrThrow({ where: { id: imported.mediaId } });
      expect(stored.name).toBe('Scraped Title');
      expect(stored.collectionId).toBe(leafId);
    });

    it('does nothing for a path it has never imported', async () => {
      const result = await service.reprobeMediaFile('/lib/unknown.mkv');

      expect(result).toEqual({ updated: false, streams: 0 });
      expect(probe).not.toHaveBeenCalled();
    });
  });

  describe('rename detection', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-rename-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    async function importAt(libraryId: string, file: string, collectionId: string | null) {
      return service.importMediaFile({
        libraryId,
        libraryType: 'Film',
        filePath: file,
        parentCollectionId: collectionId,
        collectionPath: [path.basename(path.dirname(file))],
      });
    }

    it('re-points a row when its file reappears under a new path with the same size and mtime', async () => {
      const library = await createLibrary({ libraryType: 'Film', path: dir });
      const film = await createCollection({ libraryId: library.id, name: 'Heat (1995)' });
      const oldPath = path.join(dir, 'Heat (1995)', 'heat.mkv');
      fs.mkdirSync(path.dirname(oldPath), { recursive: true });
      fs.writeFileSync(oldPath, 'video-bytes');

      const first = await importAt(library.id, oldPath, film.id);
      expect(first.created).toBe(true);
      await prisma.media.update({ where: { id: first.mediaId }, data: { scrapeStatus: 'Matched', name: 'Heat' } });
      const { user } = await createUser();
      await prisma.watchProgress.create({ data: { userId: user.id, mediaId: first.mediaId, position: 10, duration: 100 } });

      const newPath = path.join(dir, 'Heat (1995)', 'Heat.1995.Remux.mkv');
      fs.renameSync(oldPath, newPath);
      const second = await importAt(library.id, newPath, film.id);

      expect(second).toMatchObject({ mediaId: first.mediaId, created: false, moved: true, scrapeStatus: 'Matched' });
      const row = await prisma.media.findUnique({ where: { id: first.mediaId }, include: { watchProgress: true } });
      expect(row!.path).toBe(newPath);
      expect(row!.name).toBe('Heat');
      expect(row!.watchProgress).toHaveLength(1);
      expect(probe).toHaveBeenCalledTimes(1);
    });

    it('takes the new name for a moved file that was never matched', async () => {
      const library = await createLibrary({ libraryType: 'Film', path: dir });
      const film = await createCollection({ libraryId: library.id, name: 'Old Name (2001)' });
      const oldPath = path.join(dir, 'Old Name (2001)', 'a.mkv');
      fs.mkdirSync(path.dirname(oldPath), { recursive: true });
      fs.writeFileSync(oldPath, 'x');
      const first = await importAt(library.id, oldPath, film.id);

      const better = await createCollection({ libraryId: library.id, name: 'Better Name (2001)' });
      const newPath = path.join(dir, 'Better Name (2001)', 'a.mkv');
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      fs.renameSync(oldPath, newPath);
      const second = await importAt(library.id, newPath, better.id);

      expect(second.moved).toBe(true);
      const row = await prisma.media.findUnique({ where: { id: first.mediaId } });
      expect(row).toMatchObject({ path: newPath, collectionId: better.id, name: 'Better Name (2001)' });
    });

    it('treats a copy (old file still present) as a new item', async () => {
      const library = await createLibrary({ libraryType: 'Film', path: dir });
      const film = await createCollection({ libraryId: library.id, name: 'F' });
      const a = path.join(dir, 'F', 'a.mkv');
      fs.mkdirSync(path.dirname(a), { recursive: true });
      fs.writeFileSync(a, 'same');
      const first = await importAt(library.id, a, film.id);
      const b = path.join(dir, 'F', 'b.mkv');
      fs.copyFileSync(a, b);
      const stat = fs.statSync(a);
      fs.utimesSync(b, stat.atime, stat.mtime);

      const second = await importAt(library.id, b, film.id);
      expect(second.created).toBe(true);
      expect(second.mediaId).not.toBe(first.mediaId);
    });

    it('backfills size and mtime on rows imported before they were recorded', async () => {
      const library = await createLibrary({ libraryType: 'Film', path: dir });
      const film = await createCollection({ libraryId: library.id, name: 'F' });
      const file = path.join(dir, 'F', 'legacy.mkv');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'legacy');
      const legacy = await createVideoMedia({ path: file, duration: 1, collectionId: film.id });
      expect(legacy.fileSize).toBeNull();

      await importAt(library.id, file, film.id);
      const row = await prisma.media.findUnique({ where: { id: legacy.id } });
      expect(row!.fileSize).toBe(6);
      expect(row!.fileMtimeMs).toBeGreaterThan(0);
    });
  });
});

describe('ImportService.queueTrickplay', () => {
  const hints = [
    { id: 'm1', name: 'Heat', type: 'Video' as const },
    { id: 'm2', name: 'A song', type: 'Audio' as const },
  ];

  it('asks for nothing unless the configuration wants previews', async () => {
    const queueTrickplay = jest.fn(async () => ({ id: 'job' }) as never);
    const service = new ImportService({ queueTrickplay });

    expect(await service.queueTrickplay(hints)).toBe(0);
    expect(queueTrickplay).not.toHaveBeenCalled();
  });
});
