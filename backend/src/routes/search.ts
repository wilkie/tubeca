import { Router, type Request } from 'express';
import { prisma } from '../config/database';
import { authenticate, requireRole } from '../middleware/auth';
import { accessibleLibraryIdsFor } from '../middleware/libraryAccess';
import { searchIndexService } from '../services/searchIndexService';

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

    // Scope results to the libraries this user may see. The rule (admins see
    // everything; a library with no groups is public; otherwise the user must
    // share a group with it) lives in LibraryService so it matches /api/libraries.
    const accessibleLibraryIds = await accessibleLibraryIdsFor(req);

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

    // Full-text hits, when there is something to search for and an index to
    // search. An empty index (a server that has not rebuilt yet) falls back to
    // the substring match this endpoint has always done.
    const useIndex = Boolean(searchQuery) && (await searchIndexService.size()) > 0;

    let rankedCollectionIds: string[] | null = null;
    let indexedCollectionTotal = 0;

    if (useIndex && searchQuery) {
      const hits = await searchIndexService.search({
        query: searchQuery,
        entityType: 'collection',
        libraryIds: accessibleLibraryIds,
        excludedRatings: excludedRatingList,
        limit: resultLimit,
        offset: skip,
      });
      rankedCollectionIds = hits.ids;
      indexedCollectionTotal = hits.total;
      collectionWhere.id = { in: hits.ids };
    } else if (searchQuery) {
      collectionWhere.name = { contains: searchQuery };
    }

    // Add keyword filter (must have ALL specified keywords)
    if (keywordIdList.length > 0) {
      collectionWhere.AND = keywordIdList.map((keywordId) => ({
        keywords: { some: { id: keywordId } },
      }));
    }

    // Add content rating exclusion filter (the index applied it already)
    if (excludedRatingList.length > 0 && !rankedCollectionIds) {
      collectionWhere.OR = [
        { filmDetails: null },
        { filmDetails: { contentRating: null } },
        { filmDetails: { contentRating: { notIn: excludedRatingList } } },
      ];
    }

    // Get total count for pagination
    const totalCollections = rankedCollectionIds
      ? indexedCollectionTotal
      : await prisma.collection.count({ where: collectionWhere });

    // Search collections (shows, films, albums, etc.)
    const collectionRows = await prisma.collection.findMany({
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
      ...(rankedCollectionIds ? {} : { orderBy: { name: 'asc' }, skip, take: resultLimit }),
    });

    // The index returned them best-first; Prisma returns them in whatever
    // order it likes, so put them back.
    const collections = rankedCollectionIds
      ? rankedCollectionIds
          .map((id) => collectionRows.find((row) => row.id === id))
          .filter((row): row is (typeof collectionRows)[number] => row !== undefined)
      : collectionRows;

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

      let rankedMediaIds: string[] | null = null;
      if (useIndex && searchQuery) {
        const hits = await searchIndexService.search({
          query: searchQuery,
          entityType: 'media',
          libraryIds: accessibleLibraryIds,
          limit: resultLimit,
          offset: skip,
        });
        rankedMediaIds = hits.ids;
        totalMedia = hits.total;
        mediaWhere.id = { in: hits.ids };
      } else if (searchQuery) {
        mediaWhere.name = { contains: searchQuery };
      }

      // Get total count for media
      if (!rankedMediaIds) totalMedia = await prisma.media.count({ where: mediaWhere });

      // Search media (episodes, tracks, etc.) - exclude film media since films are shown as collections
      const mediaRows = await prisma.media.findMany({
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
      ...(rankedMediaIds ? {} : { orderBy: { name: 'asc' }, skip, take: resultLimit }),
    });

      media = rankedMediaIds
        ? rankedMediaIds
            .map((id) => mediaRows.find((row) => row.id === id))
            .filter((row): row is (typeof mediaRows)[number] => row !== undefined)
        : mediaRows;
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

/**
 * @openapi
 * /api/search/facets:
 *   get:
 *     tags:
 *       - Search
 *     summary: Filter options for the search page
 *     description: >
 *       Every keyword and content rating present in the libraries this user can see,
 *       so the filter panel offers the whole set rather than whatever happened to be
 *       on the first page of results.
 *     responses:
 *       200:
 *         description: Filter options
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 keywords:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Keyword'
 *                 contentRatings:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/facets', async (req: Request, res) => {
  try {
    const accessibleLibraryIds = await accessibleLibraryIdsFor(req);
    const libraryFilter = accessibleLibraryIds ? { libraryId: { in: accessibleLibraryIds } } : {};

    const [keywords, ratingRows] = await Promise.all([
      prisma.keyword.findMany({
        where: { collections: { some: libraryFilter } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.filmDetails.findMany({
        where: { NOT: { contentRating: null }, collection: libraryFilter },
        select: { contentRating: true },
        distinct: ['contentRating'],
      }),
    ]);

    res.json({
      keywords,
      contentRatings: ratingRows
        .map((row) => row.contentRating)
        .filter((rating): rating is string => Boolean(rating))
        .sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    console.error('Search facets error:', error);
    res.status(500).json({ error: 'Failed to load filter options' });
  }
});

/**
 * @openapi
 * /api/search/reindex:
 *   post:
 *     tags:
 *       - Search
 *     summary: Rebuild the search index
 *     description: >
 *       Rebuild the full-text index from the database (Admin only). The index is kept
 *       up to date by the scan and scrape workers; this is for after a restore, or
 *       after the first upgrade to a version that has one.
 *     responses:
 *       200:
 *         description: Index rebuilt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 collections:
 *                   type: integer
 *                 media:
 *                   type: integer
 */
router.post('/reindex', requireRole('Admin'), async (_req, res) => {
  try {
    const result = await searchIndexService.rebuild();
    console.log(`🔎 Search index rebuilt: ${result.collections} collections, ${result.media} media`);
    res.json(result);
  } catch (error) {
    console.error('Search reindex error:', error);
    res.status(500).json({ error: 'Failed to rebuild the search index' });
  }
});

export default router;
