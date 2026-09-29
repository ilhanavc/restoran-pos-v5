/**
 * ADR-002 §13 — TTL cleanup cron testleri.
 *
 * DATABASE_URL set değilse skip edilir (CI'da Postgres koşar).
 *
 * Test senaryoları:
 *   1. purgeCallLogs: 30 günden eski call_logs silinir, yeniler kalır.
 *   2. purgeAuditLogs: 2 yıldan eski audit_logs silinir, yeniler kalır.
 *   3. Advisory lock collision: harici client lock alır → task silent exit.
 *   4. purgePrintJobs: 30 günden eski TERMİNAL job silinir; queued ASLA
 *      silinmez (ADR-004 Amd5 KVKK retention — paket fişi payload PII'si).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createKysely, type DB } from '@restoran-pos/db';
import { createAppTenantPool } from '../helpers/appTenantPool';
import { createCronPurgerPool } from '../helpers/cronPurgerPool';
import { CRON_LOCK_IDS } from '@restoran-pos/shared-domain';
import {
  purgeAuditLogs,
  purgeCallLogs,
  purgePrintJobs,
} from '../../cron/ttl-cleanup.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('ttl-cleanup cron (ADR-002 §13)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  // ADR-041 F4a — cron RLS harness: purgeCallLogs `withTenant` sarımı (call_logs
  // RLS) yalnız app_tenant (NOBYPASSRLS) altında GERÇEKTEN sınanır. Superuser
  // pool ile sarım sökülse bile test yeşil kalırdı (sahte-yeşil, F2 dersi
  // [[feedback_rls_consumer_completeness_audit]]). Seed/assertion superuser `db`
  // ile; cron çağrısı app_tenant `appPool`/`appDb` ile.
  let appPool: Pool;
  let appDb: Kysely<DB>;
  // ADR-041 Amd5 K5/K6 — cron ARTIK prod'da `cron_purger` (BYPASSRLS) pool'uyla
  // koşuyor: audit_logs force-RLS'li (mig 063) ve cron'un `tenant_id IS NULL`
  // işleri (sistem-actor self-audit INSERT + NULL-tenant retention DELETE)
  // app_tenant ile İMKÂNSIZ. Test bu rolü `-c role=cron_purger` ile taklit eder
  // (süperuser her rolün üyesi → LOGIN/parola gerekmez; o yalnız prod adımı).
  // ⚠️ Süperuser `pool` ile koşulursa RLS hiç devreye girmez → yanlış rol
  // MASKELENİR (F4d-2'de purgePrintJobs tam bu tuzağa düşmüştü).
  let cronPool: Pool;
  let cronDb: Kysely<DB>;
  const tenantId = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    appPool = createAppTenantPool(DATABASE_URL ?? '');
    appDb = createKysely(appPool);
    cronPool = createCronPurgerPool(DATABASE_URL ?? '');
    cronDb = createKysely(cronPool);

    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: 'TTL Test Tenant',
        slug: `ttl-test-${tenantId.slice(0, 8)}`,
      })
      .execute();
  });

  afterAll(async () => {
    // Best-effort cleanup; CASCADE FK olmadığı için manuel sırayla.
    await sql`DELETE FROM call_logs WHERE tenant_id = ${tenantId}::uuid`.execute(
      db,
    );
    await sql`DELETE FROM print_jobs WHERE tenant_id = ${tenantId}::uuid`.execute(
      db,
    );
    await sql`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`.execute(
      db,
    );
    await sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`.execute(db);
    await db.destroy();
    await appDb.destroy();
    await cronDb.destroy();
  });

  it('purgeCallLogs: 30 günden eski silinir, yeniler kalır', async () => {
    const oldId = randomUUID();
    const newId = randomUUID();
    // 31 gün önce ve 5 gün önce iki kayıt insert et.
    await sql`
      INSERT INTO call_logs (id, tenant_id, normalized_phone, status, received_at)
      VALUES
        (${oldId}::uuid, ${tenantId}::uuid, '+905551112233', 'completed', now() - interval '31 days'),
        (${newId}::uuid, ${tenantId}::uuid, '+905551112244', 'completed', now() - interval '5 days')
    `.execute(db);

    // app_tenant altında koştur → withTenant sarımı RLS'e tabi. Sarım sökülürse
    // fail-closed 0 satır silinir → `not.toContain(oldId)` KIRMIZI (negatif-kontrol).
    // ADR-041 Amd5 K5 — prod'da üç task da `cron_purger` ile koşar. appPool
    // (app_tenant) ile koşmak DELETE'i doğru yapar (F4a sarımı sayesinde) ama
    // self-audit NULL INSERT'ini policy reddeder ve try/catch YUTAR → log'da
    // 42501, testte sessizlik. O degradasyon ayrı bir testle belgelendi
    // ("defense-in-depth" testi); burada prod-sadık rol kullanılır.
    await purgeCallLogs({ pool: cronPool, db: cronDb });

    const remaining = await db
      .selectFrom('call_logs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .execute();
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(oldId);
  });

  it('purgeAuditLogs: 2 yıldan eski silinir, yeniler kalır', async () => {
    const oldId = randomUUID();
    const newId = randomUUID();
    await sql`
      INSERT INTO audit_logs (id, tenant_id, event_type, payload, actor, created_at)
      VALUES
        (${oldId}::uuid, ${tenantId}::uuid, 'auth.login', '{}'::jsonb, '{}'::jsonb, now() - interval '3 years'),
        (${newId}::uuid, ${tenantId}::uuid, 'auth.login', '{}'::jsonb, '{}'::jsonb, now() - interval '7 days')
    `.execute(db);

    // ADR-041 Amd5 K5 — `cron_purger` (BYPASSRLS) ZORUNLU: audit_logs
    // force-RLS'li (mig 063) ve `purgeAuditLogs`'un İKİ pass'i var —
    // per-tenant (:245) **ve** `tenant_id IS NULL` sistem-actor (:274). NULL
    // pass'i `withTenant` ile sarılamaz (helper geçersiz UUID'de tx açmaz),
    // app_tenant ile de policy 0 satır döndürür. Süperuser `pool` ile koşmak
    // RLS'i tümden bypass eder → yanlış rol MASKELENİR (sahte-yeşil).
    await purgeAuditLogs({ pool: cronPool, db: cronDb });

    const remaining = await db
      .selectFrom('audit_logs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .execute();
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(newId);
    expect(ids).not.toContain(oldId);
  });

  it('purgePrintJobs: 30 günden eski TERMİNAL job silinir; yeni terminal + eski queued KALIR', async () => {
    const oldSuccess = randomUUID();
    const newSuccess = randomUUID();
    const oldQueued = randomUUID();
    await sql`
      INSERT INTO print_jobs (id, tenant_id, status, payload, created_at, updated_at)
      VALUES
        (${oldSuccess}::uuid, ${tenantId}::uuid, 'success', '{"kind":"kitchen"}'::jsonb, now() - interval '40 days', now() - interval '31 days'),
        (${newSuccess}::uuid, ${tenantId}::uuid, 'success', '{"kind":"kitchen"}'::jsonb, now() - interval '10 days', now() - interval '5 days'),
        (${oldQueued}::uuid,  ${tenantId}::uuid, 'queued',  '{"kind":"kitchen"}'::jsonb, now() - interval '40 days', now() - interval '31 days')
    `.execute(db);

    // ADR-041 Amd5 K5 — prod-sadık rol: cron_purger (BYPASSRLS). Süperuser
    // `pool` ile koşulursa RLS tümden bypass olur ve yanlış rol maskelenir
    // (Amd4 K5 / F2 dersi, dosya başındaki not).
    await purgePrintJobs({ pool: cronPool, db: cronDb });

    const remaining = await db
      .selectFrom('print_jobs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .execute();
    const ids = remaining.map((r) => r.id);
    expect(ids).toContain(newSuccess); // 30 günden yeni terminal → kalır
    expect(ids).toContain(oldQueued); // queued yaşına bakılmaksızın ASLA silinmez
    expect(ids).not.toContain(oldSuccess); // eski terminal → silindi
  });

  /**
   * ADR-041 Amd5 K5'in **defense-in-depth iddiasının sınırı** (S134 ampirik
   * bulgusu). K5, Amd4 K3'ün `withTenant` sarımının "pool yanlış yapılandırılırsa
   * ikinci ağ" olarak KALMASINA karar verdi. Bu test o iddianın tam olarak ne
   * kadarını karşıladığını kayda geçirir:
   *
   *   ✅ Retention DELETE'i app_tenant (NOBYPASSRLS) ile de DOĞRU çalışır —
   *      sarım tenant context'i sağlar, eski terminal kayıt silinir.
   *   ❌ Self-audit izi KAYBOLUR — `tenantId: null` INSERT'i policy'nin
   *      `WITH CHECK … AND tenant_id IS NOT NULL` koşuluna takılır (42501) ve
   *      task'ın try/catch'i hatayı YUTAR. Yani yanlış pool sessizce
   *      "sildim ama kaydetmedim" durumuna düşer.
   *
   * Bu kabul edilmiş bir degradasyondur (veri korunur, iz kaybolur) ve prod'da
   * M5 boot-assertion'ı (Amd5 K3) bu yapılandırmanın oluşmasını engeller.
   * Test bunu belgeler ki ileride "neden hem sarım hem bypass var" sorusunun
   * ve "log'da 42501 görüyorum" gözleminin cevabı kayıtlı olsun.
   */
  it('defense-in-depth: app_tenant pool ile DELETE doğru çalışır, self-audit izi kaybolur', async () => {
    const oldSuccess = randomUUID();
    const before = new Date();
    await sql`
      INSERT INTO print_jobs (id, tenant_id, status, payload, created_at, updated_at)
      VALUES (${oldSuccess}::uuid, ${tenantId}::uuid, 'success', '{"kind":"kitchen"}'::jsonb, now() - interval '40 days', now() - interval '31 days')
    `.execute(db);

    await purgePrintJobs({ pool: appPool, db: appDb });

    // (a) DELETE çalıştı — Amd4 K3 sarımının değeri.
    const remaining = await db
      .selectFrom('print_jobs')
      .select('id')
      .where('id', '=', oldSuccess)
      .execute();
    expect(remaining).toHaveLength(0);

    // (b) Ama self-audit yazılamadı — bu çağrıya ait `audit.purge` satırı YOK.
    const selfAudit = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_logs
      WHERE tenant_id IS NULL
        AND event_type = 'audit.purge'
        AND payload->>'table' = 'print_jobs'
        AND created_at >= ${before.toISOString()}::timestamptz
    `.execute(db);
    expect(selfAudit.rows[0]?.n).toBe(0);
  });

  it('advisory lock collision: harici client lock tutuyorsa silent exit', async () => {
    const oldId = randomUUID();
    await sql`
      INSERT INTO call_logs (id, tenant_id, normalized_phone, status, received_at)
      VALUES
        (${oldId}::uuid, ${tenantId}::uuid, '+905557778899', 'completed', now() - interval '60 days')
    `.execute(db);

    const lockId = CRON_LOCK_IDS.TTL_CLEANUP_CALL_LOGS.toString();
    const blocker = await pool.connect();
    try {
      const got = await blocker.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [lockId],
      );
      expect(got.rows[0]?.acquired).toBe(true);

      // Lock zaten harici clientte → task silent exit, throw atmaz, satırı silmez.
      await expect(purgeCallLogs({ pool, db })).resolves.toBeUndefined();

      const stillThere = await db
        .selectFrom('call_logs')
        .select('id')
        .where('id', '=', oldId)
        .execute();
      expect(stillThere.map((r) => r.id)).toContain(oldId);
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [lockId]);
      blocker.release();
    }

    // Lock serbest → ikinci çağrı satırı silsin (cleanup için).
    await purgeCallLogs({ pool, db });
    const after = await db
      .selectFrom('call_logs')
      .select('id')
      .where('id', '=', oldId)
      .execute();
    expect(after).toHaveLength(0);
  });
});
