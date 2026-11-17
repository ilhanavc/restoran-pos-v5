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
  withTenant,
  type DB,
  type ReceiptSettingsRow,
  type TenantSettingsRow,
} from '@restoran-pos/db';
import {
  ReceiptSettingsUpdateSchema,
  ReceiptTestPrintSchema,
  TenantSettingsUpdateSchema,
  type ReceiptSettings,
  type ReceiptSettingsUpdate,
  type ReceiptTestPrint,
} from '@restoran-pos/shared-types';
import { enqueueTestBillJob } from '../print/enqueue-test-bill-job.js';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { writeAudit } from '../audit/writeAudit.js';
import rateLimit from 'express-rate-limit';
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

function toReceiptResponse(row: ReceiptSettingsRow): ReceiptSettings {
  return {
    receiptHeaderLines: row.receipt_header_lines,
    receiptFooterLines: row.receipt_footer_lines,
    packingAutoPrintEnabled: row.packing_auto_print_enabled,
  };
}

/** İki dizi/null değerin aynı olup olmadığı (audit `changed_fields` için). */
function sameLines(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

/**
 * /settings endpoint — Sprint 6 Görev 24.
 *
 * Kapsam (Session 40 kararı, kapsam kilidi):
 *   - GET (admin + cashier): timezone + business_day_cutoff_hour + tenant.name (read-only)
 *   - PATCH (admin only): yalnız timezone + business_day_cutoff_hour
 *
 * Fiş üst/alt bilgisi (telefon, adres dahil serbest metin) ADR-045 ile
 * `/settings/receipt` altında açıldı. KDV oranları / vergi no hâlâ AÇIK
 * (ADR-045 K10; fiskal/e-Arşiv "hedef değil").
 *
 * RBAC matrix:
 *   - GET:   admin + cashier  (ADR-002 §6 amendment — `tenant.settings.read`)
 *   - PATCH: admin only       (ADR-002 §6      — `tenant.settings`)
 *   - GET/PUT /receipt, POST /receipt/test-print: admin only (`tenant.settings`,
 *     ADR-045 K2 — fiş metni kasiyere açık `GET /` yanıtına GİRMEZ)
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

  // Deneme fişi iş dışı bir yol: her çağrı bir fiş çizer ve `print_jobs`'a
  // onlarca KB'lık satır yazar. Anahtar İŞLETME (kimlik doğrulamasından sonra
  // konur) — aynı IP'yi paylaşan cihazlar birbirini kilitlemesin.
  const testPrintLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.user!.tenantId,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RECEIPT_TEST_PRINT_RATE_LIMITED',
          message_key: AUTH_MESSAGE_KEYS.RECEIPT_TEST_PRINT_RATE_LIMITED,
        },
      });
    },
  });

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
        // ADR-041 F4d — tenant_settings RLS: okuma withTenant context'i
        // gerektirir, aksi halde politika satırı gizler → her istek 404.
        const tenantId = req.user!.tenantId;
        const row = await withTenant(deps.db, tenantId, (trx) =>
          createTenantSettingsRepository(trx).findByTenantId(tenantId),
        );
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

        // ADR-041 F4d — kendi tx'ini açan yol (own-tx escapee, F3c bulkDelete
        // sınıfı): withTenant aynı atomisiteyi korur + context enjekte eder,
        // böylece hem UPDATE hem writeAudit RLS altında görünür kalır.
        const updated = await withTenant(deps.db, tenantId, async (trx) => {
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

  /** GET /settings/receipt — ADR-045 K7, admin only. */
  router.get(
    '/receipt',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const row = await withTenant(deps.db, tenantId, (trx) =>
          createTenantSettingsRepository(trx).findReceiptSettings(tenantId),
        );
        if (row === null) {
          throw domainError('SETTINGS_NOT_FOUND', 404);
        }
        res.status(200).json({ data: { receipt: toReceiptResponse(row) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * PUT /settings/receipt — ADR-045 K7, admin only, TAM değiştirme.
   * "Varsayılana dön" = metin alanları `null` (K9: satır asla silinmez).
   * UPDATE + audit tek `withTenant` transaction'ında (ADR-002 §10.4).
   */
  router.put(
    '/receipt',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(ReceiptSettingsUpdateSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const body = req.body as ReceiptSettingsUpdate;

        const updated = await withTenant(deps.db, tenantId, async (trx) => {
          const repo = createTenantSettingsRepository(trx);
          const before = await repo.findReceiptSettings(tenantId);
          if (before === null) {
            throw domainError('SETTINGS_NOT_FOUND', 404);
          }
          const after = await repo.updateReceiptSettings(tenantId, {
            receipt_header_lines: body.receiptHeaderLines,
            receipt_footer_lines: body.receiptFooterLines,
            packing_auto_print_enabled: body.packingAutoPrintEnabled,
          });
          if (after === null) {
            throw domainError('SETTINGS_NOT_FOUND', 404);
          }

          const changedFields: string[] = [];
          if (!sameLines(before.receipt_header_lines, after.receipt_header_lines))
            changedFields.push('receiptHeaderLines');
          if (!sameLines(before.receipt_footer_lines, after.receipt_footer_lines))
            changedFields.push('receiptFooterLines');
          if (before.packing_auto_print_enabled !== after.packing_auto_print_enabled)
            changedFields.push('packingAutoPrintEnabled');

          await writeAudit(trx, {
            tenantId,
            eventType: 'tenant_settings.receipt_updated',
            actorUserId: req.user!.userId,
            entityType: 'tenant_settings',
            entityId: tenantId,
            rawPayload: {
              tenant_id: tenantId,
              changed_fields: changedFields,
              receipt_header_lines_before: before.receipt_header_lines,
              receipt_header_lines_after: after.receipt_header_lines,
              receipt_footer_lines_before: before.receipt_footer_lines,
              receipt_footer_lines_after: after.receipt_footer_lines,
              packing_auto_print_enabled_before: before.packing_auto_print_enabled,
              packing_auto_print_enabled_after: after.packing_auto_print_enabled,
            },
          });
          return after;
        });

        res.status(200).json({ data: { receipt: toReceiptResponse(updated) } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  /**
   * POST /settings/receipt/test-print — ADR-045 K7, admin only.
   * KAYITLI ayarla örnek bir adisyonu "DENEME FİŞİ" işaretiyle gerçek kuyruğa
   * yazar; sipariş/ödeme satırı oluşmaz. Hedef doğrulaması `print-bill` ile
   * birebir: yok/başka işletmenin → 404, devre dışı → 409.
   */
  router.post(
    '/receipt/test-print',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    testPrintLimiter,
    validateBody(ReceiptTestPrintSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const { targetPrinterId } = req.body as ReceiptTestPrint;

        // Hedef doğrulama + kuyruğa yazma TEK transaction'da: arada yazıcı
        // devre dışı bırakılırsa iş yine de kuyruğa girmesin.
        await withTenant(deps.db, tenantId, async (trx) => {
          if (targetPrinterId !== undefined) {
            // ADR-041 Amd7 K3 — `agents` force-RLS → tenant context şart.
            const printer = await trx
              .selectFrom('agents')
              .select(['id', 'revoked_at'])
              .where('tenant_id', '=', tenantId)
              .where('id', '=', targetPrinterId)
              .forUpdate()
              .executeTakeFirst();
            if (printer === undefined) {
              throw domainError('PRINTER_NOT_FOUND', 404);
            }
            if (printer.revoked_at !== null) {
              throw domainError('PRINTER_REVOKED', 409);
            }
          }
          await enqueueTestBillJob(trx, {
            tenantId,
            actorUserId: req.user!.userId,
            targetAgentId: targetPrinterId,
          });
        });
        res.status(202).json({ data: { enqueued: true } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
