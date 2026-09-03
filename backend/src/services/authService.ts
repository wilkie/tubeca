import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import type { Role } from '@prisma/client';

const DEV_JWT_SECRET = 'dev-secret-change-in-production';
const PLACEHOLDER_JWT_SECRET = 'change-this-to-a-secure-random-string';

/**
 * Resolve the JWT signing secret from the environment.
 *
 * In production a missing or placeholder secret is a fatal misconfiguration:
 * anyone could mint tokens. Outside production we fall back to a fixed
 * development secret and warn.
 */
export function resolveJwtSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.JWT_SECRET?.trim();
  if (secret && secret !== PLACEHOLDER_JWT_SECRET) {
    return secret;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET must be set to a secure random value in production (e.g. `openssl rand -hex 32`)'
    );
  }
  console.warn('⚠️  JWT_SECRET is not set; using an insecure development default');
  return DEV_JWT_SECRET;
}

const JWT_SECRET = resolveJwtSecret();
const SALT_ROUNDS = 10;

export interface TokenPayload {
  userId: string
  name: string
  role: Role
}

export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  generateToken(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  }

  verifyToken(token: string): TokenPayload {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  }

  async needsSetup(): Promise<boolean> {
    const userCount = await prisma.user.count();
    return userCount === 0;
  }

  async createInitialAdmin(name: string, password: string) {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      throw new Error('Setup has already been completed');
    }

    const passwordHash = await this.hashPassword(password);
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
    });

    const token = this.generateToken({
      userId: user.id,
      name: user.name,
      role: user.role,
    });

    return { user, token };
  }

  async login(name: string, password: string) {
    const user = await prisma.user.findUnique({ where: { name } });
    if (!user) {
      throw new Error('Invalid username or password');
    }

    const isValid = await this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('Invalid username or password');
    }

    const token = this.generateToken({
      userId: user.id,
      name: user.name,
      role: user.role,
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
    };
  }
}
