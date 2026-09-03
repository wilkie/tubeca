import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import { prisma, resetDatabase, createUser } from '../../test/db';

// Encoder detection shells out to FFmpeg; the settings responses only need a
// stable answer.
const softwareEncoder = { name: 'x264 (Software)', encoder: 'libx264', type: 'software', priority: 100 };
const vaapiEncoder = { name: 'VAAPI', encoder: 'h264_vaapi', type: 'hardware', priority: 4 };
jest.unstable_mockModule('../../utils/hwaccel', () => ({
  detectBestEncoder: () => softwareEncoder,
  detectBestEncoderAsync: async () => softwareEncoder,
  listEncoderOptions: () => [vaapiEncoder, softwareEncoder],
  resolvePreferredEncoder: async () => null,
  getEncoderArgs: () => [],
  getEncoderInputArgs: () => [],
  SOFTWARE_ENCODER: softwareEncoder,
}));

const { default: settingsRoutes } = await import('../settings');
const { invalidateSettingsCache } = await import('../../services/transcodingSettingsService');

// Saving a new segment duration purges the HLS cache, so point the cache at a
// scratch directory before anything resolves the configured one.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-settings-'));
const cachePath = path.join(scratch, 'hls');
fs.writeFileSync(
  path.join(scratch, 'tubeca.config.json'),
  JSON.stringify({ hlsCache: { path: cachePath } })
);
process.env.TUBECA_CONFIG_PATH = path.join(scratch, 'tubeca.config.json');

const app = express();
app.use(express.json());
app.use('/api/settings', settingsRoutes);

let adminHeader: string;

beforeEach(async () => {
  await resetDatabase();
  // The service caches the settings row for 30 s; the row it cached no longer
  // exists after a reset.
  invalidateSettingsCache();
  adminHeader = (await createUser({ role: 'Admin' })).authHeader;
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function put(body: Record<string, unknown>) {
  return request(app).put('/api/settings/transcoding').set('Authorization', adminHeader).send(body);
}

describe('PUT /api/settings/transcoding', () => {
  it('saves a valid change', async () => {
    const res = await put({ preset: 'fast', maxConcurrentTranscodes: 4 });

    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ preset: 'fast', maxConcurrentTranscodes: 4 });
    const stored = await prisma.transcodingSettings.findFirstOrThrow();
    expect(stored.preset).toBe('fast');
  });

  it('rejects a value that would break playback and changes nothing', async () => {
    const before = (await put({ segmentDuration: 6 })).body.settings;

    const res = await put({ segmentDuration: -1, preset: 'fast' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid transcoding settings');
    expect(res.body.details).toEqual([
      { field: 'segmentDuration', message: expect.stringContaining('between 1 and 30') },
    ]);
    const stored = await prisma.transcodingSettings.findFirstOrThrow();
    expect(stored.segmentDuration).toBe(before.segmentDuration);
    expect(stored.preset).toBe(before.preset);
  });

  it('rejects a preset FFmpeg does not have', async () => {
    const res = await put({ preset: 'placebo' });

    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('preset');
  });

  it('purges cached segments when the segment duration changes', async () => {
    const segment = path.join(cachePath, 'media-1', 'adefault', '720p', '0.ts');
    fs.mkdirSync(path.dirname(segment), { recursive: true });
    fs.writeFileSync(segment, 'cached');

    const res = await put({ segmentDuration: 4 });

    expect(res.status).toBe(200);
    expect(fs.existsSync(segment)).toBe(false);
  });

  it('keeps cached segments when the segment duration is unchanged', async () => {
    await put({ segmentDuration: 4 });
    const segment = path.join(cachePath, 'media-2', 'adefault', '720p', '0.ts');
    fs.mkdirSync(path.dirname(segment), { recursive: true });
    fs.writeFileSync(segment, 'cached');

    await put({ segmentDuration: 4, preset: 'faster' });

    expect(fs.existsSync(segment)).toBe(true);
  });

  it('needs an Admin', async () => {
    const editor = await createUser({ role: 'Editor' });
    const res = await request(app)
      .put('/api/settings/transcoding')
      .set('Authorization', editor.authHeader)
      .send({ preset: 'fast' });

    expect(res.status).toBe(403);
  });
});
