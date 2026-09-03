import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/database';
import { libraryScanQueue, type LibraryScanJobData } from '../queues/libraryScanQueue';
import { LibraryScanService, type ScanSummary } from '../services/libraryScanService';
import { importService } from '../services/importService';

/** What the job stores as its return value (and the UI shows in the scan tooltip). */
export interface ScanResult {
  filesFound: number
  filesProcessed: number
  collectionsCreated: number
  mediaCreated: number
  mediaRemoved: number
  collectionsRemoved: number
  errors: string[]
}

const scanService = new LibraryScanService(importService);

function toResult(summary: ScanSummary): ScanResult {
  return {
    filesFound: summary.filesFound,
    filesProcessed: summary.filesProcessed,
    collectionsCreated: summary.collectionsCreated,
    mediaCreated: summary.mediaCreated,
    mediaRemoved: summary.mediaRemoved,
    collectionsRemoved: summary.collectionsRemoved,
    errors: summary.errors,
  };
}

// Library scan worker
export const libraryScanWorker = new Worker(
  'library-scan',
  async (job: Job<LibraryScanJobData & { cancelled?: boolean }>) => {
    const { libraryId, libraryPath, libraryName, fullScan } = job.data;
    console.log(`📂 Starting scan for library: ${libraryName} (${libraryId})`);
    console.log(`   Path: ${libraryPath}`);

    try {
      const library = await prisma.library.findUnique({ where: { id: libraryId } });
      if (!library) {
        throw new Error('Library not found');
      }

      const summary = await scanService.scan(
        { id: library.id, path: libraryPath, libraryType: library.libraryType },
        {
          fullScan,
          checkCancelled: async () => {
            const freshJob = await libraryScanQueue.getJob(job.id!);
            if (freshJob?.data?.cancelled) {
              throw new Error('Scan cancelled by user');
            }
          },
          onProgress: (percent) => job.updateProgress(percent),
        }
      );

      const result = toResult(summary);
      console.log(`✅ Scan complete for ${libraryName}:`, result);

      const mediaQueued = await importService.queueMediaScrapes(library.libraryType, summary.mediaToScrape);
      if (mediaQueued > 0) {
        console.log(`📋 Queued metadata scrape for ${mediaQueued} media items`);
      }
      const collectionsQueued = await importService.queueCollectionScrapes(summary.collectionsToScrape);
      if (collectionsQueued > 0) {
        console.log(`📋 Queued collection scrape for ${collectionsQueued} collections`);
      }

      return result;
    } catch (error) {
      console.error(`❌ Scan error for ${libraryName}:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Only one scan at a time
  }
);

// Worker event handlers
libraryScanWorker.on('completed', (job) => {
  console.log(`✅ Library scan ${job.id} completed successfully`);
});

libraryScanWorker.on('failed', (job, error) => {
  console.error(`❌ Library scan ${job?.id} failed:`, error.message);
});

libraryScanWorker.on('error', (error) => {
  console.error('Library scan worker error:', error);
});

libraryScanWorker.on('ready', () => {
  console.log('📚 Library scan worker is ready');
});
