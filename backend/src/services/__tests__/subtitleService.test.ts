import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

/** A stand-in for the FFmpeg that extracts a track. */
class FakeFfmpeg extends EventEmitter {
  stderr = new EventEmitter();
  killed: string | undefined;
  kill = (signal: string) => {
    this.killed = signal;
  };
}

const spawned: FakeFfmpeg[] = [];
let onSpawn: ((args: string[], child: FakeFfmpeg) => void) | undefined;

jest.unstable_mockModule('child_process', () => ({
  spawn: jest.fn((_command: string, args: string[]) => {
    const child = new FakeFfmpeg();
    spawned.push(child);
    onSpawn?.(args, child);
    return child;
  }),
}));

const { extractSubtitle, isTextSubtitle, subtitleCachePath } = await import('../subtitleService');

let cacheRoot: string;
let source: string;

beforeEach(() => {
  spawned.length = 0;
  onSpawn = undefined;
  jest.clearAllMocks();
  cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-subs-'));
  source = path.join(cacheRoot, 'film.mkv');
  fs.writeFileSync(source, 'not really a film');
});

afterEach(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));

/** Answer the next extraction by writing `content` and exiting with `code`. */
function ffmpegWrites(content: string | null, code = 0) {
  onSpawn = (args, child) => {
    const target = args[args.length - 1];
    if (content !== null) fs.writeFileSync(target, content);
    setImmediate(() => child.emit('close', code));
  };
}

describe('isTextSubtitle', () => {
  it('accepts what FFmpeg can turn into WebVTT', () => {
    expect(isTextSubtitle('subrip')).toBe(true);
    expect(isTextSubtitle('MOV_TEXT')).toBe(true);
  });

  it('refuses the picture formats', () => {
    expect(isTextSubtitle('hdmv_pgs_subtitle')).toBe(false);
    expect(isTextSubtitle('dvd_subtitle')).toBe(false);
  });

  it('lets an unrecorded codec through, for FFmpeg to judge', () => {
    expect(isTextSubtitle(null)).toBe(true);
  });
});

describe('subtitleCachePath', () => {
  it('puts a track beside the segments of its own media', () => {
    expect(subtitleCachePath('/cache', 'media-1', 2)).toBe('/cache/media-1/subtitles/2.vtt');
  });

  it('names a sidecar track without a minus sign in the path', () => {
    expect(subtitleCachePath('/cache', 'media-1', -1)).toBe('/cache/media-1/subtitles/ext1.vtt');
  });
});

describe('extractSubtitle', () => {
  const cachePath = () => path.join(cacheRoot, 'cache', 'media-1', 'subtitles', '2.vtt');

  it('extracts the track and keeps the result', async () => {
    ffmpegWrites('WEBVTT\n\n00:00.000 --> 00:02.000\nHello');

    const result = await extractSubtitle({
      sourcePath: source,
      mapArgs: ['-map', '0:2'],
      cachePath: cachePath(),
    });

    expect(result).toEqual({ path: cachePath() });
    expect(fs.readFileSync(cachePath(), 'utf8')).toContain('Hello');
  });

  it('does not read the film again once it has the track', async () => {
    ffmpegWrites('WEBVTT');
    await extractSubtitle({ sourcePath: source, mapArgs: [], cachePath: cachePath() });

    await extractSubtitle({ sourcePath: source, mapArgs: [], cachePath: cachePath() });

    expect(spawned).toHaveLength(1);
  });

  it('selects the stream it was asked for', async () => {
    let seen: string[] = [];
    onSpawn = (args, child) => {
      seen = args;
      fs.writeFileSync(args[args.length - 1], 'WEBVTT');
      setImmediate(() => child.emit('close', 0));
    };

    await extractSubtitle({ sourcePath: source, mapArgs: ['-map', '0:3'], cachePath: cachePath() });

    expect(seen).toEqual(expect.arrayContaining(['-map', '0:3', '-c:s', 'webvtt']));
  });

  it('leaves nothing behind when the extraction fails', async () => {
    ffmpegWrites('half a file', 1);

    const result = await extractSubtitle({
      sourcePath: source,
      mapArgs: [],
      cachePath: cachePath(),
    });

    expect(result).toEqual({ error: 'Subtitle extraction failed' });
    expect(fs.existsSync(cachePath())).toBe(false);
    expect(fs.readdirSync(path.dirname(cachePath()))).toEqual([]);
  });

  it('reports an FFmpeg that will not start', async () => {
    onSpawn = (_args, child) => setImmediate(() => child.emit('error', new Error('ffmpeg not found')));

    expect(await extractSubtitle({ sourcePath: source, mapArgs: [], cachePath: cachePath() })).toEqual({
      error: 'ffmpeg not found',
    });
  });

  it('gives up on an extraction that never finishes', async () => {
    jest.useFakeTimers();
    try {
      onSpawn = (_args, child) => {
        child.on('close', () => {});
      };
      const extracting = extractSubtitle({
        sourcePath: source,
        mapArgs: [],
        cachePath: cachePath(),
        timeoutMs: 1000,
      });

      await jest.advanceTimersByTimeAsync(1001);
      expect(spawned[0].killed).toBe('SIGKILL');

      spawned[0].emit('close', 137);
      expect(await extracting).toEqual({ error: 'Subtitle extraction failed' });
    } finally {
      jest.useRealTimers();
    }
  });
});
