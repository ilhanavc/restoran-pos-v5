import { type Selectable } from 'kysely';
import type { TenantSettings } from '../generated.js';
import type { DbExecutor } from './users.js';
import { RepositoryError } from '../errors.js';

/**
 * Sprint 6 Görev 24 — `tenant_settings` repository (ADR-002 §6 amendment).
 *
 * Kapsam kilidi: yalnız `timezone` + `business_day_cutoff_hour`. v5.1
 * alanları (fiş header / telefon / vergi no) bu repo'ya eklenmez —
 * ayrı ADR + ayrı migration gerekir.
 *
 * `updated_at`: 000_init.sql L137 `tenant_settings_set_updated_at` trigger'ı
 * BEFORE UPDATE'te otomatik set ediyor → repo elle setlemez (areas.ts
 * pattern'iyle aynı; areas tablosu da trigger'a güveniyor).
 */

export type TenantSettingsRow = Selectable<TenantSettings>;

export interface TenantSettingsWithName {
  tenant_id: string;
  tenant_name: string;
  timezone: string;
  business_day_cutoff_hour: number;
  created_at: Date;
  updated_at: Date;
}

export interface UpdateSettingsParams {
  timezone?: string;
  business_day_cutoff_hour?: number;
}

/**
 * GET — tenant_settings + tenants.name join. 000_init.sql tenant kaydında
 * 1:1 satır seed eder (orders insert trigger §5.2 da bu garantiye dayanır);
 * eksik satır integrity ihlalidir → `RepositoryError('not_found')` fırlat,
 * handler 404 RESOURCE_NOT_FOUND'a maps eder.
 */
export async function getSettings(
  db: DbExecutor,
  tenantId: string,
): Promise<TenantSettingsWithName> {
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
    .executeTakeFirst();
  if (row === undefined) {
    throw new RepositoryError(
      'not_found',
      undefined,
      `tenant_settings missing for tenant ${tenantId}`,
    );
  }
  return row;
}

/**
 * PATCH — partial update. En az bir alan handler refine ile garanti edilir.
 * `updated_at` trigger otomatik (yukarıdaki not). Tenant kaydı seed ile
 * 1:1 olduğundan eşleşmeme = integrity ihlali (404 RESOURCE_NOT_FOUND).
 *
 * `timezone_check` BEFORE INSERT/UPDATE trigger (000_init.sql L141) DB'de
 * IANA TZ doğrular; uygulama refine'i (Intl.DateTimeFormat) ilk savunma.
 */
export async function updateSettings(
  db: DbExecutor,
  tenantId: string,
  params: UpdateSettingsParams,
): Promise<TenantSettingsRow> {
  const patch: Partial<{
    timezone: string;
    business_day_cutoff_hour: number;
  }> = {};
  if (params.timezone !== undefined) patch.timezone = params.timezone;
  if (params.business_day_cutoff_hour !== undefined) {
    patch.business_day_cutoff_hour = params.business_day_cutoff_hour;
  }

  const row = await db
    .updateTable('tenant_settings')
    .set(patch)
    .where('tenant_id', '=', tenantId)
    .returningAll()
    .executeTakeFirst();
  if (row === undefined) {
    throw new RepositoryError(
      'not_found',
      undefined,
      `tenant_settings missing for tenant ${tenantId}`,
    );
  }
  return row;
}
