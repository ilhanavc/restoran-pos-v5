import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { UserRole } from '@restoran-pos/shared-types';

/**
 * Role-based authorization. `authenticate` middleware ÖNCE çalışmış olmalı.
 * req.user yoksa 401, role uymuyorsa 403.
 */
export function authorize(roles: readonly UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user === undefined) {
      res.status(401).json({ error: { code: 'AUTH_TOKEN_INVALID' } });
      return;
    }
    if (!roles.includes(req.user.role as UserRole)) {
      res.status(403).json({ error: { code: 'AUTH_FORBIDDEN' } });
      return;
    }
    next();
  };
}
