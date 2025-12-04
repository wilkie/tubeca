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
   * Get all collections owned by a user (excluding system collections)
   */
  async getUserCollections(userId: string) {
    return prisma.userCollection.findMany({
      where: { userId, isSystem: false },
      include: {
        _count: {
          select: { items: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Get all public collections (for discovery, excluding system collections)
   */
  async getPublicCollections(excludeUserId?: string) {
    return prisma.userCollection.findMany({
      where: {
        isPublic: true,
        isSystem: false,
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

  // ============================================
  // Favorites Methods
  // ============================================

  /**
   * Get or create a system collection by type
   */
  async getSystemCollection(userId: string, systemType: string) {
    // Try to find existing system collection
    let collection = await prisma.userCollection.findFirst({
      where: { userId, isSystem: true, systemType },
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

    // Create if it doesn't exist
    if (!collection) {
      collection = await prisma.userCollection.create({
        data: {
          name: systemType,
          userId,
          isSystem: true,
          systemType,
          isPublic: false,
        },
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

    return collection;
  }

  /**
   * Get or create the user's Favorites collection
   */
  async getFavoritesCollection(userId: string) {
    return this.getSystemCollection(userId, 'Favorites');
  }

  /**
   * Check if items are in the user's Favorites collection
   * Returns an object with collectionIds and mediaIds that are favorited
   */
  async checkFavorites(userId: string, collectionIds?: string[], mediaIds?: string[]) {
    return this.checkSystemCollectionItems(userId, 'Favorites', collectionIds, mediaIds);
  }

  /**
   * Toggle favorite status for an item
   * Returns { favorited: boolean } indicating the new state
   */
  async toggleFavorite(userId: string, input: AddUserCollectionItemInput) {
    const result = await this.toggleSystemCollectionItem(userId, 'Favorites', input);
    return { favorited: result.added };
  }

  // ============================================
  // Watch Later Methods
  // ============================================

  /**
   * Get or create the user's Watch Later collection
   */
  async getWatchLaterCollection(userId: string) {
    return this.getSystemCollection(userId, 'WatchLater');
  }

  /**
   * Check if items are in the user's Watch Later collection
   * Returns an object with collectionIds and mediaIds that are in watch later
   */
  async checkWatchLater(userId: string, collectionIds?: string[], mediaIds?: string[]) {
    return this.checkSystemCollectionItems(userId, 'WatchLater', collectionIds, mediaIds);
  }

  /**
   * Toggle watch later status for an item
   * Returns { inWatchLater: boolean } indicating the new state
   */
  async toggleWatchLater(userId: string, input: AddUserCollectionItemInput) {
    const result = await this.toggleSystemCollectionItem(userId, 'WatchLater', input);
    return { inWatchLater: result.added };
  }

  // ============================================
  // Generic System Collection Helpers
  // ============================================

  /**
   * Check if items are in a system collection
   */
  private async checkSystemCollectionItems(
    userId: string,
    systemType: string,
    collectionIds?: string[],
    mediaIds?: string[]
  ) {
    const systemCollection = await prisma.userCollection.findFirst({
      where: { userId, isSystem: true, systemType },
      select: { id: true },
    });

    if (!systemCollection) {
      return { collectionIds: [], mediaIds: [] };
    }

    const result: { collectionIds: string[]; mediaIds: string[] } = {
      collectionIds: [],
      mediaIds: [],
    };

    if (collectionIds && collectionIds.length > 0) {
      const matchedCollections = await prisma.userCollectionItem.findMany({
        where: {
          userCollectionId: systemCollection.id,
          collectionId: { in: collectionIds },
        },
        select: { collectionId: true },
      });
      result.collectionIds = matchedCollections
        .map((item) => item.collectionId)
        .filter((id): id is string => id !== null);
    }

    if (mediaIds && mediaIds.length > 0) {
      const matchedMedia = await prisma.userCollectionItem.findMany({
        where: {
          userCollectionId: systemCollection.id,
          mediaId: { in: mediaIds },
        },
        select: { mediaId: true },
      });
      result.mediaIds = matchedMedia
        .map((item) => item.mediaId)
        .filter((id): id is string => id !== null);
    }

    return result;
  }

  /**
   * Toggle an item in a system collection
   * Returns { added: boolean } indicating if the item was added or removed
   */
  private async toggleSystemCollectionItem(
    userId: string,
    systemType: string,
    input: AddUserCollectionItemInput
  ) {
    const { collectionId: contentCollectionId, mediaId } = input;

    // Validate that exactly one reference is provided
    if ((!contentCollectionId && !mediaId) || (contentCollectionId && mediaId)) {
      throw new Error('Exactly one of collectionId or mediaId must be provided');
    }

    // Get or create the system collection
    const systemCollection = await this.getSystemCollection(userId, systemType);

    // Check if item already exists
    const existingItem = await prisma.userCollectionItem.findFirst({
      where: {
        userCollectionId: systemCollection.id,
        ...(contentCollectionId ? { collectionId: contentCollectionId } : {}),
        ...(mediaId ? { mediaId } : {}),
      },
    });

    if (existingItem) {
      // Remove from collection
      await prisma.$transaction([
        prisma.userCollectionItem.delete({
          where: { id: existingItem.id },
        }),
        prisma.userCollection.update({
          where: { id: systemCollection.id },
          data: { updatedAt: new Date() },
        }),
      ]);
      return { added: false };
    } else {
      // Add to collection
      const maxPosition = await prisma.userCollectionItem.aggregate({
        where: { userCollectionId: systemCollection.id },
        _max: { position: true },
      });

      const nextPosition = (maxPosition._max.position ?? -1) + 1;

      await prisma.$transaction([
        prisma.userCollectionItem.create({
          data: {
            userCollectionId: systemCollection.id,
            collectionId: contentCollectionId,
            mediaId,
            position: nextPosition,
          },
        }),
        prisma.userCollection.update({
          where: { id: systemCollection.id },
          data: { updatedAt: new Date() },
        }),
      ]);
      return { added: true };
    }
  }
}
