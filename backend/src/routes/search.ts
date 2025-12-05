import { Router, type Request } from 'express';
import { prisma } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/search:
 *   get:
 *     tags:
 *       - Search
 *     summary: Search for content
 *     description: Search for collections and media by name across all accessible libraries
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of results per type
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 collections:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Collection'
 *                 media:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Media'
 *       400:
 *         description: Missing search query
 *       500:
 *         description: Server error
 */
router.get('/', async (req: Request, res) => {
  try {
    const { q, limit = '20' } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchQuery = q.trim().toLowerCase();
    const resultLimit = Math.min(parseInt(limit as string, 10) || 20, 100);

    // Get user's accessible library IDs
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        groups: {
          include: {
            libraries: { select: { id: true } },
          },
        },
      },
    });

    // Admin users can access all libraries
    let accessibleLibraryIds: string[] | undefined;
    if (req.user!.role !== 'Admin') {
      accessibleLibraryIds = user?.groups.flatMap((g) => g.libraries.map((l) => l.id)) ?? [];

      // If user has no group memberships, they can't access any libraries
      if (accessibleLibraryIds.length === 0) {
        return res.json({ collections: [], media: [] });
      }
    }

    // Build the where clause for library access
    const libraryFilter = accessibleLibraryIds
      ? { libraryId: { in: accessibleLibraryIds } }
      : {};

    // Search collections (shows, films, albums, etc.)
    // Use raw SQL for case-insensitive search with SQLite
    const collections = await prisma.collection.findMany({
      where: {
        ...libraryFilter,
        name: {
          contains: searchQuery,
        },
        // Only return root-level collections (shows, films) not seasons
        parentId: null,
      },
      include: {
        library: {
          select: {
            id: true,
            name: true,
            libraryType: true,
          },
        },
        images: {
          where: { isPrimary: true, imageType: 'Poster' },
          take: 1,
        },
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
        keywords: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            media: true,
            children: true,
          },
        },
      },
      orderBy: { name: 'asc' },
      take: resultLimit,
    });

    // Search media (episodes, tracks, etc.) - exclude film media since films are shown as collections
    const media = await prisma.media.findMany({
      where: {
        name: {
          contains: searchQuery,
        },
        collection: {
          ...(accessibleLibraryIds ? { libraryId: { in: accessibleLibraryIds } } : {}),
          library: {
            libraryType: { not: 'Film' },
          },
        },
      },
      include: {
        collection: {
          select: {
            id: true,
            name: true,
            collectionType: true,
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
              },
            },
          },
        },
        images: {
          where: { isPrimary: true },
          take: 1,
        },
        videoDetails: {
          select: {
            season: true,
            episode: true,
            description: true,
          },
        },
        audioDetails: {
          select: {
            track: true,
            disc: true,
          },
        },
      },
      orderBy: { name: 'asc' },
      take: resultLimit,
    });

    res.json({ collections, media });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
