import { prisma } from '../config/database';
import { contentDeletionService } from './contentDeletionService';
import type { LibraryType } from '@prisma/client';
import { promises as fsp } from 'fs';

export interface CreateLibraryInput {
  name: string
  path: string
  libraryType: LibraryType
  groupIds?: string[]
  watchForChanges?: boolean
}

export interface UpdateLibraryInput {
  name?: string
  path?: string
  libraryType?: LibraryType
  groupIds?: string[]
  watchForChanges?: boolean
}

export class LibraryService {
  /**
   * Get all libraries (for admins only - no filtering)
   */
  async getAllLibraries() {
    return prisma.library.findMany({
      include: {
        groups: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get libraries accessible by a specific user.
   * Admin users can access all libraries.
   * Other users can only access libraries that have no groups assigned (public)
   * or libraries where they're a member of at least one assigned group.
   */
  async getAccessibleLibraries(userId: string, isAdmin: boolean) {
    // Admins can see all libraries
    if (isAdmin) {
      return this.getAllLibraries();
    }

    // For non-admins, get user's group IDs
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        groups: { select: { id: true } },
      },
    });

    const userGroupIds = user?.groups.map(g => g.id) ?? [];

    // Get libraries where:
    // 1. Library has no groups assigned (public), OR
    // 2. Library has at least one group that the user is a member of
    return prisma.library.findMany({
      where: {
        OR: [
          // Public libraries (no groups assigned)
          { groups: { none: {} } },
          // Libraries the user has access to via groups
          ...(userGroupIds.length > 0
            ? [{ groups: { some: { id: { in: userGroupIds } } } }]
            : []),
        ],
      },
      include: {
        groups: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The libraries an Editor may change, as ids.
   *
   * Access and edit are different questions. A group grants access to its
   * libraries; `canEdit` says whether that grant includes changing them, so an
   * Editor can be given the run of one library and a read-only view of
   * another. Admins are not asked, and a library with no groups at all is
   * public — visible to everyone and, since nothing scopes it, editable by any
   * Editor.
   *
   * Returns undefined for an Admin, matching `getAccessibleLibraries`' shape:
   * undefined means "no restriction", not "none".
   */
  async getEditableLibraryIds(userId: string, isAdmin: boolean): Promise<string[] | undefined> {
    if (isAdmin) return undefined;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { groups: { where: { canEdit: true }, select: { id: true } } },
    });
    const editableGroupIds = user?.groups.map((group) => group.id) ?? [];

    const libraries = await prisma.library.findMany({
      where: {
        OR: [
          { groups: { none: {} } },
          ...(editableGroupIds.length > 0
            ? [{ groups: { some: { id: { in: editableGroupIds } } } }]
            : []),
        ],
      },
      select: { id: true },
    });
    return libraries.map((library) => library.id);
  }

  /** Whether this user may change what is in one library. */
  async canUserEditLibrary(userId: string, isAdmin: boolean, libraryId: string): Promise<boolean> {
    const editable = await this.getEditableLibraryIds(userId, isAdmin);
    return editable === undefined || editable.includes(libraryId);
  }

  async getLibraryById(id: string) {
    return prisma.library.findUnique({
      where: { id },
      include: {
        groups: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Check if a user can access a specific library.
   * Admins can access all libraries.
   * Other users can access libraries with no groups or where they're a member of an assigned group.
   */
  async canUserAccessLibrary(userId: string, isAdmin: boolean, libraryId: string): Promise<boolean> {
    if (isAdmin) {
      return true;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      include: {
        groups: { select: { id: true } },
      },
    });

    if (!library) {
      return false;
    }

    // Public library (no groups assigned)
    if (library.groups.length === 0) {
      return true;
    }

    // Check if user is in any of the library's groups
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        groups: { select: { id: true } },
      },
    });

    const userGroupIds = new Set(user?.groups.map(g => g.id) ?? []);
    return library.groups.some(g => userGroupIds.has(g.id));
  }

  async createLibrary(input: CreateLibraryInput) {
    const { name, path, libraryType, groupIds, watchForChanges } = input;

    await assertDirectory(path);

    return prisma.library.create({
      data: {
        name,
        path,
        libraryType,
        watchForChanges: watchForChanges ?? false,
        groups: groupIds ? {
          connect: groupIds.map(id => ({ id })),
        } : undefined,
      },
      include: {
        groups: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async updateLibrary(id: string, input: UpdateLibraryInput) {
    const { name, path, libraryType, groupIds, watchForChanges } = input;

    // If path is being updated, validate it exists
    if (path) {
      await assertDirectory(path);
    }

    return prisma.library.update({
      where: { id },
      data: {
        name,
        path,
        libraryType,
        watchForChanges,
        groups: groupIds !== undefined ? {
          set: groupIds.map(id => ({ id })),
        } : undefined,
      },
      include: {
        groups: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /** Delete a library with all of its collections, media and artwork files. */
  async deleteLibrary(id: string) {
    await contentDeletionService.deleteLibraryContents(id);
    return prisma.library.delete({
      where: { id },
    });
  }
}

/**
 * A library path has to be a directory that exists right now.
 *
 * Checked asynchronously: the API process serves streams while this runs, and
 * a path on an unresponsive network mount can take seconds to answer.
 */
async function assertDirectory(target: string): Promise<void> {
  let stats;
  try {
    stats = await fsp.stat(target);
  } catch {
    throw new Error(`Path does not exist: ${target}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${target}`);
  }
}
