import { z } from 'zod';

/**
 * Tenant ayarları şeması — Sprint 6 Görev 24 + ADR-015.
 *
 * MVP kapsam (kapsam kilidi):
 *   - `timezone` (IANA, örn. 'Europe/Istanbul')
 *   - `tenantName` read-only — tenants JOIN ile döner, PATCH'te yazılmaz
 *
 * ADR-015: `businessDayCutoffHour` Migration 026 ile DROP edildi
 * (anasayfa raporları takvim günü kullanır; cutoff terkedildi).
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
  /** ADR-016 §11 Karar 11.3: Caller ID popup'ı tek istasyona düşer; null = atanmamış. */
  callerIdStationUserId: z.string().uuid().nullable(),
  /**
   * ADR-016 §11: Kurumsal hat / call-center prefix'leri (regex). Eşleşen ham
   * numaralar bridge'den gelse de log'a yazılmaz, popup tetiklenmez.
   */
  callerIdBypassPatterns: z.array(z.string()).default([]),
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
 * ADR-015: `businessDayCutoffHour` MVP kapsamından çıkarıldı (Migration 026).
 */
export const TenantSettingsUpdateSchema = z
  .object({
    timezone: z
      .string()
      .regex(IANA_TZ_REGEX, 'invalid IANA timezone')
      .optional(),
    /** ADR-016 §11 Karar 11.3 — null = istasyon ataması temizle. */
    callerIdStationUserId: z.string().uuid().nullable().optional(),
    /** ADR-016 §11 — bypass regex listesi tam değiştirme (PATCH semantik). */
    callerIdBypassPatterns: z.array(z.string().min(1).max(200)).max(50).optional(),
  })
  .refine(
    (data) =>
      data.timezone !== undefined ||
      data.callerIdStationUserId !== undefined ||
      data.callerIdBypassPatterns !== undefined,
    { message: 'patch:empty_body' },
  );
export type TenantSettingsUpdate = z.infer<typeof TenantSettingsUpdateSchema>;
