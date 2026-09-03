import { prisma } from '../config/database';
import { contentDeletionService } from './contentDeletionService';

export interface CreateCollectionInput {
  name: string
  libraryId: string
  parentId?: string
}

export interface PaginatedCollectionsInput {
  libraryId: string
  page?: number
  limit?: number
  sortField?: 'name' | 'dateAdded' | 'releaseDate' | 'rating' | 'runtime'
  sortDirection?: 'asc' | 'desc'
  excludedRatings?: string[]
  keywordIds?: string[]
  nameFilter?: string
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
          where: { isPrimary: true, imageType: 'Poster' },
          take: 1,
        },
        _count: {
          select: {
            media: true,
            children: true,
          },
        },
        // Include sortable metadata fields
        showDetails: {
          select: {
            releaseDate: true,
            rating: true,
            description: true,
          },
        },
        filmDetails: {
          select: {
            releaseDate: true,
            rating: true,
            runtime: true,
            contentRating: true,
            description: true,
          },
        },
        albumDetails: {
          select: {
            releaseDate: true,
          },
        },
        keywords: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getKeywordsByLibrary(libraryId: string) {
    // Get all unique keywords used by collections in this library
    const keywords = await prisma.keyword.findMany({
      where: {
        collections: {
          some: {
            libraryId,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return keywords;
  }

  async getPaginatedCollections(input: PaginatedCollectionsInput) {
    const {
      libraryId,
      page = 1,
      limit = 50,
      sortField = 'name',
      sortDirection = 'asc',
      excludedRatings = [],
      keywordIds = [],
      nameFilter,
    } = input;

    const skip = (page - 1) * limit;

    // Build base where clause - only root collections
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseWhere: any = {
      libraryId,
      parentId: null,
    };

    // Add name filter if specified (substring match)
    // Note: SQLite's LIKE is case-insensitive for ASCII by default
    if (nameFilter && nameFilter.trim()) {
      baseWhere.name = {
        contains: nameFilter.trim(),
      };
    }

    // Add content rating filter if specified
    if (excludedRatings.length > 0) {
      baseWhere.OR = [
        // Include items with no filmDetails
        { filmDetails: null },
        // Include items with null contentRating
        { filmDetails: { contentRating: null } },
        // Include items with non-excluded ratings
        { filmDetails: { contentRating: { notIn: excludedRatings } } },
      ];
    }

    // Add keyword filter if specified (must have ALL specified keywords)
    if (keywordIds.length > 0) {
      baseWhere.AND = keywordIds.map((keywordId) => ({
        keywords: {
          some: { id: keywordId },
        },
      }));
    }

    // Build orderBy based on sortField
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let orderBy: any;

    switch (sortField) {
      case 'dateAdded':
        orderBy = { createdAt: sortDirection };
        break;
      case 'releaseDate':
        // Sort by filmDetails.releaseDate, then showDetails.releaseDate, then albumDetails.releaseDate
        // Prisma doesn't support complex ordering across relations, so we'll sort by createdAt as fallback
        // and handle proper sorting in the query with raw SQL or post-processing
        orderBy = { createdAt: sortDirection };
        break;
      case 'rating':
        // Similar limitation - fall back to createdAt
        orderBy = { createdAt: sortDirection };
        break;
      case 'runtime':
        orderBy = { createdAt: sortDirection };
        break;
      case 'name':
      default:
        orderBy = { name: sortDirection };
        break;
    }

    // Get total count for pagination
    const total = await prisma.collection.count({ where: baseWhere });

    // Get paginated collections
    let collections = await prisma.collection.findMany({
      where: baseWhere,
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
          where: { isPrimary: true, imageType: 'Poster' },
          take: 1,
        },
        _count: {
          select: {
            media: true,
            children: true,
          },
        },
        showDetails: {
          select: {
            releaseDate: true,
            rating: true,
            description: true,
          },
        },
        filmDetails: {
          select: {
            releaseDate: true,
            rating: true,
            runtime: true,
            contentRating: true,
            description: true,
          },
        },
        albumDetails: {
          select: {
            releaseDate: true,
          },
        },
        keywords: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    });

    // For complex sorting (releaseDate, rating, runtime), sort in memory
    if (sortField === 'releaseDate' || sortField === 'rating' || sortField === 'runtime') {
      collections = collections.sort((a, b) => {
        let aValue: Date | number | null = null;
        let bValue: Date | number | null = null;

        switch (sortField) {
          case 'releaseDate':
            aValue = a.filmDetails?.releaseDate ?? a.showDetails?.releaseDate ?? a.albumDetails?.releaseDate ?? null;
            bValue = b.filmDetails?.releaseDate ?? b.showDetails?.releaseDate ?? b.albumDetails?.releaseDate ?? null;
            break;
          case 'rating':
            aValue = a.filmDetails?.rating ?? a.showDetails?.rating ?? null;
            bValue = b.filmDetails?.rating ?? b.showDetails?.rating ?? null;
            break;
          case 'runtime':
            aValue = a.filmDetails?.runtime ?? null;
            bValue = b.filmDetails?.runtime ?? null;
            break;
        }

        // Handle nulls - push to end
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1;
        if (bValue === null) return -1;

        let comparison = 0;
        if (aValue instanceof Date && bValue instanceof Date) {
          comparison = aValue.getTime() - bValue.getTime();
        } else {
          comparison = (aValue as number) - (bValue as number);
        }

        return sortDirection === 'desc' ? -comparison : comparison;
      });
    }

    return {
      collections,
      total,
      page,
      limit,
      hasMore: skip + collections.length < total,
    };
  }

  async getCollectionById(id: string) {
    return prisma.collection.findUnique({
      where: { id },
      include: {
        library: {
          select: {
            id: true,
            name: true,
            libraryType: true,
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
              where: { isPrimary: true, imageType: 'Poster' },
              take: 1,
            },
            // Include media for finding first episode in Shows
            media: {
              select: {
                id: true,
                videoDetails: {
                  select: {
                    episode: true,
                  },
                },
              },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
        media: {
          select: {
            id: true,
            name: true,
            type: true,
            duration: true,
            videoDetails: {
              select: {
                season: true,
                episode: true,
                description: true,
                releaseDate: true,
                rating: true,
                credits: {
                  orderBy: { order: 'asc' },
                  include: {
                    person: {
                      include: {
                        images: {
                          where: { isPrimary: true, imageType: 'Photo' },
                          take: 1,
                        },
                      },
                    },
                  },
                },
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
              include: {
                person: {
                  include: {
                    images: {
                      where: { isPrimary: true, imageType: 'Photo' },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
        seasonDetails: true,
        filmDetails: {
          include: {
            credits: {
              orderBy: { order: 'asc' },
              include: {
                person: {
                  include: {
                    images: {
                      where: { isPrimary: true, imageType: 'Photo' },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
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
        keywords: true,
        images: true,
      },
    });
  }

  async createCollection(input: CreateCollectionInput) {
    const { name, libraryId, parentId } = input;

    // Verify library exists
    const library = await prisma.library.findUnique({
      where: { id: libraryId },
    });
    if (!library) {
      throw new Error('Library not found');
    }

    // If parentId is provided, verify it exists and belongs to the same library
    if (parentId) {
      const parent = await prisma.collection.findUnique({
        where: { id: parentId },
      });
      if (!parent) {
        throw new Error('Parent collection not found');
      }
      if (parent.libraryId !== libraryId) {
        throw new Error('Parent collection must belong to the same library');
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
    });
  }

  async updateCollection(id: string, input: UpdateCollectionInput) {
    const { name, parentId } = input;

    const collection = await prisma.collection.findUnique({
      where: { id },
    });
    if (!collection) {
      throw new Error('Collection not found');
    }

    // If parentId is being updated, verify it's valid
    if (parentId !== undefined && parentId !== null) {
      // Can't set parent to itself
      if (parentId === id) {
        throw new Error('Collection cannot be its own parent');
      }

      const parent = await prisma.collection.findUnique({
        where: { id: parentId },
      });
      if (!parent) {
        throw new Error('Parent collection not found');
      }
      if (parent.libraryId !== collection.libraryId) {
        throw new Error('Parent collection must belong to the same library');
      }

      // Check for circular reference
      let currentParent = parent;
      while (currentParent.parentId) {
        if (currentParent.parentId === id) {
          throw new Error('Circular reference detected');
        }
        const nextParent = await prisma.collection.findUnique({
          where: { id: currentParent.parentId },
        });
        if (!nextParent) break;
        currentParent = nextParent;
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
    });
  }

  /**
   * Delete a collection, every descendant collection, all media inside the
   * tree, and their artwork files.
   */
  async deleteCollection(id: string) {
    const removed = await contentDeletionService.deleteCollectionTree(id);
    if (!removed) {
      throw new Error('Collection not found');
    }
    return removed;
  }
}
