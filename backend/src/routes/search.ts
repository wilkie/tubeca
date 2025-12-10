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
 *     description: Search for collections and media by name across all accessible libraries. If no query is provided, returns all content paginated.
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query (optional - if empty, returns all content)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of results per page
 *       - in: query
 *         name: keywordIds
 *         schema:
 *           type: string
 *         description: Comma-separated list of keyword IDs to filter by
 *       - in: query
 *         name: excludedRatings
 *         schema:
 *           type: string
 *         description: Comma-separated list of content ratings to exclude
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
 *                 totalCollections:
 *                   type: integer
 *                 totalMedia:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 hasMore:
 *                   type: boolean
 *       500:
 *         description: Server error
 */
router.get('/', async (req: Request, res) => {
  try {
    const { q, page = '1', limit = '50', keywordIds, excludedRatings } = req.query;

    const searchQuery = typeof q === 'string' && q.trim().length > 0 ? q.trim().toLowerCase() : null;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const resultLimit = Math.min(parseInt(limit as string, 10) || 50, 100);
    const skip = (pageNum - 1) * resultLimit;

    // Parse keyword filter
    const keywordIdList = typeof keywordIds === 'string' && keywordIds.trim()
      ? keywordIds.split(',').map(id => id.trim()).filter(Boolean)
      : [];

    // Parse excluded ratings filter
    const excludedRatingList = typeof excludedRatings === 'string' && excludedRatings.trim()
      ? excludedRatings.split(',').map(r => r.trim()).filter(Boolean)
      : [];

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

    // Build collection where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collectionWhere: any = {
      ...libraryFilter,
      // Only return root-level collections (shows, films) not seasons
      parentId: null,
    };

    // Add name search if query provided
    if (searchQuery) {
      collectionWhere.name = { contains: searchQuery };
    }

    // Add keyword filter (must have ALL specified keywords)
    if (keywordIdList.length > 0) {
      collectionWhere.AND = keywordIdList.map((keywordId) => ({
        keywords: { some: { id: keywordId } },
      }));
    }

    // Add content rating exclusion filter
    if (excludedRatingList.length > 0) {
      collectionWhere.OR = [
        { filmDetails: null },
        { filmDetails: { contentRating: null } },
        { filmDetails: { contentRating: { notIn: excludedRatingList } } },
      ];
    }

    // Get total count for pagination
    const totalCollections = await prisma.collection.count({ where: collectionWhere });

    // Search collections (shows, films, albums, etc.)
    const collections = await prisma.collection.findMany({
      where: collectionWhere,
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
      skip,
      take: resultLimit,
    });

    // When filtering by keywords, don't search media (media items don't have keywords)
    let media: Awaited<ReturnType<typeof prisma.media.findMany>> = [];
    let totalMedia = 0;

    if (keywordIdList.length === 0) {
      // Build media where clause
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mediaWhere: any = {
        collection: {
          ...(accessibleLibraryIds ? { libraryId: { in: accessibleLibraryIds } } : {}),
          library: {
            libraryType: { not: 'Film' },
          },
        },
      };

      // Add name search if query provided
      if (searchQuery) {
        mediaWhere.name = { contains: searchQuery };
      }

      // Get total count for media
      totalMedia = await prisma.media.count({ where: mediaWhere });

      // Search media (episodes, tracks, etc.) - exclude film media since films are shown as collections
      media = await prisma.media.findMany({
        where: mediaWhere,
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
      skip,
      take: resultLimit,
    });
    }

    const totalResults = totalCollections + totalMedia;
    const hasMore = skip + collections.length + media.length < totalResults;

    res.json({
      collections,
      media,
      totalCollections,
      totalMedia,
      page: pageNum,
      hasMore,
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
