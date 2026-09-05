import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export interface TrickplayJobData {
  mediaId: string
  mediaName: string
}

/**
 * Sprite generation, one media item per job.
 *
 * A job is a full decode of the file, so this queue is deliberately slow and
 * shallow: one at a time, no retries worth speaking of, and the job id is the
 * media id so asking twice does not queue twice.
 */
export const trickplayQueue = new Queue('trickplay', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 24 * 3600, count: 100 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export async function addTrickplayJob(data: TrickplayJobData) {
  const jobId = `trickplay-${data.mediaId}`;
  const existing = await trickplayQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    // Waiting or running already: one is enough.
    if (state !== 'completed' && state !== 'failed') return existing;
    await existing.remove();
  }
  return trickplayQueue.add('trickplay', data, { jobId });
}

export async function getTrickplayJob(mediaId: string) {
  return trickplayQueue.getJob(`trickplay-${mediaId}`);
}
