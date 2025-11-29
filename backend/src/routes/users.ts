import { Router } from 'express'
import { prisma } from '../config/database'
import { authenticate, requireRole } from '../middleware/auth'

const router = Router()

// All user routes require authentication
router.use(authenticate)

// Get current user
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
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({ user })
  } catch {
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

// Get all users (Admin only)
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
    })
    res.json({ users })
  } catch {
    res.status(500).json({ error: 'Failed to fetch users' })
  }
})

// Update a user's groups (Admin only)
router.patch('/:id/groups', requireRole('Admin'), async (req, res) => {
  try {
    const { id } = req.params
    const { groupIds } = req.body

    if (!Array.isArray(groupIds)) {
      return res.status(400).json({ error: 'groupIds must be an array' })
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
    })

    res.json({ user })
  } catch {
    res.status(500).json({ error: 'Failed to update user groups' })
  }
})

// Update a user's role (Admin only)
router.patch('/:id/role', requireRole('Admin'), async (req, res) => {
  try {
    const { id } = req.params
    const { role } = req.body

    if (!['Admin', 'Editor', 'Viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' })
    }

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
    })

    res.json({ user })
  } catch {
    res.status(500).json({ error: 'Failed to update user role' })
  }
})

export default router
