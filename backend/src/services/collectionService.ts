import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../config/database';
import { getImageStoragePath } from '../config/appConfig';

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
          },
        },
        filmDetails: {
          select: {
            releaseDate: true,
            rating: true,
            runtime: true,
            contentRating: true,
          },
        },
        albumDetails: {
          select: {
            releaseDate: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
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

  async deleteCollection(id: string) {
    const imageStoragePath = getImageStoragePath();

    // Get all media in this collection
    const mediaItems = await prisma.media.findMany({
      where: { collectionId: id },
      include: {
        images: true,
        videoDetails: {
          include: {
            credits: {
              include: {
                images: true,
              },
            },
          },
        },
      },
    });

    // Get all images for the collection itself (and related show/season/film details)
    const collection = await prisma.collection.findUnique({
      where: { id },
      include: {
        images: true,
        showDetails: {
          include: {
            credits: {
              include: {
                images: true,
              },
            },
          },
        },
        seasonDetails: true,
        filmDetails: {
          include: {
            credits: {
              include: {
                images: true,
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
      },
    });

    if (!collection) {
      throw new Error('Collection not found');
    }

    // Helper to delete image file from disk
    const deleteImageFile = (imagePath: string) => {
      try {
        const fullPath = path.join(imageStoragePath, imagePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          // Try to remove parent directory if empty
          const parentDir = path.dirname(fullPath);
          if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
            fs.rmdirSync(parentDir);
          }
        }
      } catch (error) {
        console.warn(`Failed to delete image file: ${imagePath}`, error);
      }
    };

    // Delete media images from disk
    for (const media of mediaItems) {
      for (const image of media.images) {
        deleteImageFile(image.path);
      }
      // Delete credit images from disk
      if (media.videoDetails?.credits) {
        for (const credit of media.videoDetails.credits) {
          for (const image of credit.images) {
            deleteImageFile(image.path);
          }
        }
      }
    }

    // Delete collection images from disk
    for (const image of collection.images) {
      deleteImageFile(image.path);
    }

    // Delete show credit images from disk
    if (collection.showDetails?.credits) {
      for (const credit of collection.showDetails.credits) {
        for (const image of credit.images) {
          deleteImageFile(image.path);
        }
      }
    }

    // Delete film credit images from disk
    if (collection.filmDetails?.credits) {
      for (const credit of collection.filmDetails.credits) {
        for (const image of credit.images) {
          deleteImageFile(image.path);
        }
      }
    }

    // Delete media items (this will cascade delete their images, videoDetails, audioDetails, and credits from DB)
    await prisma.media.deleteMany({
      where: { collectionId: id },
    });

    // Delete the collection (this will cascade delete images, showDetails, seasonDetails, etc. from DB)
    return prisma.collection.delete({
      where: { id },
    });
  }
}
