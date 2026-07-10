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
import type { DB } from '@restoran-pos/db';
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
  const tenantId = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

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

    await purgeCallLogs({ pool, db });

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

    await purgeAuditLogs({ pool, db });

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

    await purgePrintJobs({ pool, db });

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
