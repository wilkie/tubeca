import express from 'express';
import request from 'supertest';
import userRoutes from '../users';
import { AuthService } from '../../services/authService';
import { prisma, resetDatabase, createUser } from '../../test/db';

const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);
const authService = new AuthService();

describe('last-admin guards', () => {
  beforeEach(resetDatabase);

  it('refuses to delete or demote the only Admin', async () => {
    const admin = await createUser({ role: 'Admin' });
    const other = await createUser({ role: 'Admin' });
    // Deleting one of two is fine.
    expect(
      (await request(app).delete(`/api/users/${other.user.id}`).set('Authorization', admin.authHeader)).status
    ).toBe(204);

    const viewer = await createUser({ role: 'Viewer' });
    const deleteLast = await request(app)
      .delete(`/api/users/${admin.user.id}`)
      .set('Authorization', viewer.authHeader);
    expect(deleteLast.status).toBe(403); // not an admin at all

    const demote = await request(app)
      .patch(`/api/users/${admin.user.id}/role`)
      .set('Authorization', admin.authHeader)
      .send({ role: 'Viewer' });
    expect(demote.status).toBe(400);
    expect(demote.body.error).toMatch(/last remaining Admin/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).role).toBe('Admin');
  });

  it('allows demoting an Admin while another remains', async () => {
    const admin = await createUser({ role: 'Admin' });
    const second = await createUser({ role: 'Admin' });

    const res = await request(app)
      .patch(`/api/users/${second.user.id}/role`)
      .set('Authorization', admin.authHeader)
      .send({ role: 'Editor' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('Editor');
  });

  it('ends the demoted user’s sessions', async () => {
    const admin = await createUser({ role: 'Admin' });
    const second = await createUser({ role: 'Admin' });

    await request(app)
      .patch(`/api/users/${second.user.id}/role`)
      .set('Authorization', admin.authHeader)
      .send({ role: 'Viewer' });

    const res = await request(app).get('/api/users/me').set('Authorization', second.authHeader);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/users/me', () => {
  beforeEach(resetDatabase);

  it('changes your own password and hands back a working token', async () => {
    const { user, authHeader } = await createUser({ role: 'Viewer' });

    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', authHeader)
      .send({ currentPassword: 'password', newPassword: 'a-longer-secret' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    // The old token no longer works; the new one does.
    expect((await request(app).get('/api/users/me').set('Authorization', authHeader)).status).toBe(401);
    expect(
      (await request(app).get('/api/users/me').set('Authorization', `Bearer ${res.body.token}`)).status
    ).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await authService.verifyPassword('a-longer-secret', stored.passwordHash)).toBe(true);
  });

  it('rejects a wrong current password and a too-short new one', async () => {
    const { authHeader } = await createUser();

    const wrong = await request(app)
      .patch('/api/users/me')
      .set('Authorization', authHeader)
      .send({ currentPassword: 'nope', newPassword: 'a-longer-secret' });
    expect(wrong.status).toBe(401);

    const short = await request(app)
      .patch('/api/users/me')
      .set('Authorization', authHeader)
      .send({ currentPassword: 'password', newPassword: 'short' });
    expect(short.status).toBe(400);

    const missing = await request(app).patch('/api/users/me').set('Authorization', authHeader).send({});
    expect(missing.status).toBe(400);
  });

  it('is available to any signed-in user, not just Admins', async () => {
    const { authHeader } = await createUser({ role: 'Viewer' });
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', authHeader)
      .send({ currentPassword: 'password', newPassword: 'another-secret' });
    expect(res.status).toBe(200);
  });
});
