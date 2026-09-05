import { jest } from '@jest/globals';
import { prisma, resetDatabase, createLibrary, createCollection, createVideoMedia } from '../../test/db';

const asyncMock = <T>() => jest.fn<(...args: unknown[]) => Promise<T>>();

type Processor = (job: unknown) => Promise<{ spriteCount: number; path: string }>;
let processor: Processor;
let workerOptions: Record<string, unknown> = {};

jest.unstable_mockModule('bullmq', () => ({
  Worker: class {
    constructor(_name: string, fn: Processor, options: Record<string, unknown>) {
      processor = fn;
      workerOptions = options;
    }
    on() {
      return this;
    }
  },
  Queue: class {
    on() {
      return this;
    }
  },
}));
jest.unstable_mockModule('../../config/redis', () => ({ redisConnection: {}, redisDb: 0 }));

const generateTrickplay = asyncMock<{ path: string; spriteCount: number }>();
jest.unstable_mockModule('../../services/trickplayService', () => ({
  generateTrickplay,
  trickplayRoot: (mediaId: string) => `/store/trickplay/${mediaId}`,
  removeTrickplay: () => {},
  hasTrickplay: () => false,
  layoutFolder: () => '320 - 10x10',
}));

await import('../trickplayWorker');

let mediaId: string;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(async () => {
  await resetDatabase();
  jest.clearAllMocks();
  generateTrickplay.mockResolvedValue({ path: '/store/trickplay/media-1', spriteCount: 7 });
  const library = await createLibrary({ libraryType: 'Film' });
  const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
  mediaId = (
    await createVideoMedia({ name: 'Heat', path: '/films/heat.mkv', duration: 10200, collectionId: collection.id })
  ).id;
});

const job = (data: Record<string, unknown>) => ({ id: 'job-1', data });

describe('the trickplay worker', () => {
  it('takes one file at a time, since each is a full decode', () => {
    expect(workerOptions.concurrency).toBe(1);
  });

  it('generates from the path on the media row', async () => {
    await processor(job({ mediaId, mediaName: 'Heat' }));

    expect(generateTrickplay).toHaveBeenCalledWith({ mediaId, sourcePath: '/films/heat.mkv' });
  });

  it('records where the sprites went, so the player can find them', async () => {
    const result = await processor(job({ mediaId, mediaName: 'Heat' }));

    expect(result).toEqual({ spriteCount: 7, path: '/store/trickplay/media-1' });
    expect(await prisma.media.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({
      thumbnails: '/store/trickplay/media-1',
    });
  });

  it('fails the job for a media item that has since been deleted', async () => {
    await expect(processor(job({ mediaId: 'gone', mediaName: 'Heat' }))).rejects.toThrow(
      'Media not found'
    );
    expect(generateTrickplay).not.toHaveBeenCalled();
  });

  it('leaves the row alone when generation fails', async () => {
    generateTrickplay.mockRejectedValue(new Error('FFmpeg exited with code 1'));

    await expect(processor(job({ mediaId, mediaName: 'Heat' }))).rejects.toThrow('code 1');
    expect(await prisma.media.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({
      thumbnails: null,
    });
  });
});
