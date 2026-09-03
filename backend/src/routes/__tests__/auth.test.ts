import express from 'express';
import request from 'supertest';
import authRoutes from '../auth';
import userRoutes from '../users';
import { AuthService } from '../../services/authService';
import { resetDatabase, createUser } from '../../test/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
const authService = new AuthService();

describe('POST /api/auth/media-token', () => {
  beforeEach(resetDatabase);

  const issue = async (authHeader: string) =>
    request(app).post('/api/auth/media-token').set('Authorization', authHeader);

  it('issues a scoped token with an expiry', async () => {
    const { user, authHeader } = await createUser();
    const res = await issue(authHeader);

    expect(res.status).toBe(200);
    const payload = authService.verifyToken(res.body.token);
    expect(payload).toMatchObject({ userId: user.id, scope: 'media' });
    // Four hours, give or take the round trip.
    const ttlMs = Date.parse(res.body.expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan(3.5 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
  });

  it('requires a session', async () => {
    expect((await request(app).post('/api/auth/media-token')).status).toBe(401);
  });

  it('will not drive the rest of the API', async () => {
    const { authHeader } = await createUser();
    const { body } = await issue(authHeader);

    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/cannot be used for API requests/i);
  });

  it('cannot be issued from another media token', async () => {
    const { authHeader } = await createUser();
    const { body } = await issue(authHeader);

    expect((await issue(`Bearer ${body.token}`)).status).toBe(401);
  });
});
