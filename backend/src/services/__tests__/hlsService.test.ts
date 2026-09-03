import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { prisma, resetDatabase, createVideoMedia } from '../../test/db';

// FFmpeg is replaced with a fake child that only exits when told to.
interface FakeChild extends EventEmitter {
  stderr: EventEmitter
  kill: ReturnType<typeof jest.fn>
}
const spawned: FakeChild[] = [];
jest.unstable_mockModule('child_process', () => ({
  spawn: () => {
    const child = new EventEmitter() as FakeChild;
    child.stderr = new EventEmitter();
    child.kill = jest.fn(() => {
      setImmediate(() => child.emit('close', null));
      return true;
    });
    spawned.push(child);
    return child;
  },
}));

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-hls-test-'));

// Encoder detection shells out to ffmpeg at construction time; stub it.
jest.unstable_mockModule('../../utils/hwaccel', () => ({
  detectBestEncoder: () => ({ name: 'libx264', type: 'software', available: true }),
  getEncoderArgs: () => [],
  getEncoder: () => ({ name: 'libx264', type: 'software', available: true }),
  isHardwareAccelerated: () => false,
}));
const actualAppConfig = await import('../../config/appConfig');
jest.unstable_mockModule('../../config/appConfig', () => ({
  ...actualAppConfig,
  loadAppConfig: () => ({}),
  getHlsCacheConfig: () => ({ path: cacheDir, maxSizeGB: 1, segmentTTLHours: 1, segmentDuration: 6 }),
  getHlsCachePath: () => cacheDir,
}));

const { HlsService, ORIGINAL_QUALITY } = await import('../hlsService');

describe('HlsService playlist synthesis', () => {
  const service = new HlsService();

  beforeEach(async () => {
    await resetDatabase();
    // Playlist generation kicks off segment prefetch; keep ffmpeg out of tests.
    (service as unknown as { prefetchInitialSegments: () => void }).prefetchInitialSegments = () => {};
  });

  afterAll(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('offers Original only for natively playable containers', async () => {
    const mp4 = await createVideoMedia({ path: '/media/film.mp4', duration: 100 });
    const mkv = await createVideoMedia({ path: '/media/film.mkv', duration: 100 });

    const mp4Playlist = await service.generateMasterPlaylist(mp4.id);
    const mkvPlaylist = await service.generateMasterPlaylist(mkv.id);

    expect(mp4Playlist).toContain(`${ORIGINAL_QUALITY}.m3u8`);
    expect(mkvPlaylist).not.toContain(`${ORIGINAL_QUALITY}.m3u8`);
  });

  it('lists the four transcoded rungs highest first with the audio track propagated', async () => {
    const media = await createVideoMedia({ path: '/media/film.mkv', duration: 100 });
    const playlist = await service.generateMasterPlaylist(media.id, 2);
    const variantLines = playlist.split('\n').filter((l) => l.endsWith('.m3u8?audioTrack=2'));

    expect(variantLines).toEqual([
      '1080p.m3u8?audioTrack=2',
      '720p.m3u8?audioTrack=2',
      '480p.m3u8?audioTrack=2',
      '360p.m3u8?audioTrack=2',
    ]);
    expect(playlist.startsWith('#EXTM3U')).toBe(true);
  });

  it('throws for an unknown media id', async () => {
    await expect(service.generateMasterPlaylist('missing')).rejects.toThrow('Media not found');
  });

  it('splits the duration into fixed segments with a short final segment', async () => {
    const media = await createVideoMedia({ path: '/media/film.mkv', duration: 20 });
    const playlist = await service.generateVariantPlaylist(media.id, '720p', '1');
    const lines = playlist.split('\n');

    // Default TranscodingSettings.segmentDuration is 6s: 6 + 6 + 6 + 2
    expect(lines).toContain('#EXT-X-TARGETDURATION:7');
    expect(lines.filter((l) => l.startsWith('#EXTINF:'))).toEqual([
      '#EXTINF:6.000,',
      '#EXTINF:6.000,',
      '#EXTINF:6.000,',
      '#EXTINF:2.000,',
    ]);
    expect(lines.filter((l) => l.endsWith('.ts?audioTrack=1'))).toEqual([
      '720p/0.ts?audioTrack=1',
      '720p/1.ts?audioTrack=1',
      '720p/2.ts?audioTrack=1',
      '720p/3.ts?audioTrack=1',
    ]);
    expect(lines[lines.length - 1]).toBe('#EXT-X-ENDLIST');
  });

  it('produces an empty VOD playlist for zero-duration media', async () => {
    const media = await createVideoMedia({ path: '/media/film.mkv', duration: 0 });
    const playlist = await service.generateVariantPlaylist(media.id, '480p');
    expect(playlist).not.toContain('#EXTINF');
    expect(playlist).toContain('#EXT-X-ENDLIST');
  });

  describe('direct play', () => {
    it('offers Original from probed codecs rather than the file extension', async () => {
      const mkv = await createVideoMedia({ path: '/media/h264.mkv', duration: 100 });
      const mp4 = await createVideoMedia({ path: '/media/hevc.mp4', duration: 100 });
      await prisma.mediaStream.createMany({
        data: [
          { mediaId: mkv.id, streamIndex: 0, streamType: 'Video', codec: 'h264' },
          { mediaId: mkv.id, streamIndex: 1, streamType: 'Audio', codec: 'aac' },
          { mediaId: mp4.id, streamIndex: 0, streamType: 'Video', codec: 'hevc' },
          { mediaId: mp4.id, streamIndex: 1, streamType: 'Audio', codec: 'aac' },
        ],
      });

      expect(await service.getAvailableQualities(mkv.id)).toContain(ORIGINAL_QUALITY);
      expect(await service.getAvailableQualities(mp4.id)).not.toContain(ORIGINAL_QUALITY);
      expect(await service.generateMasterPlaylist(mkv.id)).toContain(`${ORIGINAL_QUALITY}.m3u8`);
    });
  });

  describe('segment generation lifecycle', () => {
    type Internals = {
      ensureSegment: (
        videoPath: string,
        totalDuration: number,
        quality: string,
        segmentIndex: number,
        audioTrack: string,
        variantPath: string
      ) => Promise<void>
    };

    beforeEach(() => {
      spawned.length = 0;
    });

    it('encodes a segment once even when requested concurrently, and cleans up on timeout', async () => {
      const quick = new HlsService({ segmentTimeoutMs: 30 });
      const variant = path.join(cacheDir, 'm', 'adefault', '720p');
      const internals = quick as unknown as Internals;

      const a = internals.ensureSegment('/media/x.mkv', 60, '720p', 0, 'default', variant);
      const b = internals.ensureSegment('/media/x.mkv', 60, '720p', 0, 'default', variant);

      await expect(a).rejects.toThrow(/timed out/);
      await expect(b).rejects.toThrow(/timed out/);
      expect(spawned).toHaveLength(1);
      expect(spawned[0].kill).toHaveBeenCalledWith('SIGKILL');
      expect(quick.runningProcessCount).toBe(0);
      expect(fs.existsSync(path.join(variant, '0.ts'))).toBe(false);
    });

    it('resolves when FFmpeg exits cleanly and releases the process', async () => {
      const quick = new HlsService({ segmentTimeoutMs: 5000 });
      const variant = path.join(cacheDir, 'm2', 'adefault', '480p');
      const pending = (quick as unknown as Internals).ensureSegment('/media/y.mkv', 60, '480p', 1, 'default', variant);
      await new Promise((r) => setImmediate(r));
      expect(quick.runningProcessCount).toBe(1);
      spawned[0].emit('close', 0);
      await expect(pending).resolves.toBeUndefined();
      expect(quick.runningProcessCount).toBe(0);
    });

    it('shutdown kills running encodes', async () => {
      const quick = new HlsService({ segmentTimeoutMs: 5000 });
      const variant = path.join(cacheDir, 'm3', 'adefault', '360p');
      const pending = (quick as unknown as Internals).ensureSegment('/media/z.mkv', 60, '360p', 0, 'default', variant);
      await new Promise((r) => setImmediate(r));
      quick.shutdown();
      await expect(pending).rejects.toThrow(/exited with code null/);
      expect(spawned[0].kill).toHaveBeenCalled();
    });
  });
});
