import express from 'express';
import request from 'supertest';
import { authenticate } from '../auth';
import { requireLibraryAccess, collectionParam } from '../libraryAccess';
import {
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
} from '../../test/db';

/**
 * A role says a user edits somewhere; `Group.canEdit` says whether it is here.
 * These drive the middleware directly, since what it decides is the whole of
 * the feature and the sixteen routes behind it only pass it a resolver.
 */
const app = express();
app.get(
  '/collections/:id',
  authenticate,
  requireLibraryAccess(collectionParam('id'), { edit: true }),
  (_req, res) => res.json({ edited: true })
);
app.get(
  '/read/:id',
  authenticate,
  requireLibraryAccess(collectionParam('id')),
  (_req, res) => res.json({ read: true })
);

describe('editing a library a group grants', () => {
  beforeEach(resetDatabase);

  /** A library behind one group, holding one collection. */
  async function fixture(canEdit: boolean) {
    const group = await createGroup(undefined, { canEdit });
    const library = await createLibrary({ groupIds: [group.id] });
    const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
    const member = await createUser({ role: 'Editor', groupIds: [group.id] });
    return { group, library, collection, member };
  }

  it('lets an Editor edit a library their group may change', async () => {
    const { collection, member } = await fixture(true);

    const res = await request(app)
      .get(`/collections/${collection.id}`)
      .set('Authorization', member.authHeader);

    expect(res.status).toBe(200);
  });

  it('refuses one whose only group is view-only', async () => {
    const { collection, member } = await fixture(false);

    const res = await request(app)
      .get(`/collections/${collection.id}`)
      .set('Authorization', member.authHeader);

    // 403, not 404: they can see it, so pretending it is not there would only
    // confuse them.
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/read-only/i);
  });

  it('still lets them read it', async () => {
    const { collection, member } = await fixture(false);

    const res = await request(app)
      .get(`/read/${collection.id}`)
      .set('Authorization', member.authHeader);

    expect(res.status).toBe(200);
  });

  it('takes the union across a viewer\'s groups', async () => {
    // One group grants sight, another the right to change it.
    const viewOnly = await createGroup(undefined, { canEdit: false });
    const editing = await createGroup(undefined, { canEdit: true });
    const library = await createLibrary({ groupIds: [viewOnly.id, editing.id] });
    const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
    const member = await createUser({ role: 'Editor', groupIds: [viewOnly.id, editing.id] });

    const res = await request(app)
      .get(`/collections/${collection.id}`)
      .set('Authorization', member.authHeader);

    expect(res.status).toBe(200);
  });

  it('refuses when every group the viewer is in is view-only', async () => {
    const first = await createGroup(undefined, { canEdit: false });
    const second = await createGroup(undefined, { canEdit: false });
    const library = await createLibrary({ groupIds: [first.id, second.id] });
    const collection = await createCollection({ libraryId: library.id, name: 'Heat' });
    const member = await createUser({ role: 'Editor', groupIds: [first.id, second.id] });

    const res = await request(app)
      .get(`/collections/${collection.id}`)
      .set('Authorization', member.authHeader);

    expect(res.status).toBe(403);
  });

  it('never asks an Admin', async () => {
    const { collection } = await fixture(false);
    const admin = await createUser({ role: 'Admin' });

    const res = await request(app)
      .get(`/collections/${collection.id}`)
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
  });

  it('leaves a library with no groups editable, as it is visible', async () => {
    // A library behind no group is public; nothing scopes it either way.
    const library = await createLibrary();
    const collection = await createCollection({ libraryId: library.id, name: 'Public' });
    const member = await createUser({ role: 'Editor' });

    const res = await request(app)
      .get(`/collections/${collection.id}`)
      .set('Authorization', member.authHeader);

    expect(res.status).toBe(200);
  });

  it('hides a library the viewer cannot see at all, rather than calling it read-only', async () => {
    const { collection } = await fixture(true);
    const outsider = await createUser({ role: 'Editor' });

    const res = await request(app)
      .get(`/collections/${collection.id}`)
      .set('Authorization', outsider.authHeader);

    expect(res.status).toBe(404);
  });

  it('defaults a new group to editable, so nothing changes for an existing install', async () => {
    const group = await createGroup();

    expect(group.canEdit).toBe(true);
  });
});
