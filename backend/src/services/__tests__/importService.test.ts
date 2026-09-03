import { jest } from '@jest/globals';
import {
  ImportService,
  buildMediaHints,
  buildCollectionHints,
  shouldScrapeMedia,
} from '../importService';
import { ContentDeletionService } from '../contentDeletionService';
import { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia } from '../../test/db';

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
  it('skips media scrapes for Film libraries only', () => {
    expect(shouldScrapeMedia('Film')).toBe(false);
    expect(shouldScrapeMedia('Television')).toBe(true);
    expect(shouldScrapeMedia('Music')).toBe(true);
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

  it('queues collection scrapes parents first and skips Generic', async () => {
    await service.queueCollectionScrapes([
      buildCollectionHints('s1', 'Season 1', 'Season', 'show'),
      buildCollectionHints('x', 'Extras', 'Generic', 'show'),
      buildCollectionHints('show', 'Betty', 'Show', null),
      buildCollectionHints('f', 'Dune (2021)', 'Film', null),
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
});
