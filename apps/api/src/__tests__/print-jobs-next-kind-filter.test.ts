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
 * ADR-032 — GET /print/v1/jobs/next?kind= iş-türü filtresi (ikincil yazıcı
 * yönlendirmesi). Design B: claim-anında `payload.kind` filtresi, migration yok.
 *
 * Kritik güvence: filtre status-OR bloğunun DIŞINDA AND ile → ÜÇ claim dalını
 * da (queued / retry / printing-stale reclaim) kapsar. Kasa agent'ı (kind=bill)
 * bir MUTFAK job'unu ne yeni claim edebilir ne de stale iken reclaim edebilir
 * (en tehlikeli cross-role yanlış-basım senaryosu).
 *
 * Backdate tekniği print-jobs-resilience.test.ts ile aynı: INSERT'te updated_at
 * geçmişe set edilir (set_updated_at trigger'ı BEFORE UPDATE, INSERT'i etkilemez).
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
  'GET /print/v1/jobs/next?kind= — iş-türü filtresi (ADR-032)',
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
          name: 'Test Tenant Kind Filter',
          slug: `test-kind-${TENANT_ID.slice(0, 8)}`,
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
          device_fingerprint: `fp-kind-${TENANT_ID.slice(0, 8)}`,
          api_key_hash: apiKeyHash,
        })
        .execute();
      ctx.agentToken = jwt.sign(
        { type: 'agent', tid: TENANT_ID },
        AGENT_SECRET,
        {
          algorithm: 'HS256',
          expiresIn: '1h',
          subject: agentId,
          jwtid: randomUUID(),
        },
      );
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

    /** `?wait=N` + tekrarlı `?kind=` param (kinds verilmezse filtre yok). */
    function claim(waitSeconds: number, kinds?: string[]): request.Test {
      const params = new URLSearchParams({ wait: waitSeconds.toString() });
      for (const k of kinds ?? []) params.append('kind', k);
      return request(ctx.app!)
        .get(`/print/v1/jobs/next?${params.toString()}`)
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

    async function insertJob(
      kind: 'kitchen' | 'bill',
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_ID,
          status: 'queued',
          payload: { kind },
          ...overrides,
        })
        .execute();
      return jobId;
    }

    // (a) queued dalı: kind=bill agent, kitchen job'u ALMAZ; kitchen queued kalır.
    it('kind=bill agent, queued kitchen job → 204; kitchen job "queued" kalır', async () => {
      const kitchenId = await insertJob('kitchen');
      const res = await claim(1, ['bill']);
      expect(res.status).toBe(204);
      expect(await dbStatus(kitchenId)).toBe('queued');
    });

    // (a+) pozitif: kind=bill agent kendi türünü claim eder.
    it('kind=bill agent, queued bill job → 200 (kendi türünü claim eder)', async () => {
      const billId = await insertJob('bill');
      const res = await claim(2, ['bill']);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(billId);
      expect(res.body.job.status).toBe('printing');
      expect(res.body.job.payload).toMatchObject({ kind: 'bill' });
    });

    // (c) geriye dönük: filtre yok → tüm türleri claim eder (mevcut bootstrap agent).
    it("kind param yok → queued kitchen job'u claim eder (backward-compat)", async () => {
      const kitchenId = await insertJob('kitchen');
      const res = await claim(2);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(kitchenId);
    });

    // (b) reclaim dalı (EN KRİTİK): kind=bill agent, stale printing kitchen'ı
    // RECLAIM ETMEZ → cross-role yanlış-basım kapalı.
    it('kind=bill agent, stale printing kitchen (>90s) → 204; RECLAIM ETMEZ', async () => {
      const kitchenId = await insertJob('kitchen', {
        status: 'printing',
        attempts: 1,
        updated_at: new Date(Date.now() - 200_000), // 200s stale (>90s eşiği)
      });
      const res = await claim(1, ['bill']);
      expect(res.status).toBe(204);
      expect(await dbStatus(kitchenId)).toBe('printing'); // reclaim edilmedi
    });

    // (b+) pozitif reclaim: kitchen agent kendi stale printing kitchen'ını reclaim eder.
    it('kind=kitchen agent, stale printing kitchen (>90s) → 200 (reclaim)', async () => {
      const kitchenId = await insertJob('kitchen', {
        status: 'printing',
        attempts: 1,
        updated_at: new Date(Date.now() - 200_000),
      });
      const res = await claim(2, ['kitchen']);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(kitchenId);
      expect(res.body.job.attempts).toBe(1); // reclaim attempts'ı bumplamaz
    });

    // (d) retry dalı: retry-hazır kitchen yalnız kitchen agent'a; bill agent almaz.
    it('retry-hazır kitchen: kind=kitchen → 200, kind=bill → 204', async () => {
      const kitchenId = await insertJob('kitchen', {
        status: 'retry',
        attempts: 1,
        retry_at: new Date(Date.now() - 5_000), // backoff geçti
      });

      const billRes = await claim(1, ['bill']);
      expect(billRes.status).toBe(204);
      expect(await dbStatus(kitchenId)).toBe('retry'); // bill agent dokunmadı

      const kitchenRes = await claim(2, ['kitchen']);
      expect(kitchenRes.status).toBe(200);
      expect(kitchenRes.body.job.id).toBe(kitchenId);
      expect(kitchenRes.body.job.status).toBe('printing');
    });

    // Çoklu kind: ?kind=kitchen&kind=bill → her iki türü de claim eder.
    it("çoklu kind (kitchen+bill) → queued kitchen job'u claim eder", async () => {
      const kitchenId = await insertJob('kitchen');
      const res = await claim(2, ['kitchen', 'bill']);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(kitchenId);
    });

    // (e) geçersiz kind → 400 VALIDATION_ERROR (long-poll'a girmeden).
    it('geçersiz ?kind=foo → 400 VALIDATION_ERROR', async () => {
      await insertJob('kitchen');
      const res = await claim(1, ['foo']);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });
  },
);
