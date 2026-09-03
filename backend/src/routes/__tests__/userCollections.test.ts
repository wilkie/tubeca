import express from 'express';
import request from 'supertest';
import userCollectionRoutes from '../userCollections';
import { filterItemsByLibraryAccess } from '../../services/userCollectionService';
import {
  prisma,
  resetDatabase,
  createGroup,
  createLibrary,
  createCollection,
  createUser,
  createVideoMedia,
} from '../../test/db';

const app = express();
app.use(express.json());
app.use('/api/user-collections', userCollectionRoutes);

describe('filterItemsByLibraryAccess', () => {
  const items = [
    { collection: { library: { id: 'lib-a' } } },
    { media: { collection: { library: { id: 'lib-b' } } } },
    { media: { collection: null } },
    { itemUserCollection: { id: 'x' } },
  ];

  it('keeps everything for admins', () => {
    expect(filterItemsByLibraryAccess({ items, _count: { items: 4 } }, undefined).items).toHaveLength(4);
  });

  it('drops items outside the scope and orphaned media, keeps nested user collections', () => {
    const result = filterItemsByLibraryAccess({ items, _count: { items: 4 } }, ['lib-a']);
    expect(result.items).toEqual([items[0], items[3]]);
    expect(result._count.items).toBe(2);
  });
});

describe('public user collections hide restricted titles', () => {
  beforeEach(resetDatabase);

  it('shows an item only to viewers who can access its library', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ groupIds: [group.id] });
    const film = await createCollection({ libraryId: restricted.id, name: 'Secret Film' });
    const media = await createVideoMedia({ path: '/s.mkv', duration: 10, collectionId: film.id });
    const owner = await createUser({ groupIds: [group.id] });
    const outsider = await createUser();

    const shared = await prisma.userCollection.create({
      data: { userId: owner.user.id, name: 'Shared', isPublic: true, collectionType: 'Set' },
    });
    await prisma.userCollectionItem.createMany({
      data: [
        { userCollectionId: shared.id, collectionId: film.id, position: 0 },
        { userCollectionId: shared.id, mediaId: media.id, position: 1 },
      ],
    });

    const asOwner = await request(app).get(`/api/user-collections/${shared.id}`).set('Authorization', owner.authHeader);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.userCollection.items).toHaveLength(2);

    const asOutsider = await request(app).get(`/api/user-collections/${shared.id}`).set('Authorization', outsider.authHeader);
    expect(asOutsider.status).toBe(200);
    expect(asOutsider.body.userCollection.items).toEqual([]);
    expect(asOutsider.body.userCollection._count.items).toBe(0);
  });
});
