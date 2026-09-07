import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { prisma } from '../config/database';

/**
 * Where a file's segments are allowed to begin.
 *
 * A copied segment cannot have a keyframe forced into it: it begins wherever
 * the encoder left one. Cutting on a fixed grid therefore asks for something
 * the file cannot give, and FFmpeg answers by starting the segment at the
 * nearest keyframe it can — which is not where the playlist says the segment
 * starts. That mismatch is what desynchronised audio from video and skipped
 * the picture backwards before this existed.
 *
 * So the grid is replaced by the file's own keyframe positions, probed once
 * and remembered. A layout is shared by every rung of a file, because HLS
 * expects variants to be cut at the same instants and this player switches
 * quality on its own; a transcode can put a keyframe wherever it is told, so
 * it follows the copy rung rather than the other way round.
 */
export interface SegmentLayout {
  /**
   * Short token naming this layout, carried in every segment URL and in the
   * name of the directory their cache lives in.
   *
   * A player holds one playlist for the length of a stream. If a probe lands
   * while it is watching, the layout changes underneath it — and segments cut
   * at the new instants would be exactly the mismatch this is here to prevent.
   * Naming the layout means the old playlist keeps asking for, and getting,
   * the segments it was built from.
   */
  id: string
  /** Where each segment begins, ascending, starting at zero. */
  starts: number[]
  /** What the last segment runs to. */
  duration: number
}

/** How many segments a layout has. */
export function segmentCount(layout: SegmentLayout): number {
  return layout.starts.length;
}

/** Where segment `index` begins. */
export function segmentStart(layout: SegmentLayout, index: number): number {
  return layout.starts[index] ?? layout.duration;
}

/** How long segment `index` runs for, which varies once keyframes decide it. */
export function segmentLength(layout: SegmentLayout, index: number): number {
  const start = layout.starts[index];
  if (start === undefined) return 0;
  const end = layout.starts[index + 1] ?? layout.duration;
  return Math.max(0, end - start);
}

/** The longest segment, which is what `#EXT-X-TARGETDURATION` has to cover. */
export function longestSegment(layout: SegmentLayout): number {
  let longest = 0;
  for (let i = 0; i < layout.starts.length; i++) {
    longest = Math.max(longest, segmentLength(layout, i));
  }
  return longest;
}

/**
 * Even segments of `target` seconds, the layout used before a file's keyframes
 * are known and the one it falls back to if they cannot be read.
 */
export function gridLayout(duration: number, target: number): SegmentLayout {
  const count = Math.max(0, Math.ceil(duration / target));
  const starts: number[] = [];
  for (let i = 0; i < count; i++) starts.push(i * target);
  return { id: `g${target}`, starts, duration };
}

/** True for a layout id that describes an even grid rather than a probe. */
export function isGridLayoutId(id: string): boolean {
  return /^g\d+(\.\d+)?$/.test(id);
}

/**
 * Cut the file at the keyframe nearest each `target`-second mark.
 *
 * Nearest, rather than the first at or after the mark, because a run of
 * keyframes never divides the target evenly and always rounding up compounds:
 * on a real episode here (497 keyframes, 0.58-10.01s apart, 6s target) rounding
 * up gave segments averaging 8.39s and reaching 15.31s, while taking whichever
 * side is closer gave 6.48s and 10.01s. The second figure is the file's longest
 * gap between keyframes, which is the shortest a longest segment can possibly
 * be — there is nowhere else to cut.
 *
 * A tail shorter than half a segment is left on the end of its predecessor
 * rather than published as a sliver of its own.
 */
export function keyframeLayout(
  keyframes: readonly number[],
  duration: number,
  target: number
): SegmentLayout {
  const times = [...keyframes]
    .filter((t) => Number.isFinite(t) && t > 0 && t < duration)
    .sort((a, b) => a - b);
  if (times.length === 0 || duration <= 0 || target <= 0) {
    return gridLayout(duration, target);
  }

  const starts = [0];
  let cursor = 0;
  while (cursor < times.length) {
    const from = starts[starts.length - 1];
    const goal = from + target;

    let after = cursor;
    while (after < times.length && times[after] < goal) after++;
    // Nothing left beyond the goal: whatever remains belongs to this segment.
    if (after >= times.length) break;

    // `after - 1` is only a candidate if it is past the current start, which
    // is exactly the condition that it has not already been consumed.
    const pick =
      after > cursor && goal - times[after - 1] < times[after] - goal ? after - 1 : after;

    if (duration - times[pick] < target / 2) break;
    starts.push(times[pick]);
    cursor = pick + 1;
  }

  return { id: layoutId(starts), starts, duration };
}

/**
 * A layout's name, from the cuts themselves rather than from the file, so two
 * probes that agree produce one name and nothing cached has to be thrown away.
 */
function layoutId(starts: readonly number[]): string {
  const digest = createHash('sha1')
    .update(starts.map((t) => t.toFixed(3)).join(','))
    .digest('hex');
  return `k${digest.slice(0, 8)}`;
}

/** How long a probe may run before it is abandoned as stuck. */
const PROBE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Read where a file's video keyframes are, in seconds.
 *
 * This reads the whole file: 28 seconds for a 1GB episode over a CIFS mount
 * here, almost all of it waiting on the network rather than on the CPU. With
 * thirty thousand files in the library that is a week and a half of continuous
 * reading, so nothing probes ahead of time — a file is probed the first time
 * somebody asks to play it, and the answer is kept.
 */
export function probeKeyframes(videoPath: string): Promise<number[]> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      // Only keyframes are decoded, which is why this costs I/O and not CPU.
      '-skip_frame', 'nokey',
      '-show_entries', 'frame=pts_time',
      '-of', 'csv=p=0',
      videoPath,
    ]);

    let out = '';
    let settled = false;
    const done = (times: number[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(times);
    };

    const timer = setTimeout(() => {
      ffprobe.kill('SIGKILL');
      done([]);
    }, PROBE_TIMEOUT_MS);

    ffprobe.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    // Nothing here is worth failing a stream over: a file whose keyframes
    // cannot be read plays on the even grid, as every file did before.
    ffprobe.on('error', () => done([]));
    ffprobe.on('close', (code) => {
      if (code !== 0) return done([]);
      const times: number[] = [];
      for (const line of out.split('\n')) {
        const value = Number.parseFloat(line);
        if (Number.isFinite(value)) times.push(value);
      }
      times.sort((a, b) => a - b);
      done(times);
    });
  });
}

/** What was probed for a file, and the file it was probed from. */
export interface StoredKeyframes {
  times: number[]
  fileSize: number | null
  fileMtimeMs: number | null
}

/**
 * The keyframes remembered for a media item, or null if none are, or if the
 * file has been replaced since they were read.
 */
export async function storedKeyframes(mediaId: string): Promise<StoredKeyframes | null> {
  const row = await prisma.mediaKeyframes.findUnique({
    where: { mediaId },
    select: {
      times: true,
      fileSize: true,
      fileMtimeMs: true,
      media: { select: { fileSize: true, fileMtimeMs: true } },
    },
  });
  if (!row) return null;

  // A file swapped for another of the same name has different keyframes, and
  // serving the old ones would cut every segment in the wrong place.
  const stale =
    (row.fileSize !== null && row.media.fileSize !== null && row.fileSize !== row.media.fileSize) ||
    (row.fileMtimeMs !== null &&
      row.media.fileMtimeMs !== null &&
      row.fileMtimeMs !== row.media.fileMtimeMs);
  if (stale) return null;

  try {
    const times = JSON.parse(row.times) as unknown;
    if (!Array.isArray(times)) return null;
    return { times: times.filter((t): t is number => typeof t === 'number'), fileSize: row.fileSize, fileMtimeMs: row.fileMtimeMs };
  } catch {
    return null;
  }
}

/** Remember what a probe found, against the file it read. */
export async function rememberKeyframes(mediaId: string, times: number[]): Promise<void> {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: { fileSize: true, fileMtimeMs: true },
  });
  if (!media) return;

  const data = {
    times: JSON.stringify(times.map((t) => Number(t.toFixed(3)))),
    fileSize: media.fileSize,
    fileMtimeMs: media.fileMtimeMs,
    probedAt: new Date(),
  };
  await prisma.mediaKeyframes.upsert({
    where: { mediaId },
    create: { mediaId, ...data },
    update: data,
  });
}

/**
 * Probes already running, so that four rungs asking at once — which is what a
 * master playlist does — read the file once between them.
 */
const inFlight = new Map<string, Promise<number[]>>();

/**
 * How many files may be probed at a time. Each is a sustained read of a whole
 * file, and the same disk is serving the playback that asked for it.
 */
const MAX_CONCURRENT_PROBES = 2;
let running = 0;
const waiting: Array<() => void> = [];

async function acquireProbeSlot(): Promise<() => void> {
  if (running < MAX_CONCURRENT_PROBES) {
    running++;
  } else {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  return () => {
    running--;
    const next = waiting.shift();
    if (next) {
      running++;
      next();
    }
  };
}

/**
 * Probe a file's keyframes and remember them, unless that is already happening.
 *
 * Returns what was found so a caller can use it, but callers are not expected
 * to wait: the point is that the *next* playlist for this file is cut where
 * its keyframes are, not that this one is.
 */
export function ensureKeyframes(mediaId: string, videoPath: string): Promise<number[]> {
  const existing = inFlight.get(mediaId);
  if (existing) return existing;

  const work = (async () => {
    const release = await acquireProbeSlot();
    try {
      const times = await probeKeyframes(videoPath);
      if (times.length > 0) await rememberKeyframes(mediaId, times);
      return times;
    } finally {
      release();
      inFlight.delete(mediaId);
    }
  })();

  inFlight.set(mediaId, work);
  return work;
}
