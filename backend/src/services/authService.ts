import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { prisma } from '../config/database'
import type { Role } from '@prisma/client'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const SALT_ROUNDS = 10

export interface TokenPayload {
  userId: string
  name: string
  role: Role
}

export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS)
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
  }

  generateToken(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' })
  }

  verifyToken(token: string): TokenPayload {
    return jwt.verify(token, JWT_SECRET) as TokenPayload
  }

  async needsSetup(): Promise<boolean> {
    const userCount = await prisma.user.count()
    return userCount === 0
  }

  async createInitialAdmin(name: string, password: string) {
    const userCount = await prisma.user.count()
    if (userCount > 0) {
      throw new Error('Setup has already been completed')
    }

    const passwordHash = await this.hashPassword(password)
    const user = await prisma.user.create({
      data: {
        passwordHash,
        name,
        role: 'Admin',
      },
      select: {
        id: true,
        name: true,
        role: true,
        createdAt: true,
      },
    })

    const token = this.generateToken({
      userId: user.id,
      name: user.name,
      role: user.role,
    })

    return { user, token }
  }

  async login(name: string, password: string) {
    const user = await prisma.user.findUnique({ where: { name } })
    if (!user) {
      throw new Error('Invalid username or password')
    }

    const isValid = await this.verifyPassword(password, user.passwordHash)
    if (!isValid) {
      throw new Error('Invalid username or password')
    }

    const token = this.generateToken({
      userId: user.id,
      name: user.name,
      role: user.role,
    })

    return {
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
    }
  }
}
