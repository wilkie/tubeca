import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import request from 'supertest';
import { mountFrontend, resolveFrontendDist } from '../frontend';

describe('mountFrontend', () => {
  let dist: string;
  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'tubeca-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<html>app</html>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
  });
  afterEach(() => fs.rmSync(dist, { recursive: true, force: true }));

  function buildApp(dir = dist) {
    const app = express();
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    const mounted = mountFrontend(app, dir);
    app.use((_req, res) => res.status(404).json({ error: 'not found' }));
    return { app, mounted };
  }

  it('serves hashed assets immutable and index.html uncached', async () => {
    const { app, mounted } = buildApp();
    expect(mounted).toBe(true);
    const asset = await request(app).get('/assets/index-abc.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    const index = await request(app).get('/index.html');
    expect(index.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for client routes but not for API or file-like paths', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/library/abc')).text).toContain('app');
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
    expect((await request(app).get('/api/missing')).status).toBe(404);
    expect((await request(app).get('/assets/missing.js')).status).toBe(404);
    expect((await request(app).post('/library/abc')).status).toBe(404);
  });

  it('mounts nothing when the build output is absent', async () => {
    const { app, mounted } = buildApp(path.join(dist, 'nope'));
    expect(mounted).toBe(false);
    expect((await request(app).get('/library/abc')).status).toBe(404);
  });

  it('honours FRONTEND_DIST', () => {
    expect(resolveFrontendDist({ FRONTEND_DIST: '/srv/ui' })).toBe('/srv/ui');
    expect(resolveFrontendDist({})).toMatch(/frontend[\\/]ui[\\/]dist$/);
  });
});
