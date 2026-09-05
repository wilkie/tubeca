import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

/** A stand-in for the FFmpeg that writes sprite sheets. */
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

const { generateTrickplay, hasTrickplay, layoutFolder, readManifest, removeTrickplay, trickplayRoot } =
  await import('../trickplayService');

let storage: string;
let source: string;
const layout = { interval: 10, width: 320, columns: 10, rows: 10 };

/** Answer the next generation by writing `count` sheets and exiting cleanly. */
function ffmpegWrites(count: number, code = 0) {
  onSpawn = (args, child) => {
    const pattern = args[args.length - 1];
    const dir = path.dirname(pattern);
    for (let i = 0; i < count; i++) fs.writeFileSync(path.join(dir, `${i}.jpg`), 'sheet');
    setImmediate(() => child.emit('close', code));
  };
}

beforeEach(() => {
  spawned.length = 0;
  onSpawn = undefined;
  storage = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-trickplay-'));
  source = path.join(storage, 'film.mkv');
  fs.writeFileSync(source, 'not really a film');
});

afterEach(() => fs.rmSync(storage, { recursive: true, force: true }));

const generate = () =>
  generateTrickplay({ mediaId: 'media-1', sourcePath: source, layout, storageRoot: storage });

describe('where sprites live', () => {
  it('keeps them under the image store, not beside a library that may be read-only', () => {
    expect(trickplayRoot('media-1', '/store')).toBe('/store/trickplay/media-1');
  });

  it('names the folder the way the serving route parses it', () => {
    expect(layoutFolder(layout)).toBe('320 - 10x10');
  });
});

describe('generateTrickplay', () => {
  it('samples the film and packs the frames into sheets', async () => {
    let args: string[] = [];
    onSpawn = (spawnArgs, child) => {
      args = spawnArgs;
      const dir = path.dirname(spawnArgs[spawnArgs.length - 1]);
      fs.writeFileSync(path.join(dir, '0.jpg'), 'sheet');
      setImmediate(() => child.emit('close', 0));
    };

    const result = await generate();

    expect(args).toEqual(
      expect.arrayContaining(['-vf', 'fps=1/10,scale=320:-2,tile=10x10', '-start_number', '0'])
    );
    expect(result).toMatchObject({ path: trickplayRoot('media-1', storage), spriteCount: 1 });
  });

  it('leaves the sheets where the serving route looks for them', async () => {
    ffmpegWrites(3);

    await generate();

    const folder = path.join(trickplayRoot('media-1', storage), '320 - 10x10');
    expect(fs.readdirSync(folder).filter((f) => f.endsWith('.jpg')).sort()).toEqual([
      '0.jpg',
      '1.jpg',
      '2.jpg',
    ]);
  });

  it('reads no audio or subtitles it will not use', async () => {
    let args: string[] = [];
    onSpawn = (spawnArgs, child) => {
      args = spawnArgs;
      fs.writeFileSync(path.join(path.dirname(spawnArgs[spawnArgs.length - 1]), '0.jpg'), 's');
      setImmediate(() => child.emit('close', 0));
    };

    await generate();

    expect(args).toEqual(expect.arrayContaining(['-an', '-sn']));
  });

  it('builds elsewhere and moves in, so a half-finished set is never served', async () => {
    let stagingDuring = '';
    onSpawn = (args, child) => {
      stagingDuring = path.dirname(args[args.length - 1]);
      fs.writeFileSync(path.join(stagingDuring, '0.jpg'), 'sheet');
      setImmediate(() => child.emit('close', 0));
    };

    await generate();

    expect(stagingDuring).toMatch(/\.building$/);
    expect(fs.existsSync(stagingDuring)).toBe(false);
  });

  it('replaces an earlier set rather than mixing the two', async () => {
    ffmpegWrites(3);
    await generate();
    ffmpegWrites(1);

    await generate();

    const folder = path.join(trickplayRoot('media-1', storage), '320 - 10x10');
    expect(fs.readdirSync(folder).filter((f) => f.endsWith('.jpg'))).toEqual(['0.jpg']);
  });

  it('refuses a file that is not there', async () => {
    await expect(
      generateTrickplay({
        mediaId: 'media-1',
        sourcePath: path.join(storage, 'gone.mkv'),
        layout,
        storageRoot: storage,
      })
    ).rejects.toThrow(/No file at/);
  });

  it('leaves nothing behind when FFmpeg fails', async () => {
    ffmpegWrites(2, 1);

    await expect(generate()).rejects.toThrow(/exited with code 1/);
    expect(fs.existsSync(trickplayRoot('media-1', storage))).toBe(true);
    expect(fs.readdirSync(trickplayRoot('media-1', storage))).toEqual([]);
  });

  it('treats a clean exit that produced nothing as a failure', async () => {
    ffmpegWrites(0);

    await expect(generate()).rejects.toThrow('FFmpeg produced no sprites');
  });

  it('reports an FFmpeg that will not start', async () => {
    onSpawn = (_args, child) => setImmediate(() => child.emit('error', new Error('ffmpeg missing')));

    await expect(generate()).rejects.toThrow('ffmpeg missing');
  });

  it('gives up on a run that never finishes', async () => {
    jest.useFakeTimers();
    try {
      onSpawn = () => {};
      const generating = generateTrickplay({
        mediaId: 'media-1',
        sourcePath: source,
        layout,
        storageRoot: storage,
        timeoutMs: 1000,
      });
      const settled = expect(generating).rejects.toThrow(/exited with code/);

      await jest.advanceTimersByTimeAsync(1001);
      expect(spawned[0].killed).toBe('SIGKILL');
      spawned[0].emit('close', 137);
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the manifest', () => {
  const folder = () => path.join(trickplayRoot('media-1', storage), '320 - 10x10');

  it('records what the sheets are, so nothing downstream has to assume', async () => {
    ffmpegWrites(2);

    await generate();

    expect(readManifest(folder())).toMatchObject({
      interval: 10,
      width: 320,
      columns: 10,
      rows: 10,
      spriteCount: 2,
    });
  });

  it('records the interval it was actually given, not the usual one', async () => {
    ffmpegWrites(1);

    await generateTrickplay({
      mediaId: 'media-1',
      sourcePath: source,
      layout: { interval: 4, width: 200, columns: 5, rows: 5 },
      storageRoot: storage,
    });

    expect(readManifest(path.join(trickplayRoot('media-1', storage), '200 - 5x5'))).toMatchObject({
      interval: 4,
      width: 200,
      columns: 5,
      rows: 5,
    });
  });

  it('measures a tile rather than trusting the requested width', async () => {
    ffmpegWrites(1);
    await generate();

    const manifest = readManifest(folder());
    // The fake sheets are not images, so the measurement falls back to the
    // shape that was asked for.
    expect(manifest).toMatchObject({ tileWidth: 320, tileHeight: 180 });
  });

  it('has nothing to say about sheets that came with the library', () => {
    fs.mkdirSync(folder(), { recursive: true });
    fs.writeFileSync(path.join(folder(), '0.jpg'), 'sheet');

    expect(readManifest(folder())).toBeNull();
  });

  it('ignores a manifest that is not ours or not sense', () => {
    fs.mkdirSync(folder(), { recursive: true });
    fs.writeFileSync(path.join(folder(), 'manifest.json'), 'not json at all');
    expect(readManifest(folder())).toBeNull();

    fs.writeFileSync(path.join(folder(), 'manifest.json'), JSON.stringify({ interval: 'ten' }));
    expect(readManifest(folder())).toBeNull();

    fs.writeFileSync(path.join(folder(), 'manifest.json'), JSON.stringify({ interval: 0, width: 320, columns: 10, rows: 10 }));
    expect(readManifest(folder())).toBeNull();
  });

  it('does not let a manifest alone pass for sprites', () => {
    fs.mkdirSync(folder(), { recursive: true });
    fs.writeFileSync(path.join(folder(), 'manifest.json'), JSON.stringify({ interval: 10 }));

    expect(hasTrickplay('media-1', storage)).toBe(false);
  });
});

describe('hasTrickplay and removeTrickplay', () => {
  it('knows when a media item has sprites and when it has none', async () => {
    expect(hasTrickplay('media-1', storage)).toBe(false);
    ffmpegWrites(1);
    await generate();

    expect(hasTrickplay('media-1', storage)).toBe(true);
  });

  it('does not count an empty folder as sprites', () => {
    fs.mkdirSync(path.join(trickplayRoot('media-1', storage), '320 - 10x10'), { recursive: true });

    expect(hasTrickplay('media-1', storage)).toBe(false);
  });

  it('removes them, and does not mind being asked twice', async () => {
    ffmpegWrites(1);
    await generate();

    removeTrickplay('media-1', storage);
    removeTrickplay('media-1', storage);

    expect(fs.existsSync(trickplayRoot('media-1', storage))).toBe(false);
  });
});
