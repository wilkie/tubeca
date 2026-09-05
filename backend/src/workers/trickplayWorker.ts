import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/database';
import type { TrickplayJobData } from '../queues/trickplayQueue';
import { generateTrickplay } from '../services/trickplayService';

export interface TrickplayResult {
  spriteCount: number
  path: string
}

/**
 * Generate hover-scrub sprites for one video and record where they went.
 *
 * `Media.thumbnails` is the folder the streaming routes read, whether it was
 * generated here or came with the library, so nothing downstream has to know
 * which.
 */
export const trickplayWorker = new Worker<TrickplayJobData, TrickplayResult>(
  'trickplay',
  async (job: Job<TrickplayJobData>) => {
    const { mediaId, mediaName } = job.data;
    console.log(`🎞️ Generating previews for: ${mediaName} (${mediaId})`);

    const media = await prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new Error('Media not found');
    }

    const result = await generateTrickplay({ mediaId, sourcePath: media.path });

    await prisma.media.update({ where: { id: mediaId }, data: { thumbnails: result.path } });
    console.log(`✅ ${result.spriteCount} preview sheets for ${mediaName}`);

    return { spriteCount: result.spriteCount, path: result.path };
  },
  {
    connection: redisConnection,
    // A full decode each: one at a time leaves the machine usable for playback,
    // which is what it is for.
    concurrency: 1,
  }
);

trickplayWorker.on('failed', (job, error) => {
  console.error(`❌ Preview generation ${job?.id} failed:`, error.message);
});

trickplayWorker.on('error', (error) => {
  console.error('Trickplay worker error:', error);
});

trickplayWorker.on('ready', () => {
  console.log('🎞️ Trickplay worker is ready');
});
