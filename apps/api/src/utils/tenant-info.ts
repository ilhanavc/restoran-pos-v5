import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';

/**
 * ADR-021 (Sprint 14 PR-4b1) — Tenant slug + timezone resolver.
 *
 * `tenants.slug` (Migration 000_init L116) + `tenant_settings.timezone` JOIN.
 * CSV filename'i `<reportName>-<slug>-<YYYY-MM-DD>-<HHmmss>.csv` pattern'inde
 * tenant TZ'sinde formatlamak için kullanılır.
 *
 * Cache YOK — her request DB'den okur. PR-4a tarafındaki `resolveTenantTimezone`
 * de cache'siz. Multi-tenant izolasyon için tenant_id WHERE şart.
 *
 * Defansif default: tenant_settings satırı yoksa 'Europe/Istanbul' (seed default)
 * döner — pratikte multi-tenant guard zaten satırın varlığını garanti eder.
 *
 * `tenants.slug` NOT NULL UNIQUE; satır yoksa Error fırlatılır (yetkili kullanıcı
 * varsa tenant da var olmalı; aksi auth katmanında çoktan reddedilirdi).
 */
export async function getTenantInfo(
  db: Kysely<DB>,
  tenantId: string,
): Promise<{ slug: string; timezone: string }> {
  const row = await db
    .selectFrom('tenants as t')
    .leftJoin('tenant_settings as ts', 'ts.tenant_id', 't.id')
    .select(['t.slug', 'ts.timezone'])
    .where('t.id', '=', tenantId)
    .executeTakeFirst();

  if (row === undefined) {
    throw new Error(`tenant-info: tenant ${tenantId} not found`);
  }

  return {
    slug: row.slug,
    timezone: row.timezone ?? 'Europe/Istanbul',
  };
}
