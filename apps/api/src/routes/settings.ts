import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { getSettings, updateSettings, type DB } from '@restoran-pos/db';
import {
  SettingsUpdateRequestSchema,
  TenantSettingsPublicSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';

export interface SettingsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * Sprint 6 Görev 24 — `/settings` GET + PATCH (ADR-002 §6 amendment).
 *
 * RBAC: admin-only her iki endpoint için (`settings.read` + `settings.manage`,
 * permissions matrix). `authorize(['admin'])` middleware ile rol kontrol;
 * `hasPermission` zaten tip union'ında, action seviyesi route handler'lara
 * delege (areas.ts pattern).
 *
 * Kapsam kilidi:
 *  - GET response: yalnız `tenant_id`, `tenant_name`, `timezone`,
 *    `business_day_cutoff_hour`, timestamps. Fiş header / telefon / vergi
 *    no v5.1 backlog.
 *  - PATCH body: yalnız `timezone` + `business_day_cutoff_hour`.
 *    `tenants.name` PATCH yasak (v5.1).
 *
 * Atomicity (ADR-002 §10.4): PATCH'te UPDATE + audit INSERT TEK transaction.
 */
export function settingsRouter(deps: SettingsRouterDeps): ExpressRouter {
  const router = Router();

  /**
   * GET /settings — admin-only, tenant-scoped. 200 + TenantSettingsPublic.
   * 1:1 seed garantisi (000_init.sql tenant kaydı) → eksik satır integrity
   * ihlali, repository RepositoryError('not_found') fırlatır → 404
   * RESOURCE_NOT_FOUND. Normal akışta tetiklenmemeli.
   */
  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const row = await getSettings(deps.db, req.user!.tenantId);
        const body = TenantSettingsPublicSchema.parse({
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_name,
          timezone: row.timezone,
          business_day_cutoff_hour: row.business_day_cutoff_hour,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        });
        res.status(200).json({ data: { settings: body } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PATCH /settings — admin-only partial update.
   *
   * Boş body 400 VALIDATION_ERROR (`SettingsUpdateRequestSchema.refine()`).
   * Invalid timezone 400 (Intl.DateTimeFormat refine; DB tz_check trigger
   * ikinci savunma).
   *
   * Tek transaction: getSettings(before) → UPDATE → audit INSERT
   * (`settings.updated`, ALLOWED_KEYS whitelist: changed_fields,
   * timezone_before/after, business_day_cutoff_hour_before/after).
   * Hiçbir alan gerçekten değişmediyse audit yazılmaz (gürültü filtresi).
   */
  router.patch(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(SettingsUpdateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;

        const result = await deps.db.transaction().execute(async (trx) => {
          const before = await getSettings(trx, tenantId);
          const updated = await updateSettings(trx, tenantId, {
            ...(req.body.timezone !== undefined && {
              timezone: req.body.timezone,
            }),
            ...(req.body.business_day_cutoff_hour !== undefined && {
              business_day_cutoff_hour: req.body.business_day_cutoff_hour,
            }),
          });

          const changedFields: string[] = [];
          const auditPayload: Record<string, unknown> = {};
          if (
            req.body.timezone !== undefined &&
            req.body.timezone !== before.timezone
          ) {
            changedFields.push('timezone');
            auditPayload.timezone_before = before.timezone;
            auditPayload.timezone_after = updated.timezone;
          }
          if (
            req.body.business_day_cutoff_hour !== undefined &&
            req.body.business_day_cutoff_hour !==
              before.business_day_cutoff_hour
          ) {
            changedFields.push('business_day_cutoff_hour');
            auditPayload.business_day_cutoff_hour_before =
              before.business_day_cutoff_hour;
            auditPayload.business_day_cutoff_hour_after =
              updated.business_day_cutoff_hour;
          }

          if (changedFields.length > 0) {
            auditPayload.changed_fields = changedFields;
            await writeAudit(trx, {
              tenantId,
              eventType: 'settings.updated',
              actorUserId: req.user!.userId,
              entityType: 'tenant_settings',
              entityId: tenantId,
              rawPayload: auditPayload,
            });
          }

          return { before, updated };
        });

        const body = TenantSettingsPublicSchema.parse({
          tenant_id: result.updated.tenant_id,
          tenant_name: result.before.tenant_name,
          timezone: result.updated.timezone,
          business_day_cutoff_hour: result.updated.business_day_cutoff_hour,
          created_at: result.updated.created_at.toISOString(),
          updated_at: result.updated.updated_at.toISOString(),
        });
        res.status(200).json({ data: { settings: body } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
