import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import {
  createTenantSettingsRepository,
  RepositoryError,
  type DB,
  type TenantSettingsRow,
} from '@restoran-pos/db';
import { TenantSettingsUpdateSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';
import { AuthError, AUTH_MESSAGE_KEYS, domainError } from '../errors.js';

export interface SettingsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * Repo snake_case satırını response camelCase'e map eder. tenant.name JOIN
 * ile gelir; PATCH'te yazılmaz (read-only).
 */
function toResponse(row: TenantSettingsRow): {
  tenantId: string;
  tenantName: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
} {
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    timezone: row.timezone,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * /settings endpoint — Sprint 6 Görev 24.
 *
 * Kapsam (Session 40 kararı, kapsam kilidi):
 *   - GET (admin + cashier): timezone + business_day_cutoff_hour + tenant.name (read-only)
 *   - PATCH (admin only): yalnız timezone + business_day_cutoff_hour
 *
 * v5.1 backlog (MVP DIŞI): fiş header, telefon, vergi no, KDV oranları.
 *
 * RBAC matrix:
 *   - GET:   admin + cashier  (ADR-002 §6 amendment — `tenant.settings.read`)
 *   - PATCH: admin only       (ADR-002 §6      — `tenant.settings`)
 *
 * ADR-006 §5.2 error codes:
 *   - SETTINGS_NOT_FOUND (404) — defansif (seed garantili)
 *   - SETTINGS_INVALID_TIMEZONE (400) — DB trigger `validate_timezone`
 *     IANA syntactic-pass ama TZ db'de yok ("Mars/Olympus" gibi)
 *   - VALIDATION_ERROR (400) — boş PATCH body, schema parse fail (zod)
 *
 * Audit:
 *   - GET: no-audit (read).
 *   - PATCH: `tenant_settings.updated` event tek transaction (ADR-002 §10.4).
 */
export function settingsRouter(deps: SettingsRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * GET /settings — admin + cashier (kasiyer dashboard tenant adı görüntüsü
   * ihtiyacı, Session 40 karar). Tenant-scoped; cross-tenant erişim mümkün
   * değil (req.user.tenantId JWT'den).
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createTenantSettingsRepository(deps.db);
        const row = await repo.findByTenantId(req.user!.tenantId);
        if (row === null) {
          throw domainError('SETTINGS_NOT_FOUND', 404);
        }
        res.status(200).json({ data: { settings: toResponse(row) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /settings — admin-only partial update.
   *
   * Boş body 400 VALIDATION_ERROR (zod refine `patch:empty_body`).
   * Invalid IANA TZ → zod regex erken yakalar (400 VALIDATION_ERROR);
   * pg_timezone_names lookup fail (örn. "Mars/Olympus") → DB trigger
   * 23514 → repo `RepositoryError('check', 'SETTINGS_INVALID_TIMEZONE')`
   * → handler 400 SETTINGS_INVALID_TIMEZONE.
   *
   * Tek transaction: UPDATE + audit INSERT (ADR-002 §10.4 atomicity).
   */
  router.patch(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(TenantSettingsUpdateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;

        const updated = await deps.db.transaction().execute(async (trx) => {
          const repo = createTenantSettingsRepository(trx);
          const before = await repo.findByTenantId(tenantId);
          if (before === null) {
            throw domainError('SETTINGS_NOT_FOUND', 404);
          }

          const patch: { timezone?: string } = {};
          if (req.body.timezone !== undefined) patch.timezone = req.body.timezone;

          let after: TenantSettingsRow | null;
          try {
            after = await repo.update(tenantId, patch);
          } catch (err) {
            // Repo SETTINGS_INVALID_TIMEZONE → 400; diğer 'check' RepositoryError'lar
            // toHttpError default'una düşer (ORDER_INVARIANT_VIOLATED 409).
            if (
              err instanceof RepositoryError &&
              err.cause === 'check' &&
              err.messageKey === 'SETTINGS_INVALID_TIMEZONE'
            ) {
              throw domainError('SETTINGS_INVALID_TIMEZONE', 400);
            }
            throw err;
          }
          if (after === null) {
            throw domainError('SETTINGS_NOT_FOUND', 404);
          }

          // Audit — whitelist 'tenant_settings.updated': tenant_id, changed_fields,
          // timezone_before/after. (ADR-015 — cutoff_hour Migration 026 ile DROP.)
          const changedFields = Object.keys(req.body as Record<string, unknown>);
          await writeAudit(trx, {
            tenantId,
            eventType: 'tenant_settings.updated',
            actorUserId: req.user!.userId,
            entityType: 'tenant_settings',
            entityId: tenantId,
            rawPayload: {
              tenant_id: tenantId,
              changed_fields: changedFields,
              timezone_before: before.timezone,
              timezone_after: after.timezone,
            },
          });

          return after;
        });

        res.status(200).json({ data: { settings: toResponse(updated) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
