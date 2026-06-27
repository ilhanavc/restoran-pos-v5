import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';

/**
 * ADR-004 §Amendment 3 — print job retry requeue + stuck reclaim (Session 70).
 *
 * Reliability defect fix: iki sessiz mutfak-fişi kaybı vektörü.
 *   (A) retry job (retry_at backoff geçince) /jobs/next claim'inde yeniden
 *       'printing'e alınır (lazy requeue, cron yok).
 *   (B) stuck 'printing' (agent ölmüş, updated_at stale) reclaim edilir.
 *
 * Senaryolar:
 *   1. retry + retry_at<=now → claim (200, attempts DEĞİŞMEZ).
 *   2. retry + retry_at>now (backoff penceresi) → claim EDİLMEZ (204).
 *   3. stuck printing (updated_at>90s) → reclaim (200, attempts DEĞİŞMEZ).
 *   4. fresh printing (updated_at yeni) → reclaim EDİLMEZ (204).
 *   5. anti-starvation: eski stuck-printing + taze queued → queued önce.
 *   6. result handler printing→failed → retry + retry_at gelecekte set.
 *
 * Stuck job seed: INSERT'te updated_at geçmişe set edilir — print_jobs
 * set_updated_at trigger'ı BEFORE UPDATE'tir, INSERT'i etkilemez.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  agentToken: string;
}

const ctx: Partial<TestCtx> = {};

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'print job resilience — retry requeue + stuck reclaim (ADR-004 §Amendment 3)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.app = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: AGENT_SECRET,
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant Print Resilience',
          slug: `test-pres-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const agentId = randomUUID();
      const apiKey = `pk_${TENANT_ID.replace(/-/g, '').slice(0, 8)}_test-fixture-key`;
      const apiKeyHash = await bcrypt.hash(apiKey, 12);
      await db
        .insertInto('agents')
        .values({
          id: agentId,
          tenant_id: TENANT_ID,
          device_fingerprint: `fp-pres-${TENANT_ID.slice(0, 8)}`,
          api_key_hash: apiKeyHash,
        })
        .execute();
      ctx.agentToken = jwt.sign({ type: 'agent', tid: TENANT_ID }, AGENT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '1h',
        subject: agentId,
        jwtid: randomUUID(),
      });
    });

    beforeEach(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('print_jobs')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
      }
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('agents').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    function claim(waitSeconds: number): request.Test {
      return request(ctx.app!)
        .get(`/print/v1/jobs/next?wait=${waitSeconds.toString()}`)
        .set('Authorization', `Bearer ${ctx.agentToken!}`);
    }

    async function dbStatus(jobId: string): Promise<string | undefined> {
      const row = await ctx
        .db!.selectFrom('print_jobs')
        .select('status')
        .where('id', '=', jobId)
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirst();
      return row?.status;
    }

    it('retry + retry_at<=now → claim edilir, attempts değişmez', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_ID,
          status: 'retry',
          attempts: 1,
          retry_at: new Date(Date.now() - 5_000), // backoff geçti
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await claim(2);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(jobId);
      expect(res.body.job.status).toBe('printing');
      expect(res.body.job.attempts).toBe(1); // reclaim/requeue attempts'a dokunmaz
    });

    it('retry + retry_at>now (backoff penceresi) → claim EDİLMEZ (204)', async () => {
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          status: 'retry',
          attempts: 1,
          retry_at: new Date(Date.now() + 60_000), // henüz backoff içinde
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await claim(1);
      expect(res.status).toBe(204);
    });

    it('stuck printing (updated_at>90s) → reclaim edilir, attempts değişmez', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_ID,
          status: 'printing',
          attempts: 1,
          updated_at: new Date(Date.now() - 200_000), // 200s stale (>90s)
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await claim(2);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(jobId);
      expect(res.body.job.status).toBe('printing');
      expect(res.body.job.attempts).toBe(1); // reclaim attempts'ı bumplamaz
      expect(await dbStatus(jobId)).toBe('printing');
    });

    it('fresh printing (updated_at yeni) → reclaim EDİLMEZ (204)', async () => {
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          status: 'printing',
          attempts: 0,
          updated_at: new Date(), // taze, stale değil
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await claim(1);
      expect(res.status).toBe(204);
    });

    it('anti-starvation: eski stuck-printing + taze queued → queued önce claim', async () => {
      const stuckId = randomUUID();
      const queuedId = randomUUID();
      // Stuck printing: ESKİ created_at + stale updated_at.
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: stuckId,
          tenant_id: TENANT_ID,
          status: 'printing',
          attempts: 1,
          created_at: new Date(Date.now() - 600_000), // 10dk önce (en eski)
          updated_at: new Date(Date.now() - 200_000), // stale
          payload: { kind: 'kitchen' },
        })
        .execute();
      // Taze queued: DAHA YENİ created_at.
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: queuedId,
          tenant_id: TENANT_ID,
          status: 'queued',
          created_at: new Date(Date.now() - 1_000),
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await claim(2);
      expect(res.status).toBe(200);
      // ORDER BY (status='printing'), created_at → queued (false) daima önce,
      // stuck-printing eski olsa bile taze fişi açlığa düşürmez.
      expect(res.body.job.id).toBe(queuedId);
      expect(await dbStatus(stuckId)).toBe('printing'); // henüz reclaim edilmedi
    });

    it('result handler printing→failed → retry + retry_at gelecekte', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_ID,
          status: 'printing',
          attempts: 0,
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await request(ctx.app!)
        .post(`/print/v1/jobs/${jobId}/result`)
        .set('Authorization', `Bearer ${ctx.agentToken!}`)
        .send({ status: 'failed', errorText: 'printer offline' });
      expect(res.status).toBe(200);
      expect(res.body.job.status).toBe('retry');
      expect(res.body.job.attempts).toBe(1);

      const row = await ctx
        .db!.selectFrom('print_jobs')
        .select('retry_at')
        .where('id', '=', jobId)
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      expect(row.retry_at).not.toBeNull();
      const retryAtMs = new Date(row.retry_at as unknown as string).getTime();
      // attempts=1 → now+10s backoff; gelecekte ve makul aralıkta.
      expect(retryAtMs).toBeGreaterThan(Date.now());
      expect(retryAtMs).toBeLessThan(Date.now() + 30_000);
    });
  },
);
