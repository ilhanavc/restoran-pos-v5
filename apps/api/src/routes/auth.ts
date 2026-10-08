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
  withTenant,
  type DB,
  type UserRow,
} from '@restoran-pos/db';
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  type LoginResponse,
  type RefreshResponse,
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
        // ADR-041 Amd7 F4e-2 — `users` force-RLS'li (mig 065) → bu SELECT
        // tenant context'i ŞART. Sarılmazsa app_tenant altında 0 satır döner
        // (hata değil, görünmezlik) → HER LOGIN 401 olur.
        //
        // ⚠️ Sarım KISA TUTULUR (Amd7 Düzeltme 2 dersi, F4e-1'de agent
        // register'da yaşandı): `verifyPassword` bcrypt'tir (cost 12, ~250ms).
        // Açık bir transaction içinde çağrılırsa pool client'ı o süre boyunca
        // tutulur; pool `max: 10` ve bu endpoint KİMLİĞİ DOĞRULANMAMIŞtır
        // (`loginLimiter` IP başınadır) → dağıtık istek havuzu tüketip API'yi
        // geneli için stall edebilir. Bu yüzden transaction YALNIZ DB okumasını
        // kapsar; parola doğrulaması aşağıda, transaction DIŞINDA koşar.
        const user = await withTenant(deps.db, deps.tenantId, (trx) =>
          createUsersRepository(trx).findByEmail(
            deps.tenantId,
            req.body.email,
          ),
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

        // Mobil (RN) cookie-jar tutmaz → refresh'i body'den alır. `X-Client:
        // mobile` header'ı bu akışı gate'ler. Web bu header'ı göndermez →
        // refresh yalnız HttpOnly cookie'de kalır (XSS'e kapalı, davranış birebir).
        // Gate login'de yeterli: saldırgan email+şifre olmadan login olamaz.
        const wantsBodyRefresh = req.header('X-Client') === 'mobile';

        const body: LoginResponse = {
          accessToken,
          expiresIn: ACCESS_TTL_SECONDS,
          user: toUserPublic(user),
          ...(wantsBodyRefresh && { refreshToken: plain }),
        };
        res.status(200).json(body);
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  router.post(
    '/refresh',
    validateBody(RefreshRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // CSRF-lite: cookie'ye ek olarak custom header şart (mobil de gönderir).
        // SameSite=Strict zaten cross-site engelliyor; bu ekstra savunma katmanı.
        if (req.header('X-Refresh-Request') !== '1') {
          return next(authError('AUTH_CSRF_CHECK_FAILED', 403));
        }

        // Transport: cookie (web) önceliklidir; yoksa body (mobil). ADR-002 §2.
        const cookies = req.cookies as Record<string, string | undefined>;
        const cookieTok = cookies[REFRESH_COOKIE_NAME];
        const bodyTok = (req.body as { refreshToken?: string }).refreshToken;
        const token =
          cookieTok !== undefined && cookieTok.length > 0 ? cookieTok : bodyTok;
        if (token === undefined || token.length === 0) {
          return next(authError('AUTH_REFRESH_INVALID', 401));
        }

        // KRİTİK GÜVENLİK GATE: yeni refresh token'ı YALNIZ token body'den
        // geldiğinde (mobil) body'de döndür. Cookie-kaynaklı (web) refresh ASLA
        // body'de dönmez. Aksi halde tarayıcıdaki XSS, HttpOnly cookie'yi
        // `credentials:include` ile otomatik göndertip `X-Client: mobile` ekleyerek
        // yeni refresh'i JSON'dan okuyup HttpOnly korumasını delerdi. Saldırgan
        // body token'ı sağlayamaz (HttpOnly, JS okuyamaz) → kaynak gate'i bunu kapatır.
        const isBodySourced =
          (cookieTok === undefined || cookieTok.length === 0) &&
          bodyTok !== undefined &&
          bodyTok.length > 0;

        try {
          const result = await rotateRefreshToken({
            db: deps.db,
            // ADR-041 Amd7 K4(1) — pre-context tenant: login ile AYNI kaynak.
            tenantId: deps.tenantId,
            plainToken: token,
            accessSecret: deps.accessSecret,
          });
          if (isBodySourced) {
            // Mobil: cookie SET ETME (kullanmaz), yeni refresh'i body'de dön.
            const body: RefreshResponse = {
              accessToken: result.accessToken,
              expiresIn: ACCESS_TTL_SECONDS,
              refreshToken: result.newPlainToken,
            };
            res.status(200).json(body);
          } else {
            // Web: yeni refresh HttpOnly cookie'de; body'de YOK (davranış birebir).
            setRefreshCookie(res, result.newPlainToken);
            const body: RefreshResponse = {
              accessToken: result.accessToken,
              expiresIn: ACCESS_TTL_SECONDS,
            };
            res.status(200).json(body);
          }
          return;
        } catch (err) {
          if (err instanceof RefreshTokenError) {
            // Reuse veya invalid — ikisi de 401, kullanıcıya ayrım sızdırılmaz.
            // Cookie-kaynaklı akışta cookie temizlenir; body-kaynaklı (mobil)
            // istemci kendi secure-store'unu temizler, Set-Cookie gereksiz.
            if (!isBodySourced) {
              clearRefreshCookie(res);
            }
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
    validateBody(RefreshRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Transport: cookie (web) önceliklidir; yoksa body (mobil). `/refresh`
        // ile BİREBİR aynı desen (yukarı bkz.) — ADR-002 §12.5.
        //
        // ⚠️ S137'ye kadar BURADA YALNIZ COOKIE OKUNUYORDU ve bu, uç sessizce
        // hiçbir şey yapmadığı için fark edilmedi: cookie `Path` tam olarak
        // `/api/auth/refresh`'e kilitliydi → tarayıcı `/api/auth/logout`'a
        // cookie GÖNDERMİYOR → `plain` undefined → revoke atlanıyor → 200.
        // Prod'da 4483 satırda `revoked_reason='logout'` sayısı **0**'dı.
        // İki düzeltme birlikte gerekli: cookie path genişletildi (`cookie.ts`)
        // VE mobil için body kanalı açıldı (mobil cookie kullanmaz, refresh'i
        // gövdede taşır → `apps/mobile/src/api/http.ts`).
        //
        // `/refresh`'teki `isBodySourced` gate'i BURADA GEREKMEZ: o gate yeni
        // refresh token'ın XSS'e sızmasını engeller, logout ise hiçbir token
        // DÖNDÜRMEZ. Logout'a ileride bir yanıt gövdesi eklenirse aynı
        // muhakeme yeniden yapılmalı (ADR-002 §12.5).
        const cookies = req.cookies as Record<string, string | undefined>;
        const cookieTok = cookies[REFRESH_COOKIE_NAME];
        const bodyTok = (req.body as { refreshToken?: string }).refreshToken;
        const plain =
          cookieTok !== undefined && cookieTok.length > 0 ? cookieTok : bodyTok;
        if (plain !== undefined && plain.length > 0) {
          // ADR-041 Amd7 K4(1) — pre-context tenant: login ile AYNI kaynak.
          await revokeRefreshToken(deps.db, deps.tenantId, plain);
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
        const { tenantId, userId } = req.user;
        // ADR-041 Amd7 F4e-2 — `users` force-RLS'li (mig 065). Sarılmazsa
        // 0 satır → geçerli bir access token'la bile `/me` 401 döner (web ve
        // mobil açılışta bu uçla oturumu doğrular → tüm istemciler kilitlenir).
        const row = await withTenant(deps.db, tenantId, (trx) =>
          createUsersRepository(trx).findById(tenantId, userId),
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
