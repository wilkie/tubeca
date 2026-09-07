import { prisma, resetDatabase, createVideoMedia } from '../../test/db';
import {
  gridLayout,
  isGridLayoutId,
  keyframeLayout,
  longestSegment,
  rememberKeyframes,
  segmentCount,
  segmentLength,
  segmentStart,
  storedKeyframes,
} from '../keyframes';

/** The lengths of every segment a layout describes, which is what a playlist says. */
function lengths(layout: ReturnType<typeof gridLayout>): number[] {
  return layout.starts.map((_, i) => Number(segmentLength(layout, i).toFixed(3)));
}

describe('gridLayout', () => {
  it('cuts evenly and leaves the remainder on the end', () => {
    expect(lengths(gridLayout(20, 6))).toEqual([6, 6, 6, 2]);
  });

  it('is named after the duration it was cut with', () => {
    expect(gridLayout(20, 6).id).toBe('g6');
    expect(isGridLayoutId('g6')).toBe(true);
    expect(isGridLayoutId('k1a2b3c4')).toBe(false);
  });

  it('has no segments for a file of no length', () => {
    expect(segmentCount(gridLayout(0, 6))).toBe(0);
  });
});

describe('keyframeLayout', () => {
  it('cuts at the keyframe nearest each mark, not the one after it', () => {
    // Keyframes every 3.5s: the 6s mark falls between 3.5 and 7, and 7 is
    // nearer. Always rounding up would give 7, 14, 21 as *starts* but segments
    // of 7 each; taking the nearer side keeps the average on target instead.
    const layout = keyframeLayout([0, 3.5, 7, 10.5, 14, 17.5, 21, 24.5], 28, 6);

    expect(layout.starts).toEqual([0, 7, 14, 21]);
    expect(lengths(layout)).toEqual([7, 7, 7, 7]);
  });

  it('rounds down when the earlier keyframe is the nearer one', () => {
    // 5 is one second from the 6s mark; 9 is three. Then the 11s mark, which
    // 9 is nearer than 14 — so the cuts trail the marks slightly rather than
    // running ahead of them, which is what keeps the average on target.
    const layout = keyframeLayout([0, 5, 9, 14, 20], 30, 6);

    expect(layout.starts).toEqual([0, 5, 9, 14, 20]);
  });

  it('never starts a segment before the one in front of it', () => {
    const layout = keyframeLayout([0, 0.5, 1, 1.5, 2, 30, 60], 90, 6);

    for (let i = 1; i < layout.starts.length; i++) {
      expect(layout.starts[i]).toBeGreaterThan(layout.starts[i - 1]);
    }
  });

  it('leaves a short tail on the last segment rather than publishing a sliver', () => {
    // A final 0.4s segment would be a fragment the player has to fetch, parse
    // and splice for four tenths of a second of video.
    const layout = keyframeLayout([0, 6, 12, 18, 23.6], 24, 6);

    expect(layout.starts).toEqual([0, 6, 12, 18]);
    expect(lengths(layout)).toEqual([6, 6, 6, 6]);
  });

  it('covers the whole file, with no gap and no overlap', () => {
    const times = [0, 2.002, 5.1, 9.7, 13.2, 19.52, 24.6, 30.1, 36.4, 41, 47.8];
    const layout = keyframeLayout(times, 55, 6);

    let clock = 0;
    for (let i = 0; i < segmentCount(layout); i++) {
      expect(segmentStart(layout, i)).toBeCloseTo(clock, 6);
      clock += segmentLength(layout, i);
    }
    expect(clock).toBeCloseTo(55, 6);
  });

  it('begins at zero even when the first keyframe does not', () => {
    const layout = keyframeLayout([0.04, 6.1, 12.2], 18, 6);

    expect(layout.starts[0]).toBe(0);
  });

  it('ignores keyframes beyond the end of the file', () => {
    // A duration is stored in whole seconds, so the last keyframe of a file
    // can sit past it; a segment starting there would have no length at all.
    const layout = keyframeLayout([0, 6, 12, 19.4], 18, 6);

    expect(layout.starts.every((t) => t < 18)).toBe(true);
    expect(lengths(layout).every((d) => d > 0)).toBe(true);
  });

  it('falls back to the grid when there is nothing to cut at', () => {
    expect(keyframeLayout([], 20, 6).id).toBe('g6');
    expect(keyframeLayout([0], 20, 6).id).toBe('g6');
  });

  it('is named after the cuts, so an identical probe reuses the same cache', () => {
    const first = keyframeLayout([0, 3.5, 7, 10.5], 14, 6);
    const second = keyframeLayout([0, 3.5, 7, 10.5], 14, 6);
    const different = keyframeLayout([0, 4, 8, 12], 14, 6);

    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe(different.id);
    expect(first.id).toMatch(/^k[0-9a-f]{8}$/);
  });

  it('reports the longest segment, which is what a player sizes its buffer from', () => {
    const layout = keyframeLayout([0, 6, 12, 22, 28], 34, 6);

    expect(longestSegment(layout)).toBe(10);
  });
});

describe('remembering what was probed', () => {
  beforeEach(resetDatabase);

  it('gives back what it was given', async () => {
    const media = await createVideoMedia({ path: '/media/a.mkv', duration: 60 });

    await rememberKeyframes(media.id, [0, 3.501, 7.002]);

    expect((await storedKeyframes(media.id))?.times).toEqual([0, 3.501, 7.002]);
  });

  it('says nothing about a file nobody has probed', async () => {
    const media = await createVideoMedia({ path: '/media/b.mkv', duration: 60 });

    expect(await storedKeyframes(media.id)).toBeNull();
  });

  it('forgets keyframes when the file behind them has been replaced', async () => {
    // Same path, different file: its keyframes are somewhere else entirely,
    // and cutting the new file at the old ones would put every segment adrift.
    const media = await createVideoMedia({ path: '/media/c.mkv', duration: 60 });
    await prisma.media.update({
      where: { id: media.id },
      data: { fileSize: 1000, fileMtimeMs: 1_700_000_000_000 },
    });
    await rememberKeyframes(media.id, [0, 6, 12]);

    await prisma.media.update({ where: { id: media.id }, data: { fileSize: 2000 } });

    expect(await storedKeyframes(media.id)).toBeNull();
  });

  it('keeps them when the file is the one they were read from', async () => {
    const media = await createVideoMedia({ path: '/media/d.mkv', duration: 60 });
    await prisma.media.update({
      where: { id: media.id },
      data: { fileSize: 1000, fileMtimeMs: 1_700_000_000_000 },
    });
    await rememberKeyframes(media.id, [0, 6, 12]);

    expect((await storedKeyframes(media.id))?.times).toEqual([0, 6, 12]);
  });

  it('replaces an earlier probe rather than failing on it', async () => {
    const media = await createVideoMedia({ path: '/media/e.mkv', duration: 60 });

    await rememberKeyframes(media.id, [0, 6]);
    await rememberKeyframes(media.id, [0, 5, 10]);

    expect((await storedKeyframes(media.id))?.times).toEqual([0, 5, 10]);
  });

  it('goes away with the media it belongs to', async () => {
    const media = await createVideoMedia({ path: '/media/f.mkv', duration: 60 });
    await rememberKeyframes(media.id, [0, 6]);

    await prisma.media.delete({ where: { id: media.id } });

    expect(await prisma.mediaKeyframes.count()).toBe(0);
  });
});
