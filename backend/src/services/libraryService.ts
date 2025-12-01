import { prisma } from '../config/database';
import type { LibraryType } from '@prisma/client';
import * as fs from 'fs';

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

  async createLibrary(input: CreateLibraryInput) {
    const { name, path, libraryType, groupIds, watchForChanges } = input;

    // Validate that the path exists
    if (!fs.existsSync(path)) {
      throw new Error(`Path does not exist: ${path}`);
    }

    // Validate that the path is a directory
    const stats = fs.statSync(path);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${path}`);
    }

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
      if (!fs.existsSync(path)) {
        throw new Error(`Path does not exist: ${path}`);
      }

      const stats = fs.statSync(path);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${path}`);
      }
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

  async deleteLibrary(id: string) {
    return prisma.library.delete({
      where: { id },
    });
  }
}
