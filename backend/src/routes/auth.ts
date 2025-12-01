import { Router } from 'express';
import { AuthService } from '../services/authService';

const router = Router();
const authService = new AuthService();

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Login
 *     description: Authenticate with username and password
 *     security: []
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
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Missing credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', async (req, res) => {
  try {
    const { name, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authService.login(name, password);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    res.status(401).json({ error: message });
  }
});

/**
 * @openapi
 * /api/auth/setup:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Check setup status
 *     description: Check if initial admin setup is required
 *     security: []
 *     responses:
 *       200:
 *         description: Setup status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 needsSetup:
 *                   type: boolean
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/setup', async (_req, res) => {
  try {
    const needsSetup = await authService.needsSetup();
    res.json({ needsSetup });
  } catch {
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

/**
 * @openapi
 * /api/auth/setup:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Create initial admin
 *     description: Create the initial admin user (only works when no users exist)
 *     security: []
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
 *     responses:
 *       201:
 *         description: Admin created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       400:
 *         description: Setup failed or already complete
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/setup', async (req, res) => {
  try {
    const { name, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await authService.createInitialAdmin(name, password);
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Setup failed';
    res.status(400).json({ error: message });
  }
});

export default router;
