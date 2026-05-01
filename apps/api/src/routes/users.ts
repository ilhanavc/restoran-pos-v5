import { randomUUID } from 'node:crypto';
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
  RepositoryError,
  type DB,
  type UserRow,
} from '@restoran-pos/db';
import {
  UserCreateApiRequestSchema,
  UserUpdateSchema,
  UserPasswordChangeSchema,
  type UserPublic,
  type UserRole,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  validateBody,
  validateParams,
  idParamSchema,
} from '../middleware/validate.js';
import { hashPassword, verifyPassword } from '../auth/password';
import { writeAudit } from '../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS, domainError } from '../errors.js';

export interface UsersRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
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
 * Users CRUD — admin-only (password değişimi hariç).
 *
 * ADR-002 §6 RBAC: bütün rotalar `authorize(['admin'])`.
 * ADR-002 §10 Lifecycle: soft delete + son admin guard + self-delete guard +
 * refresh token revoke + audit (her CRUD).
 * ADR-006 §5.2 error registry: USER_NOT_FOUND (404), USER_LAST_ADMIN_PROTECTED
 * (409), USER_CANNOT_DELETE_SELF (403), VALIDATION_ERROR (400).
 *
 * `permissions.ts` merkezi mekanizma Sprint 3b kapsamı dışı (PR #31 plan
 * revizyonu): mevcut authorize() middleware + inline conditional pattern
 * kullanılır. Refactor 3+ ABAC kural noktası birikince yapılacak.
 */
export function usersRouter(deps: UsersRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * Password change brute-force defense (`PATCH /users/:id/password`).
   * 5 deneme / 15dk / IP. Auth login ile aynı policy: `currentPassword`
   * tahmin saldırısını rate-limit ile keser. IP başına bucket; production'da
   * trust proxy aktif (`req.ip` X-Forwarded-For'tan gelir).
   */
  const passwordChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message_key: AUTH_MESSAGE_KEYS.AUTH_RATE_LIMITED,
        },
      });
    },
  });

  /**
   * Mass-delete defense — admin compromise senaryosunda ardışık DELETE
   * çağrıları rate-limit'lenir. 10 istek / dakika / IP. Normal admin akışı
   * etkilenmez (tek seferde 10'dan fazla user silmek olağan değil).
   */
  const userDeleteLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message_key: AUTH_MESSAGE_KEYS.AUTH_RATE_LIMITED,
        },
      });
    },
  });

  /**
   * POST /users — admin-only. 201 + UserPublic.
   * `username` (DB legacy kolon, v5'te display "name") = req.body.name doğrudan
   * yazılır; PATCH ile tutarlı. UNIQUE(username) constraint'i yok (ADR-002 §10.1
   * borç notu, v5.1'de dedicated alan + UNIQUE kararı).
   */
  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(UserCreateApiRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = randomUUID();
        const passwordHash = await hashPassword(req.body.password);
        const username = req.body.name;

        // ADR-002 §10.4: domain mutation + audit INSERT tek transaction.
        // INSERT users patlarsa audit yazılmaz; INSERT users başarılı + audit
        // patlarsa BEGIN/COMMIT roll back → user yaratılmamış sayılır.
        const created = await deps.db.transaction().execute(async (trx) => {
          const repo = createUsersRepository(trx);
          const row = await repo.create({
            id: userId,
            tenantId: req.user!.tenantId,
            email: req.body.email,
            username,
            passwordHash,
            role: req.body.role,
          });

          await writeAudit(trx, {
            tenantId: req.user!.tenantId,
            eventType: 'user.created',
            actorUserId: req.user!.userId,
            entityType: 'user',
            entityId: row.id,
            rawPayload: {
              target_user_id: row.id,
              role: row.role,
            },
          });

          return row;
        });

        res.status(201).json({ data: { user: toUserPublic(created) } });
        return;
      } catch (err) {
        // 23505 unique_violation (email çakışması) → RepositoryError 'unique' →
        // errorHandler 409 RESOURCE_CONFLICT yanıtı.
        return next(err);
      }
    },
  );

  /**
   * GET /users — admin-only. Aktif kullanıcılar (deleted_at IS NULL),
   * tenant-scoped, max 500 hard-cap, pagination yok (MVP).
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const usersRepo = createUsersRepository(deps.db);
        const rows = await usersRepo.findMany(req.user!.tenantId);
        res
          .status(200)
          .json({ data: { users: rows.map(toUserPublic) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * GET /users/:id — admin-only. 404 USER_NOT_FOUND eğer yok veya soft-deleted.
   * Cross-tenant izolasyon: tenant filtresi `findById` içinde; başka tenant'ın
   * kullanıcısı 404 (enumeration sızdırılmaz).
   */
  router.get(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const usersRepo = createUsersRepository(deps.db);
        const targetId = req.params.id as string;
        const row = await usersRepo.findById(req.user!.tenantId, targetId);
        if (row === null) {
          return next(domainError('USER_NOT_FOUND', 404));
        }
        res.status(200).json({ data: { user: toUserPublic(row) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /users/:id — admin-only partial update (email/role/name).
   * Password bu rotada YASAK; ayrı endpoint var.
   *
   * ADR-002 §10.3 cross-ref: admin'in role'ünü 'admin' dışına düşürürken
   * (downgrade) son admin guard'ı uygulanır. Aynı transaction içinde
   * `countActiveAdmins(tenant) === 1` ise 409 USER_LAST_ADMIN_PROTECTED.
   */
  router.patch(
    '/:id',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    validateBody(UserUpdateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const targetId = req.params.id as string;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const repo = createUsersRepository(trx);
          const target = await repo.findById(tenantId, targetId);
          if (target === null) {
            throw domainError('USER_NOT_FOUND', 404);
          }

          // Son admin role-downgrade guard (ADR-002 §10.3 cross-ref).
          if (
            target.role === 'admin' &&
            req.body.role !== undefined &&
            req.body.role !== 'admin'
          ) {
            const adminCount = await repo.countActiveAdmins(tenantId);
            if (adminCount === 1) {
              throw domainError('USER_LAST_ADMIN_PROTECTED', 409);
            }
          }

          const patch: { email?: string; role?: UserRole; username?: string } = {};
          if (req.body.email !== undefined) patch.email = req.body.email;
          if (req.body.role !== undefined) patch.role = req.body.role;
          if (req.body.name !== undefined) patch.username = req.body.name;

          const row = await repo.update(tenantId, targetId, patch);
          if (row === null) {
            throw domainError('USER_NOT_FOUND', 404);
          }

          // ADR-002 §10.4: update + audit AYNI transaction.
          // Audit payload — sanitize whitelist 'user.updated': target_user_id,
          // changed_fields, role_before, role_after. Email/name PII (DENY_LIST).
          await writeAudit(trx, {
            tenantId,
            eventType: 'user.updated',
            actorUserId: req.user!.userId,
            entityType: 'user',
            entityId: row.id,
            rawPayload: {
              target_user_id: row.id,
              changed_fields: Object.keys(req.body as Record<string, unknown>),
              role_after: row.role,
            },
          });

          return row;
        });

        res.status(200).json({ data: { user: toUserPublic(updated) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * DELETE /users/:id — admin-only HARD delete (ADR-002 §10.10 Amendment, 2026-05-01).
   *
   * Atomicity kontratı (TEK transaction):
   *   1. Self-delete guard (handler katmanı, transaction'dan ÖNCE).
   *   2. SELECT target (tenant-scoped).
   *   3. Target admin && countActiveAdmins === 1 → 409 USER_LAST_ADMIN_PROTECTED.
   *   4. DELETE FROM users WHERE id = $1.
   *      - audit_logs.actor_user_id ON DELETE SET NULL (kanıt korunur).
   *      - orders.waiter_user_id    ON DELETE SET NULL (sipariş geçmişi korunur).
   *      - refresh_tokens (user_id, tenant_id) ON DELETE CASCADE (Migration 018).
   *   5. INSERT audit_logs (user.deleted) — AYNI transaction içinde (§10.7).
   *
   * §10.8 access risk window (kabul edilen risk): mevcut access token
   * doğal expire'a kadar (TTL 30dk) kullanılabilir kalır. Domain kararı.
   *
   * Rate-limit: 10 istek / 1dk / IP — admin compromise senaryosunda mass-delete
   * saldırı yüzeyini daraltır.
   */
  router.delete(
    '/:id',
    userDeleteLimiter,
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateParams(idParamSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const actorId = req.user!.userId;
        const targetId = req.params.id as string;

        // ADR-002 §10.2 self-delete guard — transaction'a girmeden reddet.
        if (actorId === targetId) {
          return next(domainError('USER_CANNOT_DELETE_SELF', 403));
        }

        await deps.db.transaction().execute(async (trx) => {
          const repo = createUsersRepository(trx);
          const target = await repo.findById(tenantId, targetId);
          if (target === null) {
            throw domainError('USER_NOT_FOUND', 404);
          }

          // ADR-002 §10.3 + §10.4 — son admin guard. countActiveAdmins
          // FOR UPDATE ile aktif admin satırlarını kilitler; paralel iki
          // farklı admin'e DELETE atılsa bile, ikinci transaction birincisinin
          // COMMIT'ini bekler ve "0 admin kalır" race kapanır.
          if (target.role === 'admin') {
            const adminCount = await repo.countActiveAdmins(tenantId);
            if (adminCount === 1) {
              throw domainError('USER_LAST_ADMIN_PROTECTED', 409);
            }
          }

          // Hard delete — refresh_tokens FK ON DELETE CASCADE (Migration 018)
          // ile token satırları otomatik silinir; manuel revoke step kaldırıldı.
          // audit_logs.actor_user_id (target'ın yarattığı audit'ler) ON DELETE
          // SET NULL ile NULL'a düşer — kanıt korunur.
          await repo.hardDelete(tenantId, targetId);

          // ADR-002 §10.7: audit INSERT aynı transaction içinde — COMMIT
          // sonrası audit yazımı patlarsa "kim sildi kanıtı yok" senaryosu
          // engellenir. event_type 'user.deleted' (Amendment 2026-05-01;
          // eski 'user.soft_delete' tarihsel kayıtlarda kalır).
          await writeAudit(trx, {
            tenantId,
            eventType: 'user.deleted',
            actorUserId: actorId,
            entityType: 'user',
            entityId: targetId,
            rawPayload: {
              target_user_id: targetId,
              hard_delete: true,
            },
          });
        });

        res.status(204).end();
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /users/:id/password — kendi şifresi (any role) veya admin başkasının
   * şifresi.
   *
   * - Kendi şifresi (req.user.userId === :id): `currentPassword` zorunlu;
   *   verifyPassword başarısız → 401 AUTH_INVALID_CREDENTIALS.
   * - Admin başkasının şifresi: `currentPassword` opsiyonel (admin reset);
   *   herhangi bir tenant kullanıcısı hedef olabilir.
   * - Diğer (non-admin başkasının şifresi) → 403 AUTH_FORBIDDEN.
   *
   * Rate-limit: 5 istek / 15dk / IP (auth login ile aynı policy).
   * `currentPassword` brute-force tahmin saldırısını keser.
   */
  router.patch(
    '/:id/password',
    passwordChangeLimiter,
    authenticate(deps.accessSecret),
    validateParams(idParamSchema),
    validateBody(UserPasswordChangeSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const actorId = req.user!.userId;
        const actorRole = req.user!.role as UserRole;
        const targetId = req.params.id as string;
        const tenantId = req.user!.tenantId;

        const isSelf = actorId === targetId;
        const isAdminResettingOther = actorRole === 'admin' && !isSelf;
        if (!isSelf && !isAdminResettingOther) {
          return next(domainError('AUTH_FORBIDDEN', 403));
        }

        const usersRepo = createUsersRepository(deps.db);
        const target = await usersRepo.findById(tenantId, targetId);
        if (target === null) {
          // Kendi user_id'siyle gelip soft-deleted çıkarsa 401 değil 404
          // (cross-tenant: yine 404 — enumeration sızdırılmaz).
          return next(domainError('USER_NOT_FOUND', 404));
        }

        if (isSelf) {
          // currentPassword zorunlu (öz-değişim akışı).
          if (
            req.body.currentPassword === undefined ||
            req.body.currentPassword.length === 0
          ) {
            return next(domainError('AUTH_BAD_REQUEST', 400));
          }
          const ok = await verifyPassword(
            req.body.currentPassword,
            target.password_hash,
          );
          if (!ok) {
            return next(domainError('AUTH_INVALID_CREDENTIALS', 401));
          }
        }

        const newHash = await hashPassword(req.body.newPassword);

        // ADR-002 §10.4: updatePassword + audit AYNI transaction içinde.
        await deps.db.transaction().execute(async (trx) => {
          const repo = createUsersRepository(trx);
          await repo.updatePassword(tenantId, targetId, newHash);

          // Audit — password change ayrı sessiz akış; user.updated payload'ı
          // changed_fields=['password'] ile yazılır (sanitize whitelist üzerinden).
          await writeAudit(trx, {
            tenantId,
            eventType: 'user.updated',
            actorUserId: actorId,
            entityType: 'user',
            entityId: targetId,
            rawPayload: {
              target_user_id: targetId,
              changed_fields: ['password'],
              role_after: target.role,
            },
          });
        });

        res.status(200).json({ success: true });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}

// Tip-safety: dış import ile kullanılmıyor ama RepositoryError'ı route hata
// yolunda erişilir tutmak için reference. Tree-shake'e takılmaz.
export type { RepositoryError };
