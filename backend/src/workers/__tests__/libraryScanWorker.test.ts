import { jest } from '@jest/globals';
import { prisma, resetDatabase, createLibrary } from '../../test/db';
import type { ScanSummary } from '../../services/libraryScanService';

const asyncMock = <T>() => jest.fn<(...args: unknown[]) => Promise<T>>();

/** The processor BullMQ would call, captured instead of connected to Redis. */
type Processor = (job: unknown) => Promise<unknown>;
let processor: Processor;
let workerOptions: Record<string, unknown> = {};
let workerQueueName = '';

jest.unstable_mockModule('bullmq', () => ({
  Worker: class {
    constructor(name: string, fn: Processor, options: Record<string, unknown>) {
      workerQueueName = name;
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

jest.unstable_mockModule('../../config/redis', () => ({ redisConnection: {} }));

const libraryScanQueue = { getJob: asyncMock<{ data?: { cancelled?: boolean } } | undefined>() };
jest.unstable_mockModule('../../queues/libraryScanQueue', () => ({ libraryScanQueue }));

const scan = asyncMock<ScanSummary>();
jest.unstable_mockModule('../../services/libraryScanService', () => ({
  LibraryScanService: class {
    scan = scan;
  },
}));

const importService = {
  queueMediaScrapes: asyncMock<number>(),
  queueCollectionScrapes: asyncMock<number>(),
};
jest.unstable_mockModule('../../services/importService', () => ({ importService }));

await import('../libraryScanWorker');

const emptySummary: ScanSummary = {
  filesFound: 0,
  filesProcessed: 0,
  collectionsCreated: 0,
  mediaCreated: 0,
  mediaMoved: 0,
  mediaRemoved: 0,
  collectionsRemoved: 0,
  mediaWouldRemove: 0,
  collectionsWouldRemove: 0,
  errors: [],
  mediaToScrape: [],
  collectionsToScrape: [],
};

const updateProgress = jest.fn();

function job(data: Record<string, unknown>) {
  return { id: 'job-1', data, updateProgress };
}

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(async () => {
  await resetDatabase();
  jest.clearAllMocks();
  scan.mockResolvedValue(emptySummary);
  importService.queueMediaScrapes.mockResolvedValue(0);
  importService.queueCollectionScrapes.mockResolvedValue(0);
  libraryScanQueue.getJob.mockResolvedValue(undefined);
});

describe('the library scan worker', () => {
  it('takes two libraries at a time from its own queue', () => {
    expect(workerQueueName).toBe('library-scan');
    expect(workerOptions.concurrency).toBe(2);
  });

  it('refuses a job for a library that is no longer there', async () => {
    await expect(
      processor(job({ libraryId: 'gone', libraryPath: '/media', libraryName: 'Films' }))
    ).rejects.toThrow('Library not found');
    expect(scan).not.toHaveBeenCalled();
  });

  it('scans the library at the path the job carries, with the type the row holds', async () => {
    const library = await createLibrary({ path: '/media/films', libraryType: 'Film' });

    await processor(
      job({ libraryId: library.id, libraryPath: '/mnt/films', libraryName: 'Films' })
    );

    expect(scan).toHaveBeenCalledWith(
      { id: library.id, path: '/mnt/films', libraryType: 'Film' },
      expect.anything()
    );
  });

  it('passes a full scan and a dry run through', async () => {
    const library = await createLibrary();

    await processor(
      job({
        libraryId: library.id,
        libraryPath: '/media',
        libraryName: 'Films',
        fullScan: true,
        dryRunRemovals: true,
      })
    );

    expect(scan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fullScan: true, dryRunRemovals: true })
    );
  });

  it('reports the counts back as the job result, and keeps the scrape lists to itself', async () => {
    const library = await createLibrary();
    scan.mockResolvedValue({
      ...emptySummary,
      filesFound: 12,
      filesProcessed: 11,
      collectionsCreated: 2,
      mediaCreated: 9,
      mediaMoved: 1,
      mediaRemoved: 3,
      collectionsRemoved: 1,
      mediaWouldRemove: 4,
      collectionsWouldRemove: 2,
      errors: ['one file could not be probed'],
      mediaToScrape: [{ id: 'm1', name: 'Heat', type: 'Video' }],
      collectionsToScrape: [{ id: 'c1', name: 'Heat', collectionType: 'Film', parentId: null }],
    } as ScanSummary);

    const result = await processor(
      job({ libraryId: library.id, libraryPath: '/media', libraryName: 'Films' })
    );

    expect(result).toEqual({
      filesFound: 12,
      filesProcessed: 11,
      collectionsCreated: 2,
      mediaCreated: 9,
      mediaMoved: 1,
      mediaRemoved: 3,
      collectionsRemoved: 1,
      mediaWouldRemove: 4,
      collectionsWouldRemove: 2,
      errors: ['one file could not be probed'],
    });
  });

  it('queues the scrapes the scan asked for', async () => {
    const library = await createLibrary({ libraryType: 'Television' });
    const mediaHints = [{ id: 'm1', name: 'Pilot', type: 'Video' }];
    const collectionHints = [{ id: 'c1', name: 'Show', collectionType: 'Show', parentId: null }];
    scan.mockResolvedValue({
      ...emptySummary,
      mediaToScrape: mediaHints,
      collectionsToScrape: collectionHints,
    } as ScanSummary);
    importService.queueMediaScrapes.mockResolvedValue(1);
    importService.queueCollectionScrapes.mockResolvedValue(1);

    await processor(job({ libraryId: library.id, libraryPath: '/media', libraryName: 'Shows' }));

    expect(importService.queueMediaScrapes).toHaveBeenCalledWith('Television', mediaHints);
    expect(importService.queueCollectionScrapes).toHaveBeenCalledWith(collectionHints);
  });

  it('still asks, with nothing to ask about, and says nothing about it', async () => {
    const library = await createLibrary();

    await processor(job({ libraryId: library.id, libraryPath: '/media', libraryName: 'Films' }));

    expect(importService.queueMediaScrapes).toHaveBeenCalledWith(expect.anything(), []);
    expect(importService.queueCollectionScrapes).toHaveBeenCalledWith([]);
  });

  it('reports progress to the job', async () => {
    const library = await createLibrary();
    scan.mockImplementation(async (_library: unknown, options: unknown) => {
      (options as { onProgress: (percent: number) => void }).onProgress(42);
      return emptySummary;
    });

    await processor(job({ libraryId: library.id, libraryPath: '/media', libraryName: 'Films' }));

    expect(updateProgress).toHaveBeenCalledWith(42);
  });

  describe('cancellation', () => {
    /** Run a scan that checks for cancellation once, and report what happened. */
    async function scanThatChecks(library: { id: string }): Promise<Error | null> {
      let checkFailure: Error | null = null;
      scan.mockImplementation(async (_library: unknown, options: unknown) => {
        try {
          await (options as { checkCancelled: () => Promise<void> }).checkCancelled();
        } catch (error) {
          checkFailure = error as Error;
        }
        return emptySummary;
      });
      await processor(job({ libraryId: library.id, libraryPath: '/media', libraryName: 'Films' }));
      return checkFailure;
    }

    it('stops the scan when the job has been marked cancelled', async () => {
      const library = await createLibrary();
      libraryScanQueue.getJob.mockResolvedValue({ data: { cancelled: true } });

      expect((await scanThatChecks(library))?.message).toBe('Scan cancelled by user');
    });

    it('reads the flag from the queue each time, not from the job it was handed', async () => {
      const library = await createLibrary();
      libraryScanQueue.getJob.mockResolvedValue({ data: { cancelled: false } });

      expect(await scanThatChecks(library)).toBeNull();
      expect(libraryScanQueue.getJob).toHaveBeenCalledWith('job-1');
    });

    it('carries on when the job has since been cleaned up', async () => {
      const library = await createLibrary();
      libraryScanQueue.getJob.mockResolvedValue(undefined);

      expect(await scanThatChecks(library)).toBeNull();
    });
  });

  it('lets a scan failure fail the job, having queued nothing', async () => {
    const library = await createLibrary();
    scan.mockRejectedValue(new Error('Library path does not exist: /media'));

    await expect(
      processor(job({ libraryId: library.id, libraryPath: '/media', libraryName: 'Films' }))
    ).rejects.toThrow('Library path does not exist: /media');
    expect(importService.queueMediaScrapes).not.toHaveBeenCalled();
  });

  it('leaves the library row alone', async () => {
    const library = await createLibrary({ name: 'Films' });

    await processor(job({ libraryId: library.id, libraryPath: '/media', libraryName: 'Films' }));

    expect(await prisma.library.findUnique({ where: { id: library.id } })).toMatchObject({
      name: 'Films',
    });
  });
});
