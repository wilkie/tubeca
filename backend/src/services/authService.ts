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
  /**
   * The user's `tokenVersion` when this token was issued. Absent on tokens
   * issued before versioning existed; those count as version 0.
   */
  tokenVersion?: number
  /**
   * `media` marks a token that may only fetch images and streams. Those URLs
   * travel in `src` attributes, where a header cannot be set, so they end up in
   * logs, history and shared links; a scoped, short-lived token limits what a
   * leaked one can do. A token with no scope is a full session token.
   */
  scope?: 'media'
}

/** How long a media-scoped token lasts. Long enough for a viewing session, short enough to matter. */
export const MEDIA_TOKEN_TTL_SECONDS = 4 * 60 * 60;

/**
 * `tokenVersion` per user, so `authenticate` does not read the database on
 * every request (HLS pulls a segment every few seconds). Entries are dropped
 * when a version is bumped, so a password or role change takes effect at once;
 * the TTL only bounds staleness from writes made by another process.
 */
const TOKEN_VERSION_TTL_MS = 15000;
const tokenVersionCache = new Map<string, { version: number; expires: number }>();

/** Current token version for a user, or null when the user no longer exists. */
export async function getTokenVersion(userId: string): Promise<number | null> {
  const cached = tokenVersionCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.version;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  if (!user) {
    tokenVersionCache.delete(userId);
    return null;
  }
  tokenVersionCache.set(userId, { version: user.tokenVersion, expires: Date.now() + TOKEN_VERSION_TTL_MS });
  return user.tokenVersion;
}

/** Invalidate every token already issued to this user. */
export async function bumpTokenVersion(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  tokenVersionCache.delete(userId);
}

/** Forget a cached version (user deleted, or tests starting from a clean database). */
export function forgetTokenVersion(userId?: string): void {
  if (userId) tokenVersionCache.delete(userId);
  else tokenVersionCache.clear();
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

  /**
   * A short-lived token for image and stream URLs. It carries the same identity
   * and version as the session token, so access checks and invalidation behave
   * the same, but `authenticate` refuses it for anything else.
   */
  generateMediaToken(payload: Omit<TokenPayload, 'scope'>): { token: string; expiresAt: string } {
    const token = jwt.sign({ ...payload, scope: 'media' }, JWT_SECRET, {
      expiresIn: MEDIA_TOKEN_TTL_SECONDS,
    });
    return { token, expiresAt: new Date(Date.now() + MEDIA_TOKEN_TTL_SECONDS * 1000).toISOString() };
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
        tokenVersion: true,
        createdAt: true,
      },
    });

    const token = this.generateToken({
      userId: user.id,
      name: user.name,
      role: user.role,
      tokenVersion: user.tokenVersion,
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
      tokenVersion: user.tokenVersion,
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
