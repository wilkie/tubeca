import { prisma } from '../config/database'

export interface CreateCollectionInput {
  name: string
  libraryId: string
  parentId?: string
}

export interface UpdateCollectionInput {
  name?: string
  parentId?: string | null
}

export class CollectionService {
  async getCollectionsByLibrary(libraryId: string) {
    return prisma.collection.findMany({
      where: { libraryId },
      include: {
        children: {
          select: {
            id: true,
            name: true,
          },
        },
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
        images: {
          where: { isPrimary: true },
          take: 1,
        },
        _count: {
          select: {
            media: true,
            children: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    })
  }

  async getCollectionById(id: string) {
    return prisma.collection.findUnique({
      where: { id },
      include: {
        library: {
          select: {
            id: true,
            name: true,
          },
        },
        parent: {
          select: {
            id: true,
            name: true,
            collectionType: true,
          },
        },
        children: {
          select: {
            id: true,
            name: true,
            collectionType: true,
            images: {
              where: { isPrimary: true },
              take: 1,
            },
          },
          orderBy: { name: 'asc' },
        },
        media: {
          select: {
            id: true,
            name: true,
            type: true,
            videoDetails: {
              select: {
                season: true,
                episode: true,
              },
            },
            audioDetails: {
              select: {
                track: true,
                disc: true,
              },
            },
            images: {
              where: { isPrimary: true },
              take: 1,
            },
          },
          orderBy: { name: 'asc' },
        },
        // Include collection metadata based on type
        showDetails: {
          include: {
            credits: {
              orderBy: { order: 'asc' },
            },
          },
        },
        seasonDetails: true,
        artistDetails: {
          include: {
            members: true,
          },
        },
        albumDetails: {
          include: {
            credits: true,
          },
        },
        images: true,
      },
    })
  }

  async createCollection(input: CreateCollectionInput) {
    const { name, libraryId, parentId } = input

    // Verify library exists
    const library = await prisma.library.findUnique({
      where: { id: libraryId },
    })
    if (!library) {
      throw new Error('Library not found')
    }

    // If parentId is provided, verify it exists and belongs to the same library
    if (parentId) {
      const parent = await prisma.collection.findUnique({
        where: { id: parentId },
      })
      if (!parent) {
        throw new Error('Parent collection not found')
      }
      if (parent.libraryId !== libraryId) {
        throw new Error('Parent collection must belong to the same library')
      }
    }

    return prisma.collection.create({
      data: {
        name,
        libraryId,
        parentId,
      },
      include: {
        library: {
          select: {
            id: true,
            name: true,
          },
        },
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })
  }

  async updateCollection(id: string, input: UpdateCollectionInput) {
    const { name, parentId } = input

    const collection = await prisma.collection.findUnique({
      where: { id },
    })
    if (!collection) {
      throw new Error('Collection not found')
    }

    // If parentId is being updated, verify it's valid
    if (parentId !== undefined && parentId !== null) {
      // Can't set parent to itself
      if (parentId === id) {
        throw new Error('Collection cannot be its own parent')
      }

      const parent = await prisma.collection.findUnique({
        where: { id: parentId },
      })
      if (!parent) {
        throw new Error('Parent collection not found')
      }
      if (parent.libraryId !== collection.libraryId) {
        throw new Error('Parent collection must belong to the same library')
      }

      // Check for circular reference
      let currentParent = parent
      while (currentParent.parentId) {
        if (currentParent.parentId === id) {
          throw new Error('Circular reference detected')
        }
        const nextParent = await prisma.collection.findUnique({
          where: { id: currentParent.parentId },
        })
        if (!nextParent) break
        currentParent = nextParent
      }
    }

    return prisma.collection.update({
      where: { id },
      data: {
        name,
        parentId,
      },
      include: {
        library: {
          select: {
            id: true,
            name: true,
          },
        },
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })
  }

  async deleteCollection(id: string) {
    return prisma.collection.delete({
      where: { id },
    })
  }
}
