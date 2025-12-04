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
    // Get the favorites collection ID
    const favorites = await prisma.userCollection.findFirst({
      where: { userId, isSystem: true, systemType: 'Favorites' },
      select: { id: true },
    });

    if (!favorites) {
      return { collectionIds: [], mediaIds: [] };
    }

    const result: { collectionIds: string[]; mediaIds: string[] } = {
      collectionIds: [],
      mediaIds: [],
    };

    // Check collections
    if (collectionIds && collectionIds.length > 0) {
      const favoritedCollections = await prisma.userCollectionItem.findMany({
        where: {
          userCollectionId: favorites.id,
          collectionId: { in: collectionIds },
        },
        select: { collectionId: true },
      });
      result.collectionIds = favoritedCollections
        .map((item) => item.collectionId)
        .filter((id): id is string => id !== null);
    }

    // Check media
    if (mediaIds && mediaIds.length > 0) {
      const favoritedMedia = await prisma.userCollectionItem.findMany({
        where: {
          userCollectionId: favorites.id,
          mediaId: { in: mediaIds },
        },
        select: { mediaId: true },
      });
      result.mediaIds = favoritedMedia
        .map((item) => item.mediaId)
        .filter((id): id is string => id !== null);
    }

    return result;
  }

  /**
   * Toggle favorite status for an item
   * Returns { favorited: boolean } indicating the new state
   */
  async toggleFavorite(userId: string, input: AddUserCollectionItemInput) {
    const { collectionId: contentCollectionId, mediaId } = input;

    // Validate that exactly one reference is provided
    if ((!contentCollectionId && !mediaId) || (contentCollectionId && mediaId)) {
      throw new Error('Exactly one of collectionId or mediaId must be provided');
    }

    // Get or create favorites collection
    const favorites = await this.getFavoritesCollection(userId);

    // Check if item already exists in favorites
    const existingItem = await prisma.userCollectionItem.findFirst({
      where: {
        userCollectionId: favorites.id,
        ...(contentCollectionId ? { collectionId: contentCollectionId } : {}),
        ...(mediaId ? { mediaId } : {}),
      },
    });

    if (existingItem) {
      // Remove from favorites
      await prisma.$transaction([
        prisma.userCollectionItem.delete({
          where: { id: existingItem.id },
        }),
        prisma.userCollection.update({
          where: { id: favorites.id },
          data: { updatedAt: new Date() },
        }),
      ]);
      return { favorited: false };
    } else {
      // Add to favorites
      const maxPosition = await prisma.userCollectionItem.aggregate({
        where: { userCollectionId: favorites.id },
        _max: { position: true },
      });

      const nextPosition = (maxPosition._max.position ?? -1) + 1;

      await prisma.$transaction([
        prisma.userCollectionItem.create({
          data: {
            userCollectionId: favorites.id,
            collectionId: contentCollectionId,
            mediaId,
            position: nextPosition,
          },
        }),
        prisma.userCollection.update({
          where: { id: favorites.id },
          data: { updatedAt: new Date() },
        }),
      ]);
      return { favorited: true };
    }
  }
}
