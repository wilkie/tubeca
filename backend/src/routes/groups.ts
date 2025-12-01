import { Router } from 'express';
import { prisma } from '../config/database';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// All group routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/groups:
 *   get:
 *     tags:
 *       - Groups
 *     summary: Get all groups
 *     description: Get all user groups (Admin only)
 *     responses:
 *       200:
 *         description: List of groups
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groups:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Group'
 *       403:
 *         description: Forbidden - Admin role required
 */
router.get('/', requireRole('Admin'), async (_req, res) => {
  try {
    const groups = await prisma.group.findMany({
      include: {
        _count: {
          select: {
            users: true,
            libraries: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ groups });
  } catch {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

/**
 * @openapi
 * /api/groups:
 *   post:
 *     tags:
 *       - Groups
 *     summary: Create a new group
 *     description: Create a new user group (Admin only)
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
 *     responses:
 *       201:
 *         description: Group created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group:
 *                   $ref: '#/components/schemas/Group'
 *       400:
 *         description: Invalid request or group name already exists
 *       403:
 *         description: Forbidden - Admin role required
 */
router.post('/', requireRole('Admin'), async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check if group name already exists
    const existingGroup = await prisma.group.findUnique({ where: { name } });
    if (existingGroup) {
      return res.status(400).json({ error: 'Group name already exists' });
    }

    const group = await prisma.group.create({
      data: { name },
      include: {
        _count: {
          select: {
            users: true,
            libraries: true,
          },
        },
      },
    });

    res.status(201).json({ group });
  } catch {
    res.status(500).json({ error: 'Failed to create group' });
  }
});

/**
 * @openapi
 * /api/groups/{id}:
 *   patch:
 *     tags:
 *       - Groups
 *     summary: Update a group
 *     description: Update a group's name (Admin only)
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
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Group updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group:
 *                   $ref: '#/components/schemas/Group'
 *       400:
 *         description: Invalid request or group name already exists
 *       403:
 *         description: Forbidden - Admin role required
 *       404:
 *         description: Group not found
 */
router.patch('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check group exists
    const existingGroup = await prisma.group.findUnique({ where: { id } });
    if (!existingGroup) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check if new name already exists (for a different group)
    const duplicateName = await prisma.group.findFirst({
      where: { name, id: { not: id } },
    });
    if (duplicateName) {
      return res.status(400).json({ error: 'Group name already exists' });
    }

    const group = await prisma.group.update({
      where: { id },
      data: { name },
      include: {
        _count: {
          select: {
            users: true,
            libraries: true,
          },
        },
      },
    });

    res.json({ group });
  } catch {
    res.status(500).json({ error: 'Failed to update group' });
  }
});

/**
 * @openapi
 * /api/groups/{id}:
 *   delete:
 *     tags:
 *       - Groups
 *     summary: Delete a group
 *     description: Delete a user group (Admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Group deleted
 *       403:
 *         description: Forbidden - Admin role required
 *       404:
 *         description: Group not found
 */
router.delete('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check group exists
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    await prisma.group.delete({ where: { id } });
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

export default router;
