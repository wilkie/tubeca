import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { AuthService, type TokenPayload } from '../services/authService';

const authService = new AuthService();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = authService.verifyToken(token);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
