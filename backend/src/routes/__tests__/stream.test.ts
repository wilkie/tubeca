import { jest } from '@jest/globals';
import express from 'express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { prisma, resetDatabase, createGroup, createLibrary, createCollection, createUser, createVideoMedia } from '../../test/db';

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

describe('stream route guards', () => {
  beforeEach(resetDatabase);

  async function fixture(opts: { path?: string; thumbnails?: string | null } = {}) {
    const library = await createLibrary({ libraryType: 'Television' });
    const show = await createCollection({ libraryId: library.id, name: 'Show', collectionType: 'Show' });
    const media = await createVideoMedia({
      path: opts.path ?? '/nonexistent/episode.mkv',
      duration: 30,
      collectionId: show.id,
    });
    if (opts.thumbnails !== undefined) {
      await prisma.media.update({ where: { id: media.id }, data: { thumbnails: opts.thumbnails } });
    }
    const { authHeader } = await createUser();
    return { media, authHeader };
  }

  describe('GET /video/:id', () => {
    it('is a 404 for a media that is not there', async () => {
      const { authHeader } = await fixture();

      const res = await request(app).get('/api/stream/video/missing').set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('is a 404 when the row points at a file that is gone', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/video/${media.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video file not found');
    });
  });

  describe('GET /audio/:id', () => {
    it('will not serve a video as audio', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/audio/${media.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Audio not found');
    });
  });

  describe('GET /subtitles/:id', () => {
    it('insists on a stream index', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/subtitles/${media.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });

    it('rejects an index that is not a number', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/subtitles/${media.id}?streamIndex=soon`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });

    it('is a 404 for a sidecar track nothing recorded', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/subtitles/${media.id}?streamIndex=-1`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Subtitle track not found');
    });

    it('is a 404 when the sidecar file has since been moved', async () => {
      const { media, authHeader } = await fixture();
      await prisma.mediaStream.create({
        data: {
          mediaId: media.id,
          streamIndex: -1,
          streamType: 'Subtitle',
          externalPath: '/nonexistent/episode.en.srt',
        },
      });

      const res = await request(app)
        .get(`/api/stream/subtitles/${media.id}?streamIndex=-1`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Subtitle file not found');
    });

    it('refuses a picture subtitle rather than returning an empty file', async () => {
      const { media, authHeader } = await fixture();
      await prisma.mediaStream.create({
        data: {
          mediaId: media.id,
          streamIndex: 3,
          streamType: 'Subtitle',
          codec: 'hdmv_pgs_subtitle',
        },
      });

      const res = await request(app)
        .get(`/api/stream/subtitles/${media.id}?streamIndex=3`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(415);
      expect(res.body.error).toMatch(/image format/);
    });

    it('is a 404 when the video the track lives in is gone', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/subtitles/${media.id}?streamIndex=2`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video file not found');
    });
  });

  describe('GET /trickplay/:id', () => {
    it('answers politely for a video that has none', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/trickplay/${media.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.trickplay).toEqual({ available: false, resolutions: [] });
    });

    it('says the same when the folder it recorded is gone', async () => {
      const { media, authHeader } = await fixture({ thumbnails: '/nonexistent/trickplay' });

      const res = await request(app)
        .get(`/api/stream/trickplay/${media.id}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.trickplay.available).toBe(false);
    });

    it('lists the widths it has sprites for', async () => {
      const trickplay = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-trickplay-'));
      fs.mkdirSync(path.join(trickplay, '320 - 10x10'));
      fs.writeFileSync(path.join(trickplay, '320 - 10x10', '0.jpg'), 'sprite');
      const { media, authHeader } = await fixture({ thumbnails: trickplay });

      const res = await request(app)
        .get(`/api/stream/trickplay/${media.id}`)
        .set('Authorization', authHeader);

      expect(res.body.trickplay.available).toBe(true);
      expect(res.body.trickplay.resolutions[0]).toMatchObject({ width: 320, columns: 10, rows: 10 });
      fs.rmSync(trickplay, { recursive: true, force: true });
    });
  });

  describe('GET /trickplay/:id/:width/:index', () => {
    it('is a 404 for a video with no sprites', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/trickplay/${media.id}/320/0`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No trickplay available');
    });

    it('is a 404 for a width it does not hold', async () => {
      const trickplay = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-trickplay-'));
      fs.mkdirSync(path.join(trickplay, '320 - 10x10'));
      const { media, authHeader } = await fixture({ thumbnails: trickplay });

      const res = await request(app)
        .get(`/api/stream/trickplay/${media.id}/640/0`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Resolution not found');
      fs.rmSync(trickplay, { recursive: true, force: true });
    });

    it('serves a sprite it does hold', async () => {
      const trickplay = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-trickplay-'));
      fs.mkdirSync(path.join(trickplay, '320 - 10x10'));
      fs.writeFileSync(path.join(trickplay, '320 - 10x10', '0.jpg'), 'sprite');
      const { media, authHeader } = await fixture({ thumbnails: trickplay });

      const res = await request(app)
        .get(`/api/stream/trickplay/${media.id}/320/0`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      fs.rmSync(trickplay, { recursive: true, force: true });
    });
  });

  describe('GET /hls/:id/:quality.m3u8', () => {
    it('rejects a quality that is not on the ladder', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/hls/${media.id}/2160p.m3u8`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid quality level');
    });
  });

  describe('GET /hls/:id/qualities', () => {
    it('offers the whole ladder, with labels and bitrates', async () => {
      const { media, authHeader } = await fixture();

      const res = await request(app)
        .get(`/api/stream/hls/${media.id}/qualities`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.qualities.map((q: { name: string }) => q.name)).toEqual([
        '1080p',
        '720p',
        '480p',
        '360p',
      ]);
      expect(res.body.qualities[0]).toMatchObject({ label: expect.any(String), height: 1080 });
    });

    it('has nothing to offer for a media that is not there', async () => {
      const { authHeader } = await fixture();

      const res = await request(app)
        .get('/api/stream/hls/missing/qualities')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.qualities).toEqual([]);
    });
  });
});

describe('playlists a player can follow without headers', () => {
  beforeEach(resetDatabase);

  async function playable() {
    const library = await createLibrary({ libraryType: 'Film' });
    const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
    const media = await createVideoMedia({
      path: '/nonexistent/heat.mkv',
      duration: 30,
      collectionId: collection.id,
    });
    const { authHeader, token } = await createUser();
    return { media, authHeader, token };
  }

  it('carries the token into every variant it offers', async () => {
    const { media, token } = await playable();

    const res = await request(app).get(`/api/stream/hls/${media.id}/master.m3u8?token=${token}`);

    expect(res.status).toBe(200);
    const variants = res.text.split('\n').filter((line) => line.endsWith('.m3u8') || line.includes('.m3u8?'));
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) {
      expect(variant).toContain(`token=${encodeURIComponent(token)}`);
    }
  });

  it('carries it into every segment of a variant too', async () => {
    const { media, token } = await playable();

    const res = await request(app).get(
      `/api/stream/hls/${media.id}/720p.m3u8?audioTrack=default&token=${token}`
    );

    expect(res.status).toBe(200);
    const segments = res.text.split('\n').filter((line) => line.includes('.ts?'));
    expect(segments.length).toBeGreaterThan(0);
    for (const segment of segments) {
      expect(segment).toContain(`token=${encodeURIComponent(token)}`);
    }
  });

  it('leaves the URIs bare for a client that authenticated by header', async () => {
    const { media, authHeader } = await playable();

    const res = await request(app)
      .get(`/api/stream/hls/${media.id}/master.m3u8`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('token=');
  });

  it('serves a segment listed in a playlist with only that token', async () => {
    const { media, token } = await playable();
    const playlist = await request(app).get(
      `/api/stream/hls/${media.id}/720p.m3u8?audioTrack=default&token=${token}`
    );
    const segment = playlist.text.split('\n').find((line) => line.includes('.ts?'))!;

    // The file behind it does not exist, so this gets as far as trying to read
    // it — which is past the authentication that used to reject it outright.
    const res = await request(app).get(`/api/stream/hls/${media.id}/${segment}`);

    expect(res.status).not.toBe(401);
  });
});
