import { z } from 'zod';

/**
 * Tenant ayarları şeması — Sprint 6 Görev 24.
 *
 * MVP kapsam (kapsam kilidi, Session 40):
 *   - `timezone` (IANA, örn. 'Europe/Istanbul')
 *   - `businessDayCutoffHour` (0..23 SMALLINT)
 *   - `tenantName` read-only — tenants JOIN ile döner, PATCH'te yazılmaz
 *
 * v5.1 backlog: fiş header (restoran adı override), telefon, vergi no,
 * KDV oranları (KDV `shared-domain/tax.ts` sabit).
 *
 * DB şema referansı: `packages/db/migrations/000_init.sql:128-143`.
 * `tenant_settings` PK = `tenant_id` (1-to-1 with tenants).
 */

/**
 * IANA timezone format — tek-parça (örn. 'UTC') VEYA `Continent/City`
 * (örn. 'Europe/Istanbul'). Loose regex; son hat DB trigger `validate_timezone`
 * (000_init.sql:54-63) pg_timezone_names lookup ile reject eder. "Mars/Olympus"
 * formatı geçer ama trigger 23514 atar → repo
 * `RepositoryError('check', 'SETTINGS_INVALID_TIMEZONE')`.
 */
const IANA_TZ_REGEX = /^[A-Za-z_]+(?:\/[A-Za-z_]+)*$/;

/**
 * GET /settings response item — admin + cashier (ADR-002 §6 amendment, Sprint 6).
 * `tenantName` tenants tablosundan JOIN ile gelir (read-only).
 */
export const TenantSettingsSchema = z.object({
  tenantId: z.string().uuid(),
  tenantName: z.string(),
  timezone: z.string(),
  businessDayCutoffHour: z.number().int().min(0).max(23),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

/**
 * PATCH /settings request body — admin only.
 *
 * Partial update: en az bir alan dolu olmalı (`refine`). Boş body 400
 * VALIDATION_ERROR. Zod regex erken yakalar invalid IANA format'ı; DB
 * trigger son hat ("Mars/Olympus" gibi syntactic-pass ama TZ db'de yok).
 *
 * `cutoffHour` 0..23 — DB CHECK constraint ile bire bir hizalı.
 */
export const TenantSettingsUpdateSchema = z
  .object({
    timezone: z
      .string()
      .regex(IANA_TZ_REGEX, 'invalid IANA timezone')
      .optional(),
    businessDayCutoffHour: z.number().int().min(0).max(23).optional(),
  })
  .refine(
    (data) =>
      data.timezone !== undefined || data.businessDayCutoffHour !== undefined,
    { message: 'patch:empty_body' },
  );
export type TenantSettingsUpdate = z.infer<typeof TenantSettingsUpdateSchema>;
