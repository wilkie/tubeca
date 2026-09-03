import { LibraryService } from '../libraryService';
import { resetDatabase, createGroup, createLibrary, createUser } from '../../test/db';

const service = new LibraryService();

describe('LibraryService group access', () => {
  beforeEach(resetDatabase);

  it('admins see every library', async () => {
    const group = await createGroup();
    await createLibrary({ name: 'Public' });
    await createLibrary({ name: 'Restricted', groupIds: [group.id] });
    const { user } = await createUser({ role: 'Admin' });

    const libraries = await service.getAccessibleLibraries(user.id, true);
    expect(libraries.map((l) => l.name).sort()).toEqual(['Public', 'Restricted']);
  });

  it('libraries with no groups are visible to everyone', async () => {
    const lib = await createLibrary({ name: 'Public' });
    const { user } = await createUser({ role: 'Viewer' });

    const libraries = await service.getAccessibleLibraries(user.id, false);
    expect(libraries.map((l) => l.id)).toEqual([lib.id]);
    expect(await service.canUserAccessLibrary(user.id, false, lib.id)).toBe(true);
  });

  it('group-restricted libraries are visible only to members', async () => {
    const group = await createGroup();
    const restricted = await createLibrary({ name: 'Restricted', groupIds: [group.id] });
    const { user: member } = await createUser({ groupIds: [group.id] });
    const { user: outsider } = await createUser();

    expect((await service.getAccessibleLibraries(member.id, false)).map((l) => l.id)).toEqual([
      restricted.id,
    ]);
    expect(await service.getAccessibleLibraries(outsider.id, false)).toEqual([]);
    expect(await service.canUserAccessLibrary(member.id, false, restricted.id)).toBe(true);
    expect(await service.canUserAccessLibrary(outsider.id, false, restricted.id)).toBe(false);
  });

  it('a user in one of several groups on a library can access it', async () => {
    const [a, b] = await Promise.all([createGroup(), createGroup()]);
    const lib = await createLibrary({ groupIds: [a.id, b.id] });
    const { user } = await createUser({ groupIds: [b.id] });

    expect(await service.canUserAccessLibrary(user.id, false, lib.id)).toBe(true);
  });
});
