import express from 'express';
import request from 'supertest';
import groupRoutes from '../groups';
import libraryRoutes from '../libraries';
import { prisma, resetDatabase, createGroup, createLibrary, createUser } from '../../test/db';

const app = express();
app.use(express.json());
app.use('/api/groups', groupRoutes);
app.use('/api/libraries', libraryRoutes);

let adminHeader: string;
let editorHeader: string;

beforeEach(async () => {
  await resetDatabase();
  adminHeader = (await createUser({ role: 'Admin' })).authHeader;
  editorHeader = (await createUser({ role: 'Editor' })).authHeader;
});

describe('group routes are admin only', () => {
  it('refuses every method to an editor', async () => {
    const group = await createGroup();

    expect((await request(app).get('/api/groups').set('Authorization', editorHeader)).status).toBe(403);
    expect(
      (await request(app).post('/api/groups').set('Authorization', editorHeader).send({ name: 'New' })).status
    ).toBe(403);
    expect(
      (await request(app)
        .patch(`/api/groups/${group.id}`)
        .set('Authorization', editorHeader)
        .send({ name: 'Renamed' })).status
    ).toBe(403);
    expect((await request(app).delete(`/api/groups/${group.id}`).set('Authorization', editorHeader)).status).toBe(
      403
    );
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(app).get('/api/groups')).status).toBe(401);
  });
});

describe('GET /api/groups', () => {
  it('lists groups by name with their user and library counts', async () => {
    const staff = await createGroup('Staff');
    await createGroup('Guests');
    await createLibrary({ name: 'Restricted', groupIds: [staff.id] });
    await createUser({ groupIds: [staff.id] });

    const res = await request(app).get('/api/groups').set('Authorization', adminHeader);

    expect(res.status).toBe(200);
    expect(res.body.groups.map((g: { name: string }) => g.name)).toEqual(['Guests', 'Staff']);
    const staffRow = res.body.groups.find((g: { name: string }) => g.name === 'Staff');
    expect(staffRow._count).toEqual({ users: 1, libraries: 1 });
  });
});

describe('POST /api/groups', () => {
  it('creates a group', async () => {
    const res = await request(app).post('/api/groups').set('Authorization', adminHeader).send({ name: 'Family' });

    expect(res.status).toBe(201);
    expect(res.body.group.name).toBe('Family');
    expect(await prisma.group.count()).toBe(1);
  });

  it('needs a name', async () => {
    const res = await request(app).post('/api/groups').set('Authorization', adminHeader).send({});

    expect(res.status).toBe(400);
  });

  it('refuses a name already in use', async () => {
    await createGroup('Family');

    const res = await request(app).post('/api/groups').set('Authorization', adminHeader).send({ name: 'Family' });

    expect(res.status).toBe(400);
    expect(await prisma.group.count()).toBe(1);
  });
});

describe('PATCH /api/groups/:id', () => {
  it('renames a group', async () => {
    const group = await createGroup('Old');

    const res = await request(app)
      .patch(`/api/groups/${group.id}`)
      .set('Authorization', adminHeader)
      .send({ name: 'New' });

    expect(res.status).toBe(200);
    expect((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).name).toBe('New');
  });

  it('is a 404 for a group that does not exist', async () => {
    const res = await request(app)
      .patch('/api/groups/nope')
      .set('Authorization', adminHeader)
      .send({ name: 'New' });

    expect(res.status).toBe(404);
  });

  it('refuses a name another group already has', async () => {
    await createGroup('Taken');
    const group = await createGroup('Mine');

    const res = await request(app)
      .patch(`/api/groups/${group.id}`)
      .set('Authorization', adminHeader)
      .send({ name: 'Taken' });

    expect(res.status).toBe(400);
    expect((await prisma.group.findUniqueOrThrow({ where: { id: group.id } })).name).toBe('Mine');
  });

  it('lets a group keep its own name', async () => {
    const group = await createGroup('Same');

    const res = await request(app)
      .patch(`/api/groups/${group.id}`)
      .set('Authorization', adminHeader)
      .send({ name: 'Same' });

    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/groups/:id', () => {
  it('deletes a group', async () => {
    const group = await createGroup();

    const res = await request(app).delete(`/api/groups/${group.id}`).set('Authorization', adminHeader);

    expect(res.status).toBe(204);
    expect(await prisma.group.count()).toBe(0);
  });

  it('is a 404 for a group that does not exist', async () => {
    const res = await request(app).delete('/api/groups/nope').set('Authorization', adminHeader);

    expect(res.status).toBe(404);
  });

  it('opens a restricted library to everyone, since it now has no groups', async () => {
    // This is the consequence worth knowing about: library visibility is
    // "no groups means public", so deleting the only group that restricted a
    // library makes it visible to every user.
    const group = await createGroup('Staff');
    const library = await createLibrary({ name: 'Restricted', groupIds: [group.id] });
    const outsider = await createUser();

    const before = await request(app).get('/api/libraries').set('Authorization', outsider.authHeader);
    expect(before.body.libraries).toHaveLength(0);

    await request(app).delete(`/api/groups/${group.id}`).set('Authorization', adminHeader);

    const after = await request(app).get('/api/libraries').set('Authorization', outsider.authHeader);
    expect(after.body.libraries.map((l: { id: string }) => l.id)).toEqual([library.id]);
  });

  it('removes the membership without removing the user', async () => {
    const group = await createGroup('Staff');
    const member = await createUser({ groupIds: [group.id] });

    await request(app).delete(`/api/groups/${group.id}`).set('Authorization', adminHeader);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: member.user.id },
      include: { groups: true },
    });
    expect(user.groups).toEqual([]);
  });
});
