import { jest } from '@jest/globals';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { resetDatabase, createGroup, createLibrary, createCollection, createUser, createVideoMedia } from '../../test/db';

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-stream-test-'));
const actualAppConfig = await import('../../config/appConfig');
jest.unstable_mockModule('../../utils/hwaccel', () => ({
  detectBestEncoder: () => ({ name: 'libx264', type: 'software', available: true }),
  getEncoderArgs: () => [],
  getEncoder: () => ({ name: 'libx264', type: 'software', available: true }),
  isHardwareAccelerated: () => false,
}));
jest.unstable_mockModule('../../config/appConfig', () => ({
  ...actualAppConfig,
  loadAppConfig: () => ({}),
  getHlsCacheConfig: () => ({ path: cacheDir, maxSizeGB: 1, segmentTTLHours: 1, segmentDuration: 6 }),
  getHlsCachePath: () => cacheDir,
}));

const { default: streamRoutes } = await import('../stream');

const app = express();
app.use('/api/stream', streamRoutes);

describe('stream routes enforce library access', () => {
  beforeEach(resetDatabase);
  afterAll(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

  async function fixture() {
    const group = await createGroup();
    const library = await createLibrary({ libraryType: 'Television', groupIds: [group.id] });
    const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
    const media = await createVideoMedia({ path: '/nonexistent/episode.mkv', duration: 30, collectionId: show.id });
    const member = await createUser({ groupIds: [group.id] });
    const outsider = await createUser();
    return { media, member, outsider };
  }

  it('hides the HLS master playlist from outsiders, including via ?token=', async () => {
    const { media, member, outsider } = await fixture();
    const url = `/api/stream/hls/${media.id}/master.m3u8`;

    expect((await request(app).get(url).set('Authorization', outsider.authHeader)).status).toBe(404);
    expect((await request(app).get(`${url}?token=${outsider.token}`)).status).toBe(404);

    const ok = await request(app).get(`${url}?token=${member.token}`);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('#EXTM3U');
  });

  it('applies to the qualities and trickplay endpoints too', async () => {
    const { media, outsider } = await fixture();
    for (const url of [`/api/stream/hls/${media.id}/qualities`, `/api/stream/trickplay/${media.id}`]) {
      expect((await request(app).get(url).set('Authorization', outsider.authHeader)).status).toBe(404);
    }
  });
});
