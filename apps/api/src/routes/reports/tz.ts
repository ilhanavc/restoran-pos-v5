import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';

/**
 * ADR-015 Karar 2 — `tenant_settings.timezone` (IANA) okunup
 * `getCalendarDayWindow(tz)` ile takvim günü pencereleri hesaplanır.
 *
 * Ortak helper: 8 endpoint aynı `tenant_settings.timezone` lookup'ını yapar.
 * Tenant satırı yoksa defansif olarak 'Europe/Istanbul' (seed default) döner —
 * pratikte multi-tenant guard zaten satırın varlığını garanti eder.
 */
export async function resolveTenantTimezone(
  db: Kysely<DB>,
  tenantId: string,
): Promise<string> {
  const row = await db
    .selectFrom('tenant_settings')
    .select('timezone')
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  return row?.timezone ?? 'Europe/Istanbul';
}
