import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { AuthService, getTokenVersion, type TokenPayload } from '../services/authService';

const authService = new AuthService();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload
    }
  }
}

/**
 * Verify a token payload is still valid for its user: the user must exist and
 * the token's version must match the current one, so a password change, a role
 * change or a deletion takes effect without waiting for the 24h expiry.
 */
export async function isTokenCurrent(payload: TokenPayload): Promise<boolean> {
  const current = await getTokenVersion(payload.userId);
  if (current === null) return false;
  return (payload.tokenVersion ?? 0) >= current;
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  let payload: TokenPayload;
  try {
    payload = authService.verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // A media-scoped token may only fetch images and streams (see `mediaAuth`).
  if (payload.scope === 'media') {
    return res.status(401).json({ error: 'This token cannot be used for API requests' });
  }

  if (!(await isTokenCurrent(payload))) {
    return res.status(401).json({ error: 'Session is no longer valid; sign in again' });
  }

  req.user = payload;
  next();
}

// Role hierarchy: Admin > Editor > Viewer
const roleHierarchy: Record<Role, number> = {
  Admin: 3,
  Editor: 2,
  Viewer: 1,
};

export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Find the minimum required role level
    const minRequiredLevel = Math.min(...allowedRoles.map((role) => roleHierarchy[role]));
    const userLevel = roleHierarchy[req.user.role];

    // User's role level must be >= the minimum required level
    if (userLevel < minRequiredLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
