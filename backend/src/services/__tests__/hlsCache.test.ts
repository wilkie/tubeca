import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isDirectPlayable,
  evictMediaCache,
  collectCacheStats,
  sweepExpiredSegments,
  enforceCacheSize,
  purgeAllSegments,
} from '../hlsCache';

let root: string;

function segment(rel: string, bytes: number, ageHours = 0) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.alloc(bytes, 1));
  const when = new Date(Date.now() - ageHours * 3600 * 1000);
  fs.utimesSync(full, when, when);
  return full;
}

describe('isDirectPlayable', () => {
  it('accepts H.264 with AAC or MP3 in any container', () => {
    expect(isDirectPlayable([{ streamType: 'Video', codec: 'h264' }, { streamType: 'Audio', codec: 'aac' }], '/x.mkv')).toBe(true);
    expect(isDirectPlayable([{ streamType: 'Video', codec: 'H264' }, { streamType: 'Audio', codec: 'mp3' }], '/x.avi')).toBe(true);
    expect(isDirectPlayable([{ streamType: 'Video', codec: 'h264' }], '/x.mkv')).toBe(true);
  });

  it('rejects codecs HLS cannot carry even in an mp4', () => {
    expect(isDirectPlayable([{ streamType: 'Video', codec: 'hevc' }, { streamType: 'Audio', codec: 'aac' }], '/x.mp4')).toBe(false);
    expect(isDirectPlayable([{ streamType: 'Video', codec: 'h264' }, { streamType: 'Audio', codec: 'dts' }], '/x.mp4')).toBe(false);
    expect(isDirectPlayable([{ streamType: 'Video', codec: 'vp9' }, { streamType: 'Audio', codec: 'opus' }], '/x.webm')).toBe(false);
  });

  it('falls back to trusting only .mp4 when nothing was probed', () => {
    expect(isDirectPlayable([], '/x.mp4')).toBe(true);
    expect(isDirectPlayable([], '/x.webm')).toBe(false);
    expect(isDirectPlayable([], '/x.mkv')).toBe(false);
  });
});

describe('cache maintenance', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-hlscache-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('evicts one media item and reports whether anything existed', () => {
    segment('m1/adefault/720p/0.ts', 10);
    segment('m2/adefault/720p/0.ts', 10);
    expect(evictMediaCache('m1', root)).toBe(true);
    expect(fs.existsSync(path.join(root, 'm1'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'm2'))).toBe(true);
    expect(evictMediaCache('m1', root)).toBe(false);
  });

  it('counts segments and bytes per media', () => {
    segment('m1/adefault/720p/0.ts', 100);
    segment('m1/adefault/720p/1.ts', 50);
    segment('m2/adefault/480p/0.ts', 25);
    expect(collectCacheStats(root)).toEqual({ totalSize: 175, mediaCount: 2, segmentCount: 3 });
    expect(collectCacheStats(path.join(root, 'missing'))).toEqual({ totalSize: 0, mediaCount: 0, segmentCount: 0 });
  });

  it('counts fragmented segments and the header they share', () => {
    segment('m1/adefault/original/0.m4s', 100);
    segment('m1/adefault/original/1.m4s', 50);
    segment('m1/adefault/original/init.mp4', 20);

    expect(collectCacheStats(root)).toEqual({ totalSize: 170, mediaCount: 1, segmentCount: 3 });
  });

  it('sweeps segments older than the TTL and prunes empty folders', () => {
    const old = segment('m1/adefault/720p/0.ts', 10, 48);
    const fresh = segment('m1/adefault/720p/1.ts', 10, 1);
    segment('m2/adefault/720p/0.ts', 10, 48);

    expect(sweepExpiredSegments(root, 24)).toBe(2);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(path.join(root, 'm2'))).toBe(false);
  });

  it('purges every segment regardless of age when the geometry changes', () => {
    const fresh = segment('m1/adefault/720p/0.ts', 100, 0);
    const other = segment('m2/adefault/480p/9.ts', 100, 1);

    expect(purgeAllSegments(root)).toBe(2);
    expect(fs.existsSync(fresh)).toBe(false);
    expect(fs.existsSync(other)).toBe(false);
    expect(fs.existsSync(path.join(root, 'm1'))).toBe(false);
    expect(purgeAllSegments(root)).toBe(0);
  });

  it('enforces a size limit by dropping least recently used segments first', () => {
    const oldest = segment('m1/adefault/720p/0.ts', 100, 10);
    const middle = segment('m1/adefault/720p/1.ts', 100, 5);
    const newest = segment('m2/adefault/720p/0.ts', 100, 0);

    const result = enforceCacheSize(root, 150);
    expect(result).toEqual({ deleted: 2, freedBytes: 200 });
    expect(fs.existsSync(oldest)).toBe(false);
    expect(fs.existsSync(middle)).toBe(false);
    expect(fs.existsSync(newest)).toBe(true);
    expect(enforceCacheSize(root, 150)).toEqual({ deleted: 0, freedBytes: 0 });
  });
});
