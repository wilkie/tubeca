import { jest } from '@jest/globals';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { resetDatabase, createGroup, createLibrary, createCollection, createUser, createVideoMedia } from '../../test/db';

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-stream-test-'));
const actualAppConfig = await import('../../config/appConfig');
const softwareEncoder = { name: 'libx264', encoder: 'libx264', type: 'software', priority: 100 };
jest.unstable_mockModule('../../utils/hwaccel', () => ({
  detectBestEncoder: () => softwareEncoder,
  detectBestEncoderAsync: async () => softwareEncoder,
  getEncoderArgs: () => [],
  getEncoderInputArgs: () => [],
  getEncoder: () => softwareEncoder,
  isHardwareAccelerated: () => false,
  listEncoderOptions: () => [softwareEncoder],
  resolvePreferredEncoder: async () => null,
  SOFTWARE_ENCODER: softwareEncoder,
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

  it('accepts a media-scoped token in the query string, subject to the same rules', async () => {
    const { media, member } = await fixture();
    const { AuthService, bumpTokenVersion } = await import('../../services/authService');
    const authService = new AuthService();
    const { token: mediaToken } = authService.generateMediaToken({
      userId: member.user.id,
      name: member.user.name,
      role: member.user.role,
      tokenVersion: member.user.tokenVersion,
    });

    const url = `/api/stream/hls/${media.id}/master.m3u8`;
    expect((await request(app).get(`${url}?token=${mediaToken}`)).status).toBe(200);

    // Invalidating the session invalidates media URLs too.
    await bumpTokenVersion(member.user.id);
    expect((await request(app).get(`${url}?token=${mediaToken}`)).status).toBe(401);
  });
});
