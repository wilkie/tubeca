import { prisma } from '../config/database';
import { ImageType } from '@prisma/client';

export interface CreateUserCollectionInput {
  name: string
  description?: string
  isPublic?: boolean
}

export interface UpdateUserCollectionInput {
  name?: string
  description?: string
  isPublic?: boolean
}

export interface AddUserCollectionItemInput {
  collectionId?: string
  mediaId?: string
}

// Include specification for items with their referenced content
const itemInclude = {
  collection: {
    select: {
      id: true,
      name: true,
      collectionType: true,
      images: {
        where: { isPrimary: true, imageType: ImageType.Poster },
        take: 1,
      },
      library: {
        select: {
          id: true,
          name: true,
          libraryType: true,
        },
      },
    },
  },
  media: {
    select: {
      id: true,
      name: true,
      type: true,
      duration: true,
      images: {
        where: { isPrimary: true },
        take: 1,
      },
      collection: {
        select: {
          id: true,
          name: true,
          library: {
            select: {
              id: true,
              name: true,
              libraryType: true,
            },
          },
        },
      },
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
    },
  },
} as const;

export class UserCollectionService {
  /**
   * Get all collections owned by a user
   */
  async getUserCollections(userId: string) {
    return prisma.userCollection.findMany({
      where: { userId },
      include: {
        _count: {
          select: { items: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Get all public collections (for discovery)
   */
  async getPublicCollections(excludeUserId?: string) {
    return prisma.userCollection.findMany({
      where: {
        isPublic: true,
        ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: { items: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Get a single collection by ID (if owner or public)
   */
  async getCollectionById(id: string, requestingUserId: string) {
    const collection = await prisma.userCollection.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          include: itemInclude,
          orderBy: { position: 'asc' },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    if (!collection) {
      return null;
    }

    // Check access: must be owner or collection must be public
    if (collection.userId !== requestingUserId && !collection.isPublic) {
      return null;
    }

    return collection;
  }

  /**
   * Create a new user collection
   */
  async createCollection(userId: string, input: CreateUserCollectionInput) {
    const { name, description, isPublic } = input;

    return prisma.userCollection.create({
      data: {
        name,
        description,
        isPublic: isPublic ?? false,
        userId,
      },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });
  }

  /**
   * Update a collection (only owner can update)
   */
  async updateCollection(id: string, userId: string, input: UpdateUserCollectionInput) {
    // Verify ownership
    const existing = await prisma.userCollection.findUnique({
      where: { id },
    });

    if (!existing || existing.userId !== userId) {
      throw new Error('Collection not found or access denied');
    }

    return prisma.userCollection.update({
      where: { id },
      data: input,
      include: {
        _count: {
          select: { items: true },
        },
      },
    });
  }

  /**
   * Delete a collection (only owner can delete)
   */
  async deleteCollection(id: string, userId: string) {
    // Verify ownership
    const existing = await prisma.userCollection.findUnique({
      where: { id },
    });

    if (!existing || existing.userId !== userId) {
      throw new Error('Collection not found or access denied');
    }

    return prisma.userCollection.delete({
      where: { id },
    });
  }

  /**
   * Add an item to a collection (only owner can add)
   */
  async addItem(collectionId: string, userId: string, input: AddUserCollectionItemInput) {
    const { collectionId: contentCollectionId, mediaId } = input;

    // Validate that exactly one reference is provided
    if ((!contentCollectionId && !mediaId) || (contentCollectionId && mediaId)) {
      throw new Error('Exactly one of collectionId or mediaId must be provided');
    }

    // Verify ownership of the user collection
    const userCollection = await prisma.userCollection.findUnique({
      where: { id: collectionId },
    });

    if (!userCollection || userCollection.userId !== userId) {
      throw new Error('Collection not found or access denied');
    }

    // Check if item already exists in collection
    const existingItem = await prisma.userCollectionItem.findFirst({
      where: {
        userCollectionId: collectionId,
        ...(contentCollectionId ? { collectionId: contentCollectionId } : {}),
        ...(mediaId ? { mediaId } : {}),
      },
    });

    if (existingItem) {
      throw new Error('Item already exists in collection');
    }

    // Get the next position
    const maxPosition = await prisma.userCollectionItem.aggregate({
      where: { userCollectionId: collectionId },
      _max: { position: true },
    });

    const nextPosition = (maxPosition._max.position ?? -1) + 1;

    // Create item and update collection's updatedAt in a transaction
    const [item] = await prisma.$transaction([
      prisma.userCollectionItem.create({
        data: {
          userCollectionId: collectionId,
          collectionId: contentCollectionId,
          mediaId,
          position: nextPosition,
        },
        include: itemInclude,
      }),
      prisma.userCollection.update({
        where: { id: collectionId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return item;
  }

  /**
   * Remove an item from a collection (only owner can remove)
   */
  async removeItem(collectionId: string, userId: string, itemId: string) {
    // Verify ownership of the user collection
    const userCollection = await prisma.userCollection.findUnique({
      where: { id: collectionId },
    });

    if (!userCollection || userCollection.userId !== userId) {
      throw new Error('Collection not found or access denied');
    }

    // Verify the item belongs to this collection
    const item = await prisma.userCollectionItem.findUnique({
      where: { id: itemId },
    });

    if (!item || item.userCollectionId !== collectionId) {
      throw new Error('Item not found in collection');
    }

    // Delete item and update collection's updatedAt in a transaction
    const [deletedItem] = await prisma.$transaction([
      prisma.userCollectionItem.delete({
        where: { id: itemId },
      }),
      prisma.userCollection.update({
        where: { id: collectionId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return deletedItem;
  }

  /**
   * Reorder items in a collection (only owner can reorder)
   */
  async reorderItems(collectionId: string, userId: string, itemIds: string[]) {
    // Verify ownership of the user collection
    const userCollection = await prisma.userCollection.findUnique({
      where: { id: collectionId },
    });

    if (!userCollection || userCollection.userId !== userId) {
      throw new Error('Collection not found or access denied');
    }

    // Update positions and collection's updatedAt in a transaction
    await prisma.$transaction([
      ...itemIds.map((itemId, index) =>
        prisma.userCollectionItem.update({
          where: { id: itemId },
          data: { position: index },
        })
      ),
      prisma.userCollection.update({
        where: { id: collectionId },
        data: { updatedAt: new Date() },
      }),
    ]);

    // Return updated collection with items
    return prisma.userCollection.findUnique({
      where: { id: collectionId },
      include: {
        items: {
          include: itemInclude,
          orderBy: { position: 'asc' },
        },
        _count: {
          select: { items: true },
        },
      },
    });
  }
}
