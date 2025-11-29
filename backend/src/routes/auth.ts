import { Router } from 'express'
import { AuthService } from '../services/authService'

const router = Router()
const authService = new AuthService()

router.post('/login', async (req, res) => {
  try {
    const { name, password } = req.body

    if (!name || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    const result = await authService.login(name, password)
    res.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed'
    res.status(401).json({ error: message })
  }
})

router.get('/setup', async (_req, res) => {
  try {
    const needsSetup = await authService.needsSetup()
    res.json({ needsSetup })
  } catch {
    res.status(500).json({ error: 'Failed to check setup status' })
  }
})

router.post('/setup', async (req, res) => {
  try {
    const { name, password } = req.body

    if (!name || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    const result = await authService.createInitialAdmin(name, password)
    res.status(201).json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Setup failed'
    res.status(400).json({ error: message })
  }
})

export default router
