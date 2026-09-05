import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { prisma, resetDatabase, createVideoMedia } from '../../test/db';

// FFmpeg is replaced with a fake child that only exits when told to.
interface FakeChild extends EventEmitter {
  stderr: EventEmitter
  stdout: EventEmitter
  kill: ReturnType<typeof jest.fn>
  args: string[]
}
const spawned: FakeChild[] = [];
jest.unstable_mockModule('child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new EventEmitter() as FakeChild;
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    child.args = args;
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
const softwareEncoder = { name: 'libx264', encoder: 'libx264', type: 'software', priority: 100 };
jest.unstable_mockModule('../../utils/hwaccel', () => ({
  detectBestEncoder: () => softwareEncoder,
  detectBestEncoderAsync: async () => softwareEncoder,
  getEncoderArgs: () => [],
  getEncoderInputArgs: () => [],
  getDecoderInputArgs: () => [],
  getEncoder: () => softwareEncoder,
  isHardwareAccelerated: () => false,
  listEncoderOptions: () => [softwareEncoder],
  resolvePreferredEncoder: async () => null,
  SOFTWARE_ENCODER: softwareEncoder,
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

    it('offers Original for a picture it can copy, whatever the sound is', async () => {
      // Nearly half of a real library: H.264 with audio no browser will take.
      const media = await createVideoMedia({ path: '/media/eac3.mkv', duration: 100 });
      await prisma.mediaStream.createMany({
        data: [
          { mediaId: media.id, streamIndex: 0, streamType: 'Video', codec: 'h264' },
          { mediaId: media.id, streamIndex: 1, streamType: 'Audio', codec: 'eac3' },
        ],
      });

      expect(await service.getAvailableQualities(media.id)).toContain(ORIGINAL_QUALITY);
    });
  });

  describe('hardware decode', () => {
    it('asks the accelerator to decode when it is the one encoding', async () => {
      // The mocked hwaccel reports software, so the arguments are empty here;
      // the decision itself is covered in the hwaccel tests. What this pins is
      // that the segment builder asks at all, with the file's own codec.
      const media = await createVideoMedia({ path: '/media/decode.mkv', duration: 100 });
      await prisma.mediaStream.create({
        data: { mediaId: media.id, streamIndex: 0, streamType: 'Video', codec: 'hevc' },
      });
      spawned.length = 0;

      void service.getSegment(media.id, '720p', 0, 'default');
      for (let attempt = 0; attempt < 50 && spawned.length === 0; attempt++) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      expect(spawned).toHaveLength(1);
      spawned[0].emit('close', 1);
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe('what the original rung actually encodes', () => {
    /** The FFmpeg arguments for one original segment of this media. */
    async function argsFor(streams: Array<{ streamType: string; codec: string }>, audioTrack = 'default') {
      const media = await createVideoMedia({
        path: `/media/${Math.random().toString(36).slice(2)}.mkv`,
        duration: 100,
      });
      await prisma.mediaStream.createMany({
        data: streams.map((stream, index) => ({
          mediaId: media.id,
          streamIndex: index,
          streamType: stream.streamType as 'Video' | 'Audio',
          codec: stream.codec,
        })),
      });
      spawned.length = 0;
      void service.getSegment(media.id, ORIGINAL_QUALITY, 0, audioTrack);
      // The decision reads the database, so more than a tick may pass before
      // FFmpeg is spawned.
      for (let attempt = 0; attempt < 50 && spawned.length === 0; attempt++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const args = spawned[0]?.args ?? [];
      // Let it finish: an unfinished encode holds a transcode slot, and the
      // next case would wait behind it forever.
      spawned[0]?.emit('close', 1);
      await new Promise((resolve) => setImmediate(resolve));
      return args;
    }

    /** The value FFmpeg was given for a flag, so `-c:v copy` cannot answer for `-c:a`. */
    const valueOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

    it('copies both streams when the sound is already playable', async () => {
      const args = await argsFor([
        { streamType: 'Video', codec: 'h264' },
        { streamType: 'Audio', codec: 'aac' },
      ]);

      expect(valueOf(args, '-c:v')).toBe('copy');
      expect(valueOf(args, '-c:a')).toBe('copy');
    });

    it('copies the picture and re-encodes only the sound when it has to', async () => {
      const args = await argsFor([
        { streamType: 'Video', codec: 'h264' },
        { streamType: 'Audio', codec: 'eac3' },
      ]);

      // The picture is the expensive half; it is still copied.
      expect(valueOf(args, '-c:v')).toBe('copy');
      expect(valueOf(args, '-c:a')).toBe('aac');
    });

    it('judges the track that was asked for, not merely the first', async () => {
      const args = await argsFor(
        [
          { streamType: 'Video', codec: 'h264' },
          { streamType: 'Audio', codec: 'aac' },
          { streamType: 'Audio', codec: 'dts' },
        ],
        '2'
      );

      expect(valueOf(args, '-c:a')).toBe('aac');
      expect(valueOf(args, '-c:v')).toBe('copy');
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

  describe('transcode slot priority', () => {
    type Internals = {
      ensureSegment: (
        videoPath: string,
        totalDuration: number,
        quality: string,
        segmentIndex: number,
        audioTrack: string,
        variantPath: string,
        priority?: 'live' | 'prefetch',
        sink?: unknown,
        session?: string
      ) => Promise<void>
    };

    const settle = () => new Promise((r) => setImmediate(r));
    /** Which segment a spawned FFmpeg is writing, from its output path. */
    const segmentOf = (child: FakeChild) => path.basename(child.args[child.args.length - 1]);

    beforeEach(() => {
      spawned.length = 0;
    });

    it('starts a player request ahead of prefetches already queued for a slot', async () => {
      // Default maxConcurrentTranscodes is 2, so two encodes fill the pool.
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const internals = service as unknown as Internals;
      const variant = path.join(cacheDir, 'prio', 'adefault', '720p');
      const started = [
        internals.ensureSegment('/media/a.mkv', 600, '720p', 0, 'default', variant, 'prefetch'),
        internals.ensureSegment('/media/a.mkv', 600, '720p', 1, 'default', variant, 'prefetch'),
      ];
      await settle();
      expect(spawned).toHaveLength(2);

      const queuedPrefetch = internals.ensureSegment('/media/a.mkv', 600, '720p', 2, 'default', variant, 'prefetch');
      const queuedLive = internals.ensureSegment('/media/a.mkv', 600, '720p', 50, 'default', variant, 'live');
      await settle();
      expect(spawned).toHaveLength(2);

      // Free one slot: the player's segment goes next, not the older prefetch.
      spawned[0].emit('close', 0);
      await settle();
      expect(spawned).toHaveLength(3);
      expect(segmentOf(spawned[2])).toBe('50.ts');

      spawned[1].emit('close', 0);
      await settle();
      expect(segmentOf(spawned[3])).toBe('2.ts');

      spawned[2].emit('close', 0);
      spawned[3].emit('close', 0);
      await Promise.all([...started, queuedPrefetch, queuedLive]);
    });

    it('promotes a prefetch the player catches up to', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const internals = service as unknown as Internals;
      const variant = path.join(cacheDir, 'promote', 'adefault', '720p');

      const busy = [
        internals.ensureSegment('/media/b.mkv', 600, '720p', 0, 'default', variant, 'prefetch'),
        internals.ensureSegment('/media/b.mkv', 600, '720p', 1, 'default', variant, 'prefetch'),
      ];
      await settle();

      const waiting = internals.ensureSegment('/media/b.mkv', 600, '720p', 2, 'default', variant, 'prefetch');
      const alsoWaiting = internals.ensureSegment('/media/b.mkv', 600, '720p', 3, 'default', variant, 'prefetch');
      await settle();

      // The player asks for segment 3, joining the prefetch already queued.
      const live = internals.ensureSegment('/media/b.mkv', 600, '720p', 3, 'default', variant, 'live');
      spawned[0].emit('close', 0);
      await settle();

      expect(segmentOf(spawned[2])).toBe('3.ts');

      spawned[1].emit('close', 0);
      await settle();
      spawned[2].emit('close', 0);
      spawned[3].emit('close', 0);
      await Promise.all([...busy, waiting, alsoWaiting, live]);
    });
  });

  describe('streaming a segment while it encodes', () => {
    const settle = () => new Promise((r) => setImmediate(r));

    /**
     * Wait for something the runtime does on its own clock.
     *
     * `fs.createWriteStream` opens the file asynchronously, so the part file
     * can be a tick or two behind the first chunk on a busy machine.
     */
    async function eventually(condition: () => boolean) {
      for (let attempt = 0; attempt < 100 && !condition(); attempt++) await settle();
      return condition();
    }

    /** Stands in for the HTTP response. */
    function fakeSink() {
      const chunks: Buffer[] = [];
      const sink = new PassThrough();
      sink.on('data', (chunk: Buffer) => chunks.push(chunk));
      return { sink, chunks };
    }

    beforeEach(async () => {
      await resetDatabase();
      spawned.length = 0;
    });

    it('writes bytes to the response before the encode has finished', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const media = await createVideoMedia({ path: '/media/film.mkv', duration: 600 });
      const { sink, chunks } = fakeSink();

      const delivery = service.serveSegment(media.id, '720p', 0, 'default', sink);
      await settle();

      // FFmpeg is told to write to a pipe rather than a file.
      expect(spawned[0].args).toContain('pipe:1');
      expect(spawned[0].args).not.toContain('-y');

      spawned[0].stdout.emit('data', Buffer.from('first packets'));
      await settle();

      // The response has bytes while the process is still running.
      expect(Buffer.concat(chunks).toString()).toBe('first packets');
      expect(service.runningProcessCount).toBe(1);

      spawned[0].emit('close', 0);
      await expect(delivery).resolves.toEqual({ kind: 'streamed' });
    });

    it('only names the cache file once the encode exits cleanly', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const media = await createVideoMedia({ path: '/media/film.mkv', duration: 600 });
      const variant = service.getVariantCachePath(media.id, '720p', 'default');
      const segmentPath = path.join(variant, '0.ts');
      const { sink } = fakeSink();

      const delivery = service.serveSegment(media.id, '720p', 0, 'default', sink);
      await settle();
      spawned[0].stdout.emit('data', Buffer.from('partial'));
      await settle();

      // Mid-encode there is a part file, but nothing under the cache name.
      expect(fs.existsSync(segmentPath)).toBe(false);
      expect(
        await eventually(() => fs.readdirSync(variant).some((f) => f.startsWith('0.ts.part-')))
      ).toBe(true);

      spawned[0].emit('close', 0);
      await delivery;
      await settle();

      expect(fs.readFileSync(segmentPath).toString()).toBe('partial');
      expect(await eventually(() => !fs.readdirSync(variant).some((f) => f.includes('.part-')))).toBe(
        true
      );
    });

    it('leaves no cache file behind when the encode fails', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const media = await createVideoMedia({ path: '/media/film.mkv', duration: 600 });
      const variant = service.getVariantCachePath(media.id, '720p', 'default');
      const { sink } = fakeSink();
      sink.on('error', () => {});

      const delivery = service.serveSegment(media.id, '720p', 3, 'default', sink);
      await settle();
      spawned[0].stdout.emit('data', Buffer.from('half a segment'));
      await settle();
      spawned[0].emit('close', 1);

      await expect(delivery).resolves.toEqual({ kind: 'streamed' });
      expect(fs.existsSync(path.join(variant, '3.ts'))).toBe(false);
      // The part file is unlinked once its stream closes, which is a tick or
      // two after the encode failed.
      expect(await eventually(() => !fs.readdirSync(variant).some((f) => f.includes('.part-')))).toBe(
        true
      );
      // The response was cut short rather than ended cleanly.
      expect(sink.destroyed).toBe(true);
    });

    it('serves a segment that is already cached from disk', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const media = await createVideoMedia({ path: '/media/film.mkv', duration: 600 });
      const variant = service.getVariantCachePath(media.id, '720p', 'default');
      fs.mkdirSync(variant, { recursive: true });
      fs.writeFileSync(path.join(variant, '5.ts'), 'cached bytes');
      const { sink, chunks } = fakeSink();

      const delivery = await service.serveSegment(media.id, '720p', 5, 'default', sink);

      expect(delivery).toEqual({ kind: 'file', path: path.join(variant, '5.ts') });
      expect(chunks).toHaveLength(0);
      expect(spawned).toHaveLength(0);
    });

    it('reports a segment past the end of the file rather than hanging', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const media = await createVideoMedia({ path: '/media/film.mkv', duration: 60 });
      const { sink } = fakeSink();

      // Nothing was sent, so the caller can still answer with a 404.
      await expect(service.serveSegment(media.id, '720p', 9999, 'default', sink)).resolves.toEqual({
        kind: 'missing',
      });
      expect(sink.destroyed).toBe(false);
      expect(spawned).toHaveLength(0);
    });

    it('reports a missing media item without touching the response', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const { sink } = fakeSink();

      await expect(service.serveSegment('gone', '720p', 0, 'default', sink)).resolves.toEqual({
        kind: 'missing',
      });
      expect(sink.destroyed).toBe(false);
    });

    it('waits for an encode already running rather than starting a second', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const media = await createVideoMedia({ path: '/media/film.mkv', duration: 600 });
      const variant = service.getVariantCachePath(media.id, '720p', 'default');
      const internals = service as unknown as {
        ensureSegment: (
          videoPath: string,
          totalDuration: number,
          quality: string,
          segmentIndex: number,
          audioTrack: string,
          variantPath: string,
          priority?: 'live' | 'prefetch'
        ) => Promise<void>
      };

      // A prefetch is already encoding this one.
      const prefetch = internals.ensureSegment(media.path, 600, '720p', 7, 'default', variant, 'prefetch');
      await settle();
      expect(spawned).toHaveLength(1);

      const { sink, chunks } = fakeSink();
      const delivery = service.serveSegment(media.id, '720p', 7, 'default', sink);
      await settle();

      expect(spawned).toHaveLength(1);

      // The real FFmpeg would have written the file by the time it exits.
      fs.mkdirSync(variant, { recursive: true });
      fs.writeFileSync(path.join(variant, '7.ts'), 'prefetched');
      spawned[0].emit('close', 0);
      await prefetch;
      await expect(delivery).resolves.toEqual({ kind: 'file', path: path.join(variant, '7.ts') });
      expect(chunks).toHaveLength(0);
    });
  });

  describe('abandoning prefetches after a seek', () => {
    type Internals = {
      ensureSegment: (
        videoPath: string,
        totalDuration: number,
        quality: string,
        segmentIndex: number,
        audioTrack: string,
        variantPath: string,
        priority?: 'live' | 'prefetch',
        sink?: unknown,
        session?: string
      ) => Promise<void>
    };
    const settle = () => new Promise((r) => setImmediate(r));

    /** Stands in for the HTTP response a segment is streamed to. */
    const responseSink = () => new PassThrough();

    beforeEach(async () => {
      await resetDatabase();
      spawned.length = 0;
    });

    it('kills prefetches for the position the player has left', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const internals = service as unknown as Internals;
      const media = await createVideoMedia({ path: '/media/seek.mkv', duration: 3600 });
      const variant = service.getVariantCachePath(media.id, '720p', 'default');

      const stale = internals
        .ensureSegment(media.path, 3600, '720p', 0, 'default', variant, 'prefetch')
        .catch(() => 'cancelled');
      await settle();
      expect(spawned).toHaveLength(1);

      // The viewer jumps far ahead; segment 0 is no longer worth encoding.
      const seek = service.getSegment(media.id, '720p', 100, 'default');
      await settle();

      expect(spawned[0].kill).toHaveBeenCalledWith('SIGKILL');
      await expect(stale).resolves.toBe('cancelled');

      // The seek target is encoding in the freed slot.
      const target = spawned.find((c) => path.basename(c.args[c.args.length - 1]) === '100.ts');
      expect(target).toBeDefined();
      target!.emit('close', 1);
      await expect(seek).resolves.toBeNull();
    });

    it('leaves another viewer of the same file alone', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const internals = service as unknown as Internals;
      const media = await createVideoMedia({ path: '/media/shared.mkv', duration: 3600 });
      const variant = service.getVariantCachePath(media.id, '720p', 'default');
      const sink = responseSink();

      // Someone is ten minutes in, prefetching ahead of themselves.
      const theirs = internals
        .ensureSegment(media.path, 3600, '720p', 100, 'default', variant, 'prefetch', undefined, 'them')
        .catch(() => 'cancelled');
      await settle();
      const theirChild = spawned.find((c) => path.basename(c.args[c.args.length - 1]) === '100.ts');
      expect(theirChild).toBeDefined();

      // Someone else starts the same film from the beginning.
      void service.serveSegment(media.id, '720p', 0, 'default', sink, 'us');
      await settle();

      expect(theirChild!.kill).not.toHaveBeenCalled();
      theirChild!.emit('close', 1);
      await expect(theirs).resolves.toBe('cancelled');
    });

    it("still abandons a viewer's own prefetches when they seek", async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const internals = service as unknown as Internals;
      const media = await createVideoMedia({ path: '/media/seek.mkv', duration: 3600 });
      const variant = service.getVariantCachePath(media.id, '720p', 'default');
      const sink = responseSink();

      const stale = internals
        .ensureSegment(media.path, 3600, '720p', 0, 'default', variant, 'prefetch', undefined, 'us')
        .catch(() => 'cancelled');
      await settle();
      const staleChild = spawned[0];

      void service.serveSegment(media.id, '720p', 100, 'default', sink, 'us');
      await settle();

      expect(staleChild.kill).toHaveBeenCalledWith('SIGKILL');
      await expect(stale).resolves.toBe('cancelled');
    });

    it('leaves the prefetch window in front of the player alone', async () => {
      const service = new HlsService({ segmentTimeoutMs: 5000 });
      const internals = service as unknown as Internals;
      const media = await createVideoMedia({ path: '/media/forward.mkv', duration: 3600 });
      const variant = service.getVariantCachePath(media.id, '720p', 'default');

      const ahead = internals
        .ensureSegment(media.path, 3600, '720p', 11, 'default', variant, 'prefetch')
        .catch(() => 'cancelled');
      await settle();

      // Default prefetchSegments is 2, so segment 11 is inside [10, 12].
      const live = service.getSegment(media.id, '720p', 10, 'default');
      await settle();

      expect(spawned[0].kill).not.toHaveBeenCalled();

      for (const child of spawned) child.emit('close', 1);
      await live;
      await expect(ahead).resolves.toBe('cancelled');
    });
  });
});
