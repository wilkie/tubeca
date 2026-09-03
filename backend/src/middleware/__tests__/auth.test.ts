import express from 'express';
import request from 'supertest';
import { authenticate, requireRole } from '../auth';
import { AuthService } from '../../services/authService';

const authService = new AuthService();
const tokenFor = (role: 'Admin' | 'Editor' | 'Viewer') =>
  authService.generateToken({ userId: `user-${role}`, name: role, role });

function buildApp() {
  const app = express();
  app.get('/open', authenticate, (req, res) => res.json({ user: req.user }));
  app.get('/editor', authenticate, requireRole('Editor'), (_req, res) => res.json({ ok: true }));
  app.get('/admin', authenticate, requireRole('Admin'), (_req, res) => res.json({ ok: true }));
  app.get('/unauth-role', requireRole('Viewer'), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('authenticate', () => {
  const app = buildApp();

  it('rejects a missing Authorization header', async () => {
    const res = await request(app).get('/open');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Bearer scheme', async () => {
    const res = await request(app).get('/open').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/open').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('attaches the payload for a valid token', async () => {
    const res = await request(app)
      .get('/open')
      .set('Authorization', `Bearer ${tokenFor('Viewer')}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ userId: 'user-Viewer', role: 'Viewer' });
  });
});

describe('requireRole', () => {
  const app = buildApp();

  it.each([
    ['Viewer', '/editor', 403],
    ['Editor', '/editor', 200],
    ['Admin', '/editor', 200],
    ['Viewer', '/admin', 403],
    ['Editor', '/admin', 403],
    ['Admin', '/admin', 200],
  ] as const)('%s requesting %s gets %d', async (role, path, status) => {
    const res = await request(app).get(path).set('Authorization', `Bearer ${tokenFor(role)}`);
    expect(res.status).toBe(status);
  });

  it('returns 401 when used without authenticate', async () => {
    const res = await request(app).get('/unauth-role');
    expect(res.status).toBe(401);
  });
});
