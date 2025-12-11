import { Router, type Request } from 'express';
import { authenticate } from '../middleware/auth';
import { UserCollectionService } from '../services/userCollectionService';

const router = Router();
const userCollectionService = new UserCollectionService();

// All routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/user-collections:
 *   get:
 *     tags:
 *       - User Collections
 *     summary: Get my collections
 *     description: Get all collections owned by the current user
 *     responses:
 *       200:
 *         description: List of user collections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollections:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserCollection'
 */
router.get('/', async (req: Request, res) => {
  try {
    const userCollections = await userCollectionService.getUserCollections(req.user!.userId);
    res.json({ userCollections });
  } catch {
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

/**
 * @openapi
 * /api/user-collections/public:
 *   get:
 *     tags:
 *       - User Collections
 *     summary: Get public collections
 *     description: Get all public collections from other users
 *     responses:
 *       200:
 *         description: List of public collections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollections:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserCollection'
 */
router.get('/public', async (req: Request, res) => {
  try {
    const userCollections = await userCollectionService.getPublicCollections(req.user!.userId);
    res.json({ userCollections });
  } catch {
    res.status(500).json({ error: 'Failed to fetch public collections' });
  }
});

// ============================================
// Favorites Routes
// ============================================

/**
 * @openapi
 * /api/user-collections/favorites:
 *   get:
 *     tags:
 *       - Favorites
 *     summary: Get favorites
 *     description: Get the user's Favorites collection with all items
 *     responses:
 *       200:
 *         description: Favorites collection
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 */
router.get('/favorites', async (req: Request, res) => {
  try {
    const userCollection = await userCollectionService.getFavoritesCollection(req.user!.userId);
    res.json({ userCollection });
  } catch {
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

/**
 * @openapi
 * /api/user-collections/favorites/check:
 *   get:
 *     tags:
 *       - Favorites
 *     summary: Check favorites
 *     description: Check if items are in the user's Favorites
 *     parameters:
 *       - in: query
 *         name: collectionIds
 *         schema:
 *           type: string
 *         description: Comma-separated collection IDs to check
 *       - in: query
 *         name: mediaIds
 *         schema:
 *           type: string
 *         description: Comma-separated media IDs to check
 *       - in: query
 *         name: userCollectionIds
 *         schema:
 *           type: string
 *         description: Comma-separated user collection IDs to check
 *     responses:
 *       200:
 *         description: Favorite status for requested items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 collectionIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                 mediaIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                 userCollectionIds:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/favorites/check', async (req: Request, res) => {
  try {
    const collectionIds = req.query.collectionIds
      ? (req.query.collectionIds as string).split(',').filter(Boolean)
      : undefined;
    const mediaIds = req.query.mediaIds
      ? (req.query.mediaIds as string).split(',').filter(Boolean)
      : undefined;
    const userCollectionIds = req.query.userCollectionIds
      ? (req.query.userCollectionIds as string).split(',').filter(Boolean)
      : undefined;

    const result = await userCollectionService.checkFavorites(
      req.user!.userId,
      collectionIds,
      mediaIds,
      userCollectionIds
    );
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to check favorites' });
  }
});

/**
 * @openapi
 * /api/user-collections/favorites/toggle:
 *   post:
 *     tags:
 *       - Favorites
 *     summary: Toggle favorite
 *     description: Add or remove an item from favorites
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               collectionId:
 *                 type: string
 *                 format: uuid
 *               mediaId:
 *                 type: string
 *                 format: uuid
 *               userCollectionId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Toggle result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 favorited:
 *                   type: boolean
 *       400:
 *         description: Invalid request
 */
router.post('/favorites/toggle', async (req: Request, res) => {
  try {
    const { collectionId, mediaId, userCollectionId } = req.body;
    const result = await userCollectionService.toggleFavorite(
      req.user!.userId,
      { collectionId, mediaId, userCollectionId }
    );
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to toggle favorite';
    if (message.includes('Exactly one')) {
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

// ============================================
// Watch Later Routes
// ============================================

/**
 * @openapi
 * /api/user-collections/watch-later:
 *   get:
 *     tags:
 *       - Watch Later
 *     summary: Get watch later
 *     description: Get the user's Watch Later collection with all items
 *     responses:
 *       200:
 *         description: Watch Later collection
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 */
router.get('/watch-later', async (req: Request, res) => {
  try {
    const userCollection = await userCollectionService.getWatchLaterCollection(req.user!.userId);
    res.json({ userCollection });
  } catch {
    res.status(500).json({ error: 'Failed to fetch watch later' });
  }
});

/**
 * @openapi
 * /api/user-collections/watch-later/check:
 *   get:
 *     tags:
 *       - Watch Later
 *     summary: Check watch later
 *     description: Check if items are in the user's Watch Later
 *     parameters:
 *       - in: query
 *         name: collectionIds
 *         schema:
 *           type: string
 *         description: Comma-separated collection IDs to check
 *       - in: query
 *         name: mediaIds
 *         schema:
 *           type: string
 *         description: Comma-separated media IDs to check
 *     responses:
 *       200:
 *         description: Watch later status for requested items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 collectionIds:
 *                   type: array
 *                   items:
 *                     type: string
 *                 mediaIds:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/watch-later/check', async (req: Request, res) => {
  try {
    const collectionIds = req.query.collectionIds
      ? (req.query.collectionIds as string).split(',').filter(Boolean)
      : undefined;
    const mediaIds = req.query.mediaIds
      ? (req.query.mediaIds as string).split(',').filter(Boolean)
      : undefined;

    const result = await userCollectionService.checkWatchLater(
      req.user!.userId,
      collectionIds,
      mediaIds
    );
    res.json(result);
  } catch {
    res.status(500).json({ error: 'Failed to check watch later' });
  }
});

/**
 * @openapi
 * /api/user-collections/watch-later/toggle:
 *   post:
 *     tags:
 *       - Watch Later
 *     summary: Toggle watch later
 *     description: Add or remove an item from watch later
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               collectionId:
 *                 type: string
 *                 format: uuid
 *               mediaId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Toggle result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inWatchLater:
 *                   type: boolean
 *       400:
 *         description: Invalid request
 */
router.post('/watch-later/toggle', async (req: Request, res) => {
  try {
    const { collectionId, mediaId } = req.body;
    const result = await userCollectionService.toggleWatchLater(
      req.user!.userId,
      { collectionId, mediaId }
    );
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to toggle watch later';
    if (message.includes('Exactly one')) {
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

// ============================================
// Playback Queue Routes
// ============================================

/**
 * @openapi
 * /api/user-collections/queue:
 *   get:
 *     tags:
 *       - Playback Queue
 *     summary: Get playback queue
 *     description: Get the user's Playback Queue collection with all items
 *     responses:
 *       200:
 *         description: Playback Queue collection
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 */
router.get('/queue', async (req: Request, res) => {
  try {
    const userCollection = await userCollectionService.getPlaybackQueue(req.user!.userId);
    res.json({ userCollection });
  } catch {
    res.status(500).json({ error: 'Failed to fetch playback queue' });
  }
});

/**
 * @openapi
 * /api/user-collections/queue:
 *   put:
 *     tags:
 *       - Playback Queue
 *     summary: Set playback queue
 *     description: Replace the playback queue with new items (used when pressing Play)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     collectionId:
 *                       type: string
 *                       format: uuid
 *                     mediaId:
 *                       type: string
 *                       format: uuid
 *     responses:
 *       200:
 *         description: Queue updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 *       400:
 *         description: Invalid request
 */
router.put('/queue', async (req: Request, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }

    const userCollection = await userCollectionService.setPlaybackQueue(
      req.user!.userId,
      items
    );
    res.json({ userCollection });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to set playback queue';
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/user-collections/queue/add:
 *   post:
 *     tags:
 *       - Playback Queue
 *     summary: Add to playback queue
 *     description: Add an item to the end of the playback queue (for "Play after" functionality)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               collectionId:
 *                 type: string
 *                 format: uuid
 *               mediaId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Item added to queue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 *       400:
 *         description: Invalid request
 */
router.post('/queue/add', async (req: Request, res) => {
  try {
    const { collectionId, mediaId } = req.body;
    const userCollection = await userCollectionService.addToPlaybackQueue(
      req.user!.userId,
      { collectionId, mediaId }
    );
    res.json({ userCollection });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add to playback queue';
    if (message.includes('Exactly one')) {
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/user-collections/queue:
 *   delete:
 *     tags:
 *       - Playback Queue
 *     summary: Clear playback queue
 *     description: Remove all items from the playback queue
 *     responses:
 *       200:
 *         description: Queue cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 */
router.delete('/queue', async (req: Request, res) => {
  try {
    const userCollection = await userCollectionService.clearPlaybackQueue(req.user!.userId);
    res.json({ userCollection });
  } catch {
    res.status(500).json({ error: 'Failed to clear playback queue' });
  }
});

/**
 * @openapi
 * /api/user-collections/{id}:
 *   get:
 *     tags:
 *       - User Collections
 *     summary: Get a collection
 *     description: Get a single collection with items (must be owner or public)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Collection found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 *       404:
 *         description: Collection not found or access denied
 */
router.get('/:id', async (req: Request, res) => {
  try {
    const userCollection = await userCollectionService.getCollectionById(
      req.params.id,
      req.user!.userId
    );
    if (!userCollection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json({ userCollection });
  } catch {
    res.status(500).json({ error: 'Failed to fetch collection' });
  }
});

/**
 * @openapi
 * /api/user-collections:
 *   post:
 *     tags:
 *       - User Collections
 *     summary: Create a collection
 *     description: Create a new user collection
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               isPublic:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Collection created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 *       400:
 *         description: Invalid request
 */
router.post('/', async (req: Request, res) => {
  try {
    const { name, description, collectionType, isPublic } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const userCollection = await userCollectionService.createCollection(
      req.user!.userId,
      { name: name.trim(), description, collectionType, isPublic }
    );

    res.status(201).json({ userCollection });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create collection';
    res.status(400).json({ error: message });
  }
});

/**
 * @openapi
 * /api/user-collections/{id}:
 *   patch:
 *     tags:
 *       - User Collections
 *     summary: Update a collection
 *     description: Update a collection (owner only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               isPublic:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Collection updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 *       403:
 *         description: Access denied
 *       404:
 *         description: Collection not found
 */
router.patch('/:id', async (req: Request, res) => {
  try {
    const { name, description, collectionType, isPublic } = req.body;

    const userCollection = await userCollectionService.updateCollection(
      req.params.id,
      req.user!.userId,
      { name, description, collectionType, isPublic }
    );

    res.json({ userCollection });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update collection';
    if (message.includes('not found') || message.includes('access denied')) {
      return res.status(404).json({ error: message });
    }
    res.status(400).json({ error: message });
  }
});

/**
 * @openapi
 * /api/user-collections/{id}:
 *   delete:
 *     tags:
 *       - User Collections
 *     summary: Delete a collection
 *     description: Delete a collection (owner only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Collection deleted
 *       403:
 *         description: Access denied
 *       404:
 *         description: Collection not found
 */
router.delete('/:id', async (req: Request, res) => {
  try {
    await userCollectionService.deleteCollection(req.params.id, req.user!.userId);
    res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete collection';
    if (message.includes('not found') || message.includes('access denied')) {
      return res.status(404).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/user-collections/{id}/items:
 *   post:
 *     tags:
 *       - User Collections
 *     summary: Add item to collection
 *     description: Add a collection, media item, or user collection to a user collection (owner only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               collectionId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of a library collection (show, film, etc.)
 *               mediaId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of a media item (episode, track, etc.)
 *               userCollectionId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of another user collection
 *     responses:
 *       201:
 *         description: Item added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   $ref: '#/components/schemas/UserCollectionItem'
 *       400:
 *         description: Invalid request or item already exists
 *       403:
 *         description: Access denied
 *       404:
 *         description: Collection not found
 */
router.post('/:id/items', async (req: Request, res) => {
  try {
    const { collectionId, mediaId, userCollectionId } = req.body;

    const item = await userCollectionService.addItem(
      req.params.id,
      req.user!.userId,
      { collectionId, mediaId, userCollectionId }
    );

    res.status(201).json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add item';
    if (message.includes('not found') || message.includes('access denied')) {
      return res.status(404).json({ error: message });
    }
    if (message.includes('already exists') || message.includes('Exactly one') || message.includes('Cannot add')) {
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/user-collections/{id}/items/{itemId}:
 *   delete:
 *     tags:
 *       - User Collections
 *     summary: Remove item from collection
 *     description: Remove an item from a user collection (owner only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Item removed
 *       403:
 *         description: Access denied
 *       404:
 *         description: Collection or item not found
 */
router.delete('/:id/items/:itemId', async (req: Request, res) => {
  try {
    await userCollectionService.removeItem(
      req.params.id,
      req.user!.userId,
      req.params.itemId
    );
    res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove item';
    if (message.includes('not found') || message.includes('access denied')) {
      return res.status(404).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

/**
 * @openapi
 * /api/user-collections/{id}/items/reorder:
 *   patch:
 *     tags:
 *       - User Collections
 *     summary: Reorder collection items
 *     description: Reorder items in a user collection (owner only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - itemIds
 *             properties:
 *               itemIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Items reordered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userCollection:
 *                   $ref: '#/components/schemas/UserCollection'
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Access denied
 *       404:
 *         description: Collection not found
 */
router.patch('/:id/items/reorder', async (req: Request, res) => {
  try {
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds)) {
      return res.status(400).json({ error: 'itemIds must be an array' });
    }

    const userCollection = await userCollectionService.reorderItems(
      req.params.id,
      req.user!.userId,
      itemIds
    );

    res.json({ userCollection });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reorder items';
    if (message.includes('not found') || message.includes('access denied')) {
      return res.status(404).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

export default router;
