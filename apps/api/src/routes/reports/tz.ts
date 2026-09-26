import type { Kysely } from 'kysely';
import { withTenant, type DB } from '@restoran-pos/db';

/**
 * ADR-015 Karar 2 — `tenant_settings.timezone` (IANA) okunup
 * `getCalendarDayWindow(tz)` ile takvim günü pencereleri hesaplanır.
 *
 * Ortak helper: 8 endpoint aynı `tenant_settings.timezone` lookup'ını yapar.
 * Tenant satırı yoksa defansif olarak 'Europe/Istanbul' (seed default) döner —
 * pratikte multi-tenant guard zaten satırın varlığını garanti eder.
 *
 * ADR-041 F4d — `tenant_settings` RLS'e alındı. Sarım bilinçli olarak HELPER'IN
 * İÇİNDE: imza `db: Kysely<DB>` kalır, 18 call-site (17 rapor endpoint'i +
 * audit-logs.ts) değişmez ve yeni bir rapor endpoint'i sarımı unutamaz.
 *
 * ⚠️ Bu yolun sessiz-bozulma riski: sarım olmadan RLS 0 satır döndürür, aşağıdaki
 * `?? 'Europe/Istanbul'` default'u devreye girer ve HATA FIRLATMAZ — tenant TZ'si
 * Istanbul dışıysa tüm rapor gün pencereleri sessizce yanlış hesaplanır. Default
 * bilinçli korundu (davranış değişikliği ayrı iş, v5.1); sarımın doğruluğunu
 * `tenant-isolation.test.ts` negatif kontrolü kanıtlar.
 */
export async function resolveTenantTimezone(
  db: Kysely<DB>,
  tenantId: string,
): Promise<string> {
  const row = await withTenant(db, tenantId, (trx) =>
    trx
      .selectFrom('tenant_settings')
      .select('timezone')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst(),
  );
  return row?.timezone ?? 'Europe/Istanbul';
}
