import type { CollectionType, LibraryType, Role } from '@prisma/client';
import { prisma } from '../config/database';
import { AuthService } from '../services/authService';

const authService = new AuthService();

/**
 * Delete every row in dependency order. Call from `beforeEach` in tests that
 * touch the database.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.userCollectionItem.deleteMany(),
    prisma.userCollection.deleteMany(),
    prisma.image.deleteMany(),
    prisma.filmCredit.deleteMany(),
    prisma.showCredit.deleteMany(),
    prisma.albumCredit.deleteMany(),
    prisma.artistMember.deleteMany(),
    prisma.credit.deleteMany(),
    prisma.mediaStream.deleteMany(),
    prisma.videoDetails.deleteMany(),
    prisma.audioDetails.deleteMany(),
    prisma.media.deleteMany(),
    prisma.showDetails.deleteMany(),
    prisma.seasonDetails.deleteMany(),
    prisma.filmDetails.deleteMany(),
    prisma.artistDetails.deleteMany(),
    prisma.albumDetails.deleteMany(),
    prisma.collection.deleteMany(),
    prisma.keyword.deleteMany(),
    prisma.library.deleteMany(),
    prisma.group.deleteMany(),
    prisma.user.deleteMany(),
    prisma.person.deleteMany(),
    prisma.settings.deleteMany(),
    prisma.transcodingSettings.deleteMany(),
  ]);
}

let counter = 0;
const unique = (prefix: string) => `${prefix}-${++counter}-${Date.now()}`;

export async function createUser(opts: { name?: string; role?: Role; groupIds?: string[] } = {}) {
  const user = await prisma.user.create({
    data: {
      name: opts.name ?? unique('user'),
      passwordHash: await authService.hashPassword('password'),
      role: opts.role ?? 'Viewer',
      groups: opts.groupIds ? { connect: opts.groupIds.map((id) => ({ id })) } : undefined,
    },
  });
  const token = authService.generateToken({ userId: user.id, name: user.name, role: user.role });
  return { user, token, authHeader: `Bearer ${token}` };
}

export async function createGroup(name?: string) {
  return prisma.group.create({ data: { name: name ?? unique('group') } });
}

export async function createLibrary(
  opts: { name?: string; libraryType?: LibraryType; groupIds?: string[]; path?: string } = {}
) {
  return prisma.library.create({
    data: {
      name: opts.name ?? unique('library'),
      path: opts.path ?? '/tmp/tubeca-test-library',
      libraryType: opts.libraryType ?? 'Film',
      groups: opts.groupIds ? { connect: opts.groupIds.map((id) => ({ id })) } : undefined,
    },
  });
}

export async function createCollection(opts: {
  libraryId: string;
  name: string;
  collectionType?: CollectionType;
  parentId?: string | null;
  filmDetails?: { releaseDate?: Date; rating?: number; runtime?: number; contentRating?: string };
  keywords?: string[];
}) {
  return prisma.collection.create({
    data: {
      libraryId: opts.libraryId,
      name: opts.name,
      collectionType: opts.collectionType ?? 'Film',
      parentId: opts.parentId ?? null,
      filmDetails: opts.filmDetails ? { create: opts.filmDetails } : undefined,
      keywords: opts.keywords
        ? {
            connectOrCreate: opts.keywords.map((name) => ({
              where: { name },
              create: { name },
            })),
          }
        : undefined,
    },
    include: { filmDetails: true, keywords: true },
  });
}

export async function createVideoMedia(opts: {
  name?: string;
  path: string;
  duration: number;
  collectionId?: string;
}) {
  return prisma.media.create({
    data: {
      name: opts.name ?? unique('media'),
      path: opts.path,
      duration: opts.duration,
      type: 'Video',
      collectionId: opts.collectionId,
    },
  });
}

export { prisma };
