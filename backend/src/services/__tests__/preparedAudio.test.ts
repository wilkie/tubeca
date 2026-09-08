import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

interface FakeChild extends EventEmitter {
  stderr: EventEmitter
  args: string[]
}
const spawned: FakeChild[] = [];
jest.unstable_mockModule('child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new EventEmitter() as FakeChild;
    child.stderr = new EventEmitter();
    child.args = args;
    spawned.push(child);
    return child;
  },
}));

const { hasPreparedAudio, prepareAudio, preparedAudioPath } = await import('../preparedAudio');

let dir: string;
const settle = () => new Promise((r) => setImmediate(r));

let finished: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-audio-'));
  spawned.length = 0;
  finished = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Let the next encode start, then finish it the way FFmpeg would. */
async function finish(code: number) {
  for (let attempt = 0; attempt < 50 && spawned.length <= finished; attempt++) await settle();
  const child = spawned[finished++];
  // FFmpeg writes the file itself; the fake has to stand in for that.
  if (code === 0) {
    const temp = child.args[child.args.length - 1];
    fs.writeFileSync(temp, Buffer.alloc(32, 3));
  }
  child.emit('close', code);
}

const options = (over: Partial<Parameters<typeof prepareAudio>[0]> = {}) => ({
  videoPath: '/media/film.mkv',
  audioTrack: 'default',
  audioTrackDir: dir,
  bitrate: 192,
  ...over,
});

describe('prepareAudio', () => {
  it('encodes only the sound, at the bitrate the segments would have used', async () => {
    const done = prepareAudio(options());
    await finish(0);

    await expect(done).resolves.toBe(true);
    const args = spawned[0].args;
    expect(args).toContain('-vn');
    expect(args[args.indexOf('-map') + 1]).toBe('0:a:0');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args[args.indexOf('-b:a') + 1]).toBe('192k');
  });

  it('takes the audio track it was asked for', async () => {
    const done = prepareAudio(options({ audioTrack: '3' }));
    await finish(0);
    await done;

    expect(spawned[0].args[spawned[0].args.indexOf('-map') + 1]).toBe('0:3');
  });

  it('only names the file once it is whole', async () => {
    const done = prepareAudio(options());
    for (let attempt = 0; attempt < 50 && spawned.length === 0; attempt++) await settle();

    // Mid-encode: a segment looking now must not copy from a partial track.
    expect(hasPreparedAudio(dir)).toBe(false);
    expect(spawned[0].args[spawned[0].args.length - 1]).toContain('.part-');

    await finish(0);
    await done;
    expect(hasPreparedAudio(dir)).toBe(true);
  });

  it('leaves nothing behind when the encode fails', async () => {
    const done = prepareAudio(options());
    await finish(1);

    await expect(done).resolves.toBe(false);
    expect(hasPreparedAudio(dir)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('does not re-encode a track that is already there', async () => {
    fs.writeFileSync(preparedAudioPath(dir), Buffer.alloc(16, 1));

    await expect(prepareAudio(options())).resolves.toBe(true);
    expect(spawned).toHaveLength(0);
  });

  it('reads the file once however many callers ask', async () => {
    // Four rungs of one master playlist can ask at the same moment, and this
    // costs minutes of reading.
    const all = Promise.all([prepareAudio(options()), prepareAudio(options()), prepareAudio(options())]);
    await finish(0);

    await expect(all).resolves.toEqual([true, true, true]);
    expect(spawned).toHaveLength(1);
  });

  it('encodes one file at a time', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-audio-b-'));
    const first = prepareAudio(options());
    const second = prepareAudio(options({ audioTrackDir: other, videoPath: '/media/other.mkv' }));
    for (let attempt = 0; attempt < 20 && spawned.length === 0; attempt++) await settle();

    // The second waits: both would be reading whole files off the same disk
    // that is serving the playback which asked for them.
    expect(spawned).toHaveLength(1);

    await finish(0);
    await first;
    await finish(0);
    await second;
    expect(spawned).toHaveLength(2);
    fs.rmSync(other, { recursive: true, force: true });
  });
});
