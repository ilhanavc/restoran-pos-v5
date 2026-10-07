import { Pool } from 'pg';

/**
 * ADR-041 Amd5 K6 test-harness — TTL-cleanup cron'unu prod-sadık şekilde
 * `cron_purger` (**BYPASSRLS**) rolü altında koşturan pg Pool.
 *
 * `createAppTenantPool`'un **aynadaki eşi**: o "bypass ETMEYEN" rolü kurar ve
 * RLS'in ısırdığını kanıtlar; bu ise "bypass EDEN" rolü kurar ve cron'un
 * `tenant_id IS NULL` işlerinin (sistem-actor self-audit INSERT'i + NULL-tenant
 * retention DELETE'i) gerçekten çalıştığını kanıtlar.
 *
 * Rol connect-time option'ı (`-c role=cron_purger`) ile düşürülür — `SET ROLE`'un
 * yarış-güvenli hali; bağlantı üzerindeki ilk sorgudan ÖNCE uygulanır. Bağlanan
 * kullanıcı (test/dev'de `postgres` superuser) her rolün üyesi olduğundan SET ROLE
 * serbesttir → **testte LOGIN/parola GEREKMEZ**. `cron_purger LOGIN PASSWORD …`
 * yalnız PROD deploy adımıdır (Amd5 K7), test bunu taklit etmez.
 *
 * **Neden gerekli:** `audit_logs` force-RLS'li (migration 063) ve policy NULL
 * tenant'ı `WITH CHECK … AND tenant_id IS NOT NULL` ile reddeder. Cron testleri
 * süperuser pool'uyla koşarsa RLS hiç devreye girmez → cron'un yanlış rolle
 * koştuğu **maskelenir** (F4d-2'de `purgePrintJobs` tam bu tuzağa düşmüştü:
 * sarım sökülüyken de test yeşil kalıyordu). Bu pool ile yanlış rol KIRMIZI verir.
 *
 * ⚠️ `cron_purger`'ın GRANT'leri **dar**: yalnız `audit_logs`/`call_logs`/
 * `print_jobs`/`refresh_tokens` üzerinde SELECT+DELETE (`refresh_tokens`
 * mig 002:44'ten beri; S136'da `purgeRefreshTokens` ile ilk kez KULLANILIYOR),
 * artı `audit_logs` INSERT (063 ile), `tenants` SELECT (Amd5 düzeltmesi) ve
 * `refresh_tokens` üzerinde **yalnız üç PII kolonunda** UPDATE (mig 067 —
 * anonimleştirme; `token_hash`/`revoked_at`/`expires_at` UPDATE'i `42501` ile
 * REDDEDİLİR ve bu daraltma `ttl-cleanup.test.ts`'te assert edilir).
 * Fixture/seed bu pool'la YAPILMAZ — onlar düz `createPool` (superuser) ile
 * kalır. Yani cron testi üç pool görebilir: fixture=superuser,
 * app=app_tenant, cron=cron_purger.
 *
 * Yalnız test/dev içindir — prod'da cron `CRON_DATABASE_URL` ile doğrudan
 * `cron_purger` rolüne bağlanır ve M5 boot-assertion bunu doğrular (Amd5 K3).
 */
export function createCronPurgerPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    options: '-c role=cron_purger',
    // Prod'daki `CONNECTION LIMIT 2` ile aynı mertebede tut: cron tek işçi,
    // yüksek eşzamanlılık gerekmez ve paralel vitest worker'larında
    // max_connections baskısını arttırmamalı.
    max: 2,
    idleTimeoutMillis: 10_000,
  });
}
