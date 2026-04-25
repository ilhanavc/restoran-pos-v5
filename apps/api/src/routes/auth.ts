import { Router, type Request, type Response, type Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import type { Kysely } from 'kysely';
import {
  createUsersRepository,
  type DB,
  type UserRow,
} from '@restoran-pos/db';
import {
  LoginRequestSchema,
  type UserPublic,
  type UserRole,
} from '@restoran-pos/shared-types';
import { signAccessToken } from '../auth/jwt';
import { verifyPassword } from '../auth/password';
import {
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
} from '../auth/cookie';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  RefreshTokenError,
} from '../auth/refresh';
import { authenticate } from '../middleware/authenticate';

const ACCESS_TTL_SECONDS = 30 * 60;

export interface AuthRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
  tenantId: string;
}

/**
 * UserRow → UserPublic projection. password_hash gibi hassas alanlar düşürülür.
 */
function toUserPublic(row: UserRow): UserPublic {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email ?? '',
    role: row.role as UserRole,
    name: row.username,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * `POST /auth/refresh` CSRF-lite koruma: cookie'ye ek olarak custom header şart.
 * SameSite=Strict zaten cross-site engelliyor; bu ekstra savunma katmanıdır.
 */
function requireRefreshCsrfHeader(req: Request, res: Response): boolean {
  if (req.header('X-Refresh-Request') !== '1') {
    res.status(403).json({ error: { code: 'AUTH_CSRF_CHECK_FAILED' } });
    return false;
  }
  return true;
}

export function authRouter(deps: AuthRouterDeps): ExpressRouter {
  const router = Router();

  // Login: 5 istek / 15 dakika / IP. Brute-force defense.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'AUTH_RATE_LIMITED' } });
    },
  });

  router.post('/login', loginLimiter, async (req: Request, res: Response) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'AUTH_BAD_REQUEST' } });
      return;
    }

    const usersRepo = createUsersRepository(deps.db);
    const user = await usersRepo.findByEmail(deps.tenantId, parsed.data.email);

    // Email/şifre ayrımı yapılmaz — enumeration defense.
    if (user === null) {
      res.status(401).json({ error: { code: 'AUTH_INVALID_CREDENTIALS' } });
      return;
    }
    const ok = await verifyPassword(parsed.data.password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: { code: 'AUTH_INVALID_CREDENTIALS' } });
      return;
    }

    const ip = req.ip;
    const ua = req.header('user-agent');
    const plain = await issueRefreshToken({
      db: deps.db,
      userId: user.id,
      tenantId: user.tenant_id,
      ...(ua !== undefined && { userAgent: ua }),
      ...(ip !== undefined && { ipAddress: ip }),
    });
    setRefreshCookie(res, plain);

    const accessToken = signAccessToken(
      {
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
      },
      deps.accessSecret,
    );

    res.status(200).json({
      accessToken,
      expiresIn: ACCESS_TTL_SECONDS,
      user: toUserPublic(user),
    });
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    if (!requireRefreshCsrfHeader(req, res)) return;

    const cookies = req.cookies as Record<string, string | undefined>;
    const plain = cookies[REFRESH_COOKIE_NAME];
    if (plain === undefined || plain.length === 0) {
      res.status(401).json({ error: { code: 'AUTH_REFRESH_INVALID' } });
      return;
    }

    try {
      const result = await rotateRefreshToken({
        db: deps.db,
        plainToken: plain,
        accessSecret: deps.accessSecret,
      });
      setRefreshCookie(res, result.newPlainToken);
      res.status(200).json({
        accessToken: result.accessToken,
        expiresIn: ACCESS_TTL_SECONDS,
      });
    } catch (err) {
      if (err instanceof RefreshTokenError) {
        // Reuse veya invalid — ikisi de 401, kullanıcıya ayrım sızdırılmaz.
        clearRefreshCookie(res);
        res.status(401).json({ error: { code: 'AUTH_REFRESH_INVALID' } });
        return;
      }
      res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
    }
  });

  router.post('/logout', async (req: Request, res: Response) => {
    const cookies = req.cookies as Record<string, string | undefined>;
    const plain = cookies[REFRESH_COOKIE_NAME];
    if (plain !== undefined && plain.length > 0) {
      await revokeRefreshToken(deps.db, plain);
    }
    clearRefreshCookie(res);
    res.status(200).json({ success: true });
  });

  router.get(
    '/me',
    authenticate(deps.accessSecret),
    async (req: Request, res: Response) => {
      if (req.user === undefined) {
        res.status(401).json({ error: { code: 'AUTH_TOKEN_INVALID' } });
        return;
      }
      const usersRepo = createUsersRepository(deps.db);
      const row = await usersRepo.findById(req.user.tenantId, req.user.userId);
      if (row === null) {
        res.status(401).json({ error: { code: 'AUTH_TOKEN_INVALID' } });
        return;
      }
      res.status(200).json({ user: toUserPublic(row) });
    },
  );

  return router;
}
