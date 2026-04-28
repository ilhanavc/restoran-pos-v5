import type { DbExecutor } from './users.js';
import { mapPgError, RepositoryError } from '../errors.js';

/**
 * GET response — `tenant_settings` JOIN `tenants` (tenant.name + soft-delete
 * filter). Snake_case (DB-shape); route handler camelCase'e map eder.
 */
export interface TenantSettingsRow {
  tenant_id: string;
  tenant_name: string;
  timezone: string;
  business_day_cutoff_hour: number;
  created_at: Date;
  updated_at: Date;
}

export interface UpdateTenantSettingsParams {
  timezone?: string;
  businessDayCutoffHour?: number;
}

export interface TenantSettingsRepository {
  /**
   * Tenant ayarlarını + tenants.name JOIN ile döner (admin + cashier read).
   * Soft-deleted tenant satırı düşer (defansif; soft delete bugün UI'da yok).
   * Satır yoksa null — handler 404 SETTINGS_NOT_FOUND fırlatır.
   */
  findByTenantId(tenantId: string): Promise<TenantSettingsRow | null>;

  /**
   * Partial update. En az bir alan dolu olmalı (handler refine garanti eder).
   * Hiçbir satır eşleşmezse `null` (defansif — seed garantili).
   *
   * DB trigger `validate_timezone` (000_init.sql:54-63) IANA olmayan TZ için
   * SQLSTATE 23514 atar; repo bunu mesaj pattern eşleşmesi ile
   * `RepositoryError('check', 'SETTINGS_INVALID_TIMEZONE')`'a çevirir →
   * route handler 400 SETTINGS_INVALID_TIMEZONE'a map eder.
   *
   * `business_day_cutoff_hour BETWEEN 0 AND 23` CHECK constraint (000_init.sql:131-132)
   * zod'da da var; defansif olarak DB ihlali için generic 'check' kalır.
   */
  update(
    tenantId: string,
    params: UpdateTenantSettingsParams,
  ): Promise<TenantSettingsRow | null>;
}

/**
 * Tenant settings repository. Transaction-aware (`Kysely<DB>` veya `Transaction<DB>`).
 * PATCH handler'ında `update + writeAudit` tek transaction içinde çağrılır
 * (ADR-002 §10.4 atomicity).
 */
export function createTenantSettingsRepository(
  db: DbExecutor,
): TenantSettingsRepository {
  return {
    async findByTenantId(tenantId) {
      const row = await db
        .selectFrom('tenant_settings as ts')
        .innerJoin('tenants as t', 't.id', 'ts.tenant_id')
        .select([
          'ts.tenant_id',
          't.name as tenant_name',
          'ts.timezone',
          'ts.business_day_cutoff_hour',
          'ts.created_at',
          'ts.updated_at',
        ])
        .where('ts.tenant_id', '=', tenantId)
        .where('t.deleted_at', 'is', null)
        .executeTakeFirst();
      return row ?? null;
    },

    async update(tenantId, params) {
      const patch: Partial<{
        timezone: string;
        business_day_cutoff_hour: number;
      }> = {};
      if (params.timezone !== undefined) patch.timezone = params.timezone;
      if (params.businessDayCutoffHour !== undefined) {
        patch.business_day_cutoff_hour = params.businessDayCutoffHour;
      }

      try {
        const updated = await db
          .updateTable('tenant_settings')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .returningAll()
          .executeTakeFirst();
        if (updated === undefined) return null;

        // RETURNING tenant_settings only — tenant.name için ek lookup
        return await this.findByTenantId(tenantId);
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'check') {
          // validate_timezone trigger 23514 + RAISE EXCEPTION 'Invalid IANA timezone: ...'
          // Mesaj pattern eşleşmesi ile timezone-spesifik koda map et.
          const msg =
            err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? '');
          if (msg.toLowerCase().includes('invalid iana timezone')) {
            throw new RepositoryError(
              'check',
              'SETTINGS_INVALID_TIMEZONE',
              mapped.detail,
            );
          }
          throw mapped;
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },
  };
}
