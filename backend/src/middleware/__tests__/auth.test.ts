import express from 'express';
import request from 'supertest';
import { authenticate, requireRole } from '../auth';
import { AuthService, bumpTokenVersion, forgetTokenVersion } from '../../services/authService';
import { prisma, resetDatabase, createUser } from '../../test/db';

const authService = new AuthService();

type TestRole = 'Admin' | 'Editor' | 'Viewer';

/**
 * `authenticate` now checks that the token's user still exists and that its
 * version is current, so these tests need real rows rather than synthetic ids.
 */
const headers: Record<TestRole, string> = { Admin: '', Editor: '', Viewer: '' };
const userIds: Record<TestRole, string> = { Admin: '', Editor: '', Viewer: '' };

async function seedUsers() {
  await resetDatabase();
  for (const role of ['Admin', 'Editor', 'Viewer'] as TestRole[]) {
    const created = await createUser({ role });
    headers[role] = created.authHeader;
    userIds[role] = created.user.id;
  }
}

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

  beforeEach(seedUsers);

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
    const res = await request(app).get('/open').set('Authorization', headers.Viewer);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ userId: userIds.Viewer, role: 'Viewer' });
  });
});

describe('requireRole', () => {
  const app = buildApp();

  beforeEach(seedUsers);

  it.each([
    ['Viewer', '/editor', 403],
    ['Editor', '/editor', 200],
    ['Admin', '/editor', 200],
    ['Viewer', '/admin', 403],
    ['Editor', '/admin', 403],
    ['Admin', '/admin', 200],
  ] as const)('%s requesting %s gets %d', async (role, path, status) => {
    const res = await request(app).get(path).set('Authorization', headers[role]);
    expect(res.status).toBe(status);
  });

  it('returns 401 when used without authenticate', async () => {
    const res = await request(app).get('/unauth-role');
    expect(res.status).toBe(401);
  });
});

describe('session invalidation', () => {
  const app = buildApp();

  beforeEach(resetDatabase);

  it('accepts a token that matches the user’s current version', async () => {
    const { authHeader } = await createUser();
    expect((await request(app).get('/open').set('Authorization', authHeader)).status).toBe(200);
  });

  it('rejects a token issued before the version was bumped', async () => {
    const { user, authHeader } = await createUser();
    expect((await request(app).get('/open').set('Authorization', authHeader)).status).toBe(200);

    await bumpTokenVersion(user.id);

    const res = await request(app).get('/open').set('Authorization', authHeader);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/sign in again/i);
  });

  it('rejects a token for a user that no longer exists', async () => {
    const { user, authHeader } = await createUser();
    await prisma.user.delete({ where: { id: user.id } });
    forgetTokenVersion(user.id);

    expect((await request(app).get('/open').set('Authorization', authHeader)).status).toBe(401);
  });

  it('still accepts tokens issued before versioning existed', async () => {
    const { user } = await createUser();
    // No tokenVersion claim, as tokens minted by earlier releases had none.
    const legacy = authService.generateToken({ userId: user.id, name: user.name, role: user.role });

    expect((await request(app).get('/open').set('Authorization', `Bearer ${legacy}`)).status).toBe(200);
  });
});
