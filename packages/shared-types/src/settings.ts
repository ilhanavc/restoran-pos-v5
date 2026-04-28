import { z } from 'zod';

/**
 * Sprint 6 Görev 24 — `/settings` GET + PATCH (ADR-002 §6 amendment).
 *
 * MVP kapsam kilidi: yalnız `timezone` + `business_day_cutoff_hour` —
 * fiş header / telefon / vergi no v5.1 backlog. Diğer alanlar bu şemaya
 * eklenmez (kapsam ihlali → ayrı ADR).
 */

/**
 * PATCH /settings request body — admin only (`settings.manage`).
 *
 * Partial update: en az bir alan dolu olmalı; boş body 400 VALIDATION_ERROR
 * (`refine` üzerinden errorHandler'a delege). `.strict()` bilinmeyen alanları
 * reddeder (kapsam kilidi: v5.1 alanları sessizce kabul edilemez).
 *
 * `timezone` IANA TZ string'i; `Intl.DateTimeFormat` constructor invalid TZ
 * için throw eder — refine bunu yakalar.
 */
export const SettingsUpdateRequestSchema = z
  .object({
    timezone: z
      .string()
      .min(1)
      .refine(
        (tz) => {
          try {
            Intl.DateTimeFormat('en', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        },
        { message: 'invalid_iana_timezone' },
      )
      .optional(),
    business_day_cutoff_hour: z.number().int().min(0).max(23).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.timezone !== undefined || data.business_day_cutoff_hour !== undefined,
    { message: 'patch:empty_body' },
  );
export type SettingsUpdateRequest = z.infer<typeof SettingsUpdateRequestSchema>;

/**
 * GET /settings response — read-only join with `tenants.name`.
 *
 * `tenant_name` v5.1'de PATCH'lenebilir olacak (yasaklar listesi); MVP read-only.
 * Tüm alanlar non-null (000_init.sql tenant kaydında 1:1 seed garantisi).
 */
export const TenantSettingsPublicSchema = z.object({
  tenant_id: z.string().uuid(),
  tenant_name: z.string(),
  timezone: z.string(),
  business_day_cutoff_hour: z.number().int().min(0).max(23),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type TenantSettingsPublic = z.infer<typeof TenantSettingsPublicSchema>;
