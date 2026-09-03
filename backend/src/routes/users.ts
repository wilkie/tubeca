import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database';
import { authenticate, requireRole } from '../middleware/auth';
import { AuthService, bumpTokenVersion, forgetTokenVersion } from '../services/authService';

const router = Router();
const authService = new AuthService();

/** How many Admins the instance has; used to refuse removing the last one. */
function countAdmins(): Promise<number> {
  return prisma.user.count({ where: { role: 'Admin' } });
}
const SALT_ROUNDS = 10;

// All user routes require authentication
router.use(authenticate);

/**
 * @openapi
 * /api/users/me:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get current user
 *     description: Get the currently authenticated user's information
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        name: true,
        role: true,
        groups: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * @openapi
 * /api/users/me:
 *   patch:
 *     tags:
 *       - Users
 *     summary: Change your own password
 *     description: Any signed-in user may change their own password by supplying the current one. All other sessions are signed out.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed; a replacement token is returned
 *       400:
 *         description: Missing or too-short password
 *       401:
 *         description: Current password is wrong
 */
router.patch('/me', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user || !(await authService.verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Ends every other session, including any leaked media URLs.
    await bumpTokenVersion(user.id);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await authService.hashPassword(newPassword) },
      select: { id: true, name: true, role: true, tokenVersion: true, createdAt: true },
    });

    // Re-issue a token so the caller stays signed in on this device.
    const token = authService.generateToken({
      userId: updated.id,
      name: updated.name,
      role: updated.role,
      tokenVersion: updated.tokenVersion,
    });
    res.json({ user: { id: updated.id, name: updated.name, role: updated.role, createdAt: updated.createdAt }, token });
  } catch {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get all users
 *     description: Get all users (Admin only)
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       403:
 *         description: Forbidden - Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', requireRole('Admin'), async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        role: true,
        groups: true,
        createdAt: true,
      },
    });
    res.json({ users });
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * @openapi
 * /api/users:
 *   post:
 *     tags:
 *       - Users
 *     summary: Create a new user
 *     description: Create a new user account (Admin only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [Admin, Editor, Viewer]
 *                 default: Viewer
 *               groupIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       201:
 *         description: User created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid request or username already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - Admin role required
 */
router.post('/', requireRole('Admin'), async (req, res) => {
  try {
    const { name, password, role = 'Viewer', groupIds = [] } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: 'Name and password are required' });
    }

    if (role && !['Admin', 'Editor', 'Viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({ where: { name } });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await prisma.user.create({
      data: {
        name,
        passwordHash,
        role,
        groups: {
          connect: groupIds.map((id: string) => ({ id })),
        },
      },
      select: {
        id: true,
        name: true,
        role: true,
        groups: true,
        createdAt: true,
      },
    });

    res.status(201).json({ user });
  } catch {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * @openapi
 * /api/users/{id}:
 *   delete:
 *     tags:
 *       - Users
 *     summary: Delete a user
 *     description: Delete a user account (Admin only). Cannot delete yourself.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: User deleted
 *       400:
 *         description: Cannot delete yourself
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - Admin role required
 *       404:
 *         description: User not found
 */
router.delete('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (id === req.user!.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check user exists
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // An instance with no Admin cannot be administered again.
    if (user.role === 'Admin' && (await countAdmins()) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last remaining Admin' });
    }

    await prisma.user.delete({ where: { id } });
    forgetTokenVersion(id);
    res.status(204).send();
  } catch {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * @openapi
 * /api/users/{id}:
 *   patch:
 *     tags:
 *       - Users
 *     summary: Update user
 *     description: Update a user's name and/or password (Admin only)
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
 *               name:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid request or username already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - Admin role required
 *       404:
 *         description: User not found
 */
router.patch('/:id', requireRole('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, password } = req.body;

    // Check user exists
    const existingUser = await prisma.user.findUnique({ where: { id } });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If changing name, check it's not taken
    if (name && name !== existingUser.name) {
      const duplicateName = await prisma.user.findUnique({ where: { name } });
      if (duplicateName) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    // Build update data
    const updateData: { name?: string; passwordHash?: string } = {};
    if (name) {
      updateData.name = name;
    }
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Changing a password should end sessions opened with the old one.
    if (updateData.passwordHash) {
      await bumpTokenVersion(id);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        role: true,
        groups: true,
        createdAt: true,
      },
    });

    res.json({ user });
  } catch {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * @openapi
 * /api/users/{id}/groups:
 *   patch:
 *     tags:
 *       - Users
 *     summary: Update user groups
 *     description: Update a user's group memberships (Admin only)
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
 *               - groupIds
 *             properties:
 *               groupIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.patch('/:id/groups', requireRole('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { groupIds } = req.body;

    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: 'groupIds must be an array' });
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        groups: {
          set: groupIds.map((groupId: string) => ({ id: groupId })),
        },
      },
      select: {
        id: true,
        name: true,
        role: true,
        groups: true,
        createdAt: true,
      },
    });

    res.json({ user });
  } catch {
    res.status(500).json({ error: 'Failed to update user groups' });
  }
});

/**
 * @openapi
 * /api/users/{id}/role:
 *   patch:
 *     tags:
 *       - Users
 *     summary: Update user role
 *     description: Update a user's role (Admin only)
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
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [Admin, Editor, Viewer]
 *     responses:
 *       200:
 *         description: User updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - Admin role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.patch('/:id/role', requireRole('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['Admin', 'Editor', 'Viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (existing.role === 'Admin' && role !== 'Admin' && (await countAdmins()) <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last remaining Admin' });
    }

    // The role travels in the token, so existing sessions must be re-issued.
    await bumpTokenVersion(id);

    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        name: true,
        role: true,
        groups: true,
        createdAt: true,
      },
    });

    res.json({ user });
  } catch {
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

export default router;
