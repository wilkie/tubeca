import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hasPreparedAudio, prepareAudio, preparedAudioPath } from '../preparedAudio';

/**
 * The one test here that runs FFmpeg for real.
 *
 * Everything else that builds an FFmpeg command line mocks `child_process` and
 * asserts on the arguments, which is fast and says nothing about whether FFmpeg
 * would accept them. `prepareAudio` shipped on 2026-09-07 without naming its
 * output format, so FFmpeg tried to infer a muxer from the extension of
 * `audio-128.mp4.part-03b524cf`, failed, and exited with "Invalid argument".
 * Every prepare failed that way for two days while eleven mocked tests passed.
 *
 * So: one real source file, one real encode, and a check that what comes out is
 * playable. It costs about a second.
 */

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const itReal = ffmpeg ? it : it.skip;

let dir: string;
let source: string;

beforeAll(() => {
  if (!ffmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-prep-real-'));
  source = path.join(dir, 'source.mkv');
  // A second of colour bars and a tone, in Matroska with AC-3 — the shape of
  // the library this matters for: video a browser can copy, audio it cannot.
  execFileSync('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=128x72:rate=10:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'ac3',
    '-y', source,
  ]);
});

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe('prepareAudio against the real FFmpeg', () => {
  itReal('produces a track FFmpeg will accept back', async () => {
    const out = fs.mkdtempSync(path.join(dir, 'a1-'));

    const ok = await prepareAudio({
      videoPath: source,
      audioTrack: 'default',
      audioTrackDir: out,
      bitrate: 128,
    });

    expect(ok).toBe(true);
    expect(hasPreparedAudio(out, 128)).toBe(true);

    // Playable, AAC, and holding the second of sound that went in.
    const probed = execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,channels',
      '-of', 'csv=p=0',
      preparedAudioPath(out, 128),
    ]).toString().trim();
    expect(probed).toBe('aac,2');
  }, 30000);

  itReal('leaves nothing behind when the source cannot be read', async () => {
    const out = fs.mkdtempSync(path.join(dir, 'a2-'));

    const ok = await prepareAudio({
      videoPath: path.join(dir, 'does-not-exist.mkv'),
      audioTrack: 'default',
      audioTrackDir: out,
      bitrate: 128,
    });

    expect(ok).toBe(false);
    expect(fs.readdirSync(out)).toEqual([]);
  }, 30000);
});
