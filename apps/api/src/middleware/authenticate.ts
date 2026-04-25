import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyAccessToken } from '../auth/jwt';

export interface AuthUser {
  userId: string;
  tenantId: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Bearer token middleware. `Authorization: Bearer <token>` → req.user.
 * Eksik/geçersiz → 401 AUTH_TOKEN_INVALID. Hata mesajında token detayı yok.
 */
export function authenticate(accessSecret: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: { code: 'AUTH_TOKEN_INVALID' } });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      res.status(401).json({ error: { code: 'AUTH_TOKEN_INVALID' } });
      return;
    }
    try {
      const payload = verifyAccessToken(token, accessSecret);
      req.user = {
        userId: payload.sub,
        tenantId: payload.tenant_id,
        role: payload.role,
      };
      next();
    } catch {
      res.status(401).json({ error: { code: 'AUTH_TOKEN_INVALID' } });
    }
  };
}
