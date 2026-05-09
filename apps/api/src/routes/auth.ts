import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
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
import { validateBody } from '../middleware/validate.js';
import { AuthError, AUTH_MESSAGE_KEYS } from '../errors.js';

const ACCESS_TTL_SECONDS = 30 * 60;

// Timing-safe email enumeration defense — compared when user not found, result discarded.
// Must be a valid bcrypt hash to avoid bcrypt format errors.
const DUMMY_HASH =
  '$2b$12$AAAAAAAAAAAAAAAAAAAAAAuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu';

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
    email: row.email,
    role: row.role as UserRole,
    name: row.username,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Tek satırda AuthError üretici — `messageKey` daima sözlükten gelir,
 * eksik anahtar geliştirici hatasıdır → INTERNAL_ERROR'a düşer.
 */
function authError(
  code: keyof typeof AUTH_MESSAGE_KEYS | string,
  status: number,
  details?: unknown,
): AuthError {
  return new AuthError(
    code,
    AUTH_MESSAGE_KEYS[code] ?? 'error.internal',
    status,
    details,
  );
}

export function authRouter(deps: AuthRouterDeps): ExpressRouter {
  const router = Router();

  // Login: 5 istek / 15 dakika / IP. Brute-force defense.
  // E2E test bypass: E2E_BYPASS_LOGIN_LIMIT=1 → skip (Sprint 12 PR-3d).
  // Playwright globalSetup 3 user + senaryolar 2-3 ek login = 5+ kapasite.
  // CI dışı ortamlarda env var set edilmediği için prod davranışı aynı.
  const bypassLimit =
    process.env['E2E_BYPASS_LOGIN_LIMIT'] === '1' ||
    process.env['E2E_BYPASS_LOGIN_LIMIT'] === 'true';
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => bypassLimit,
    handler: (_req, res) => {
      // express-rate-limit kendi yanıtını üretir; envelope manuel maps edilir.
      res.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message_key: AUTH_MESSAGE_KEYS.AUTH_RATE_LIMITED,
        },
      });
    },
  });

  router.post(
    '/login',
    loginLimiter,
    validateBody(LoginRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const usersRepo = createUsersRepository(deps.db);
        const user = await usersRepo.findByEmail(
          deps.tenantId,
          req.body.email,
        );

        // Email/şifre ayrımı yapılmaz — enumeration defense.
        if (user === null) {
          await verifyPassword(req.body.password, DUMMY_HASH); // constant-time, result ignored
          return next(authError('AUTH_INVALID_CREDENTIALS', 401));
        }
        const ok = await verifyPassword(
          req.body.password,
          user.password_hash,
        );
        if (!ok) {
          return next(authError('AUTH_INVALID_CREDENTIALS', 401));
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
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/refresh',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // CSRF-lite: cookie'ye ek olarak custom header şart.
        // SameSite=Strict zaten cross-site engelliyor; bu ekstra savunma katmanı.
        if (req.header('X-Refresh-Request') !== '1') {
          return next(authError('AUTH_CSRF_CHECK_FAILED', 403));
        }

        const cookies = req.cookies as Record<string, string | undefined>;
        const plain = cookies[REFRESH_COOKIE_NAME];
        if (plain === undefined || plain.length === 0) {
          return next(authError('AUTH_REFRESH_INVALID', 401));
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
          return;
        } catch (err) {
          if (err instanceof RefreshTokenError) {
            // Reuse veya invalid — ikisi de 401, kullanıcıya ayrım sızdırılmaz.
            clearRefreshCookie(res);
            return next(authError('AUTH_REFRESH_INVALID', 401));
          }
          throw err;
        }
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/logout',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const cookies = req.cookies as Record<string, string | undefined>;
        const plain = cookies[REFRESH_COOKIE_NAME];
        if (plain !== undefined && plain.length > 0) {
          await revokeRefreshToken(deps.db, plain);
        }
        clearRefreshCookie(res);
        res.status(200).json({ success: true });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  router.get(
    '/me',
    authenticate(deps.accessSecret),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (req.user === undefined) {
          return next(authError('AUTH_TOKEN_INVALID', 401));
        }
        const usersRepo = createUsersRepository(deps.db);
        const row = await usersRepo.findById(
          req.user.tenantId,
          req.user.userId,
        );
        if (row === null) {
          return next(authError('AUTH_TOKEN_INVALID', 401));
        }
        res.status(200).json({ user: toUserPublic(row) });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
