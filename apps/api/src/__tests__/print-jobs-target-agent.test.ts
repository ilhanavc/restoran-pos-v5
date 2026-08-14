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
 * ADR-032 Amendment 4 — `print_jobs.target_agent_id` claim regresyonu (K1.3).
 *
 * Sistemin EN SICAK yolu değişti: yanlış yazılmış tek bir parantez ya hedefli
 * işi hiç çektirmez ya da hedefli işi YANLIŞ agent'a verir. Bu dosya yüklemin
 * beş davranışını kilitler:
 *   (a) hedefli iş yalnız hedefi tarafından çekilir (aynı kind'ı beyan eden
 *       başka agent ÇEKEMEZ),
 *   (b) hedef, kind filtresini EZER (grill beyan eden agent kendisine
 *       hedeflenmiş `bill` işini çeker) — S1'in can damarı,
 *   (c) `target_agent_id IS NULL` işler bugünkü kind filtresiyle BİT-BİT aynı
 *       davranır (mutfak istasyon regresyonu dahil),
 *   (d) hedefli STALE `printing` iş yalnız kendi hedefi tarafından reclaim
 *       edilir (başka agent "kurtaramaz"),
 *   (e) agent kimliği olmadan hedefli iş ASLA dönmez (güvenlik yüklemi).
 *
 * Fixture deseni print-jobs-next-kind-filter.test.ts ile aynı: agent JWT
 * doğrudan imzalanır; backdate INSERT'te updated_at ile yapılır (set_updated_at
 * trigger'ı BEFORE UPDATE'tir, INSERT'i etkilemez).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();
const AGENT_A_ID = randomUUID();
const AGENT_B_ID = randomUUID();

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  tokenA: string;
  tokenB: string;
}

const ctx: Partial<TestCtx> = {};

function agentToken(agentId: string): string {
  return jwt.sign({ type: 'agent', tid: TENANT_ID }, AGENT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
    subject: agentId,
    jwtid: randomUUID(),
  });
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-032 Amd4 — hedefli print job claim yüklemi (target_agent_id)',
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
          name: 'Test Tenant Target Agent',
          slug: `test-target-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const apiKeyHash = await bcrypt.hash('pk_test_target_agent_fixture', 12);
      await db
        .insertInto('agents')
        .values([
          {
            id: AGENT_A_ID,
            tenant_id: TENANT_ID,
            device_fingerprint: `fp-a-${TENANT_ID.slice(0, 8)}`,
            api_key_hash: apiKeyHash,
          },
          {
            id: AGENT_B_ID,
            tenant_id: TENANT_ID,
            device_fingerprint: `fp-b-${TENANT_ID.slice(0, 8)}`,
            api_key_hash: apiKeyHash,
          },
        ])
        .execute();

      ctx.tokenA = agentToken(AGENT_A_ID);
      ctx.tokenB = agentToken(AGENT_B_ID);
    });

    beforeEach(async () => {
      await ctx
        .db!.deleteFrom('print_jobs')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('agents').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await db.destroy();
    });

    /** Agent-JWT ile claim (token yoksa kimliksiz çağrı → e senaryosu). */
    function claim(
      token: string | null,
      waitSeconds: number,
      kinds?: string[],
    ): request.Test {
      const params = new URLSearchParams({ wait: waitSeconds.toString() });
      for (const k of kinds ?? []) params.append('kind', k);
      const req = request(ctx.app!).get(`/print/v1/jobs/next?${params.toString()}`);
      return token === null
        ? req.set('X-Tenant-Id', TENANT_ID)
        : req.set('Authorization', `Bearer ${token}`);
    }

    async function insertJob(
      kind: string,
      targetAgentId: string | null,
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
          target_agent_id: targetAgentId,
          ...overrides,
        })
        .execute();
      return jobId;
    }

    async function dbStatus(jobId: string): Promise<string | undefined> {
      const row = await ctx
        .db!.selectFrom('print_jobs')
        .select('status')
        .where('id', '=', jobId)
        .executeTakeFirst();
      return row?.status;
    }

    // (a) Hedefli iş yalnız hedefine gider — aynı kind'ı beyan eden B ÇEKEMEZ.
    it('(a) target=A olan bill işi: B çekemez (204), A çeker (200)', async () => {
      const jobId = await insertJob('bill', AGENT_A_ID);

      const resB = await claim(ctx.tokenB!, 1, ['bill']);
      expect(resB.status).toBe(204);
      expect(await dbStatus(jobId)).toBe('queued');

      const resA = await claim(ctx.tokenA!, 2, ['bill']);
      expect(resA.status).toBe(200);
      expect(resA.body.job.id).toBe(jobId);
      expect(resA.body.job.status).toBe('printing');
    });

    // (b) S1'in can damarı: açık hedef, `?kind=` filtresini EZER.
    it("(b) target=A + kind='bill' iş, A grill beyan etse BİLE çekilir", async () => {
      const jobId = await insertJob('bill', AGENT_A_ID);

      const res = await claim(ctx.tokenA!, 2, ['grill']);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(jobId);
      expect(res.body.job.payload).toMatchObject({ kind: 'bill' });
    });

    // (b-) Ters yön: hedefsiz bill işi, grill beyan eden agent'a GİTMEZ
    //      (kind filtresi hedefsiz dalda aynen yaşamaya devam eder).
    it('(b-) hedefsiz bill işi, grill beyan eden agent tarafından çekilmez', async () => {
      const jobId = await insertJob('bill', null);
      const res = await claim(ctx.tokenA!, 1, ['grill']);
      expect(res.status).toBe(204);
      expect(await dbStatus(jobId)).toBe('queued');
    });

    // (c) Hedefsiz işler bugünkü davranışın BİT-BİT aynısı — mutfak istasyon
    //     yönlendirmesi regresyonu (Amd1 hiç değişmedi).
    it('(c) hedefsiz mutfak işleri: kind eşleşirse çekilir, eşleşmezse çekilmez', async () => {
      const firinId = await insertJob('kitchen', null);
      const izgaraId = await insertJob('grill', null);

      // Fırın agent'ı yalnız kendi istasyonunu alır.
      const res1 = await claim(ctx.tokenA!, 2, ['kitchen']);
      expect(res1.status).toBe(200);
      expect(res1.body.job.id).toBe(firinId);
      expect(await dbStatus(izgaraId)).toBe('queued');

      // Izgara agent'ı (B) kendi istasyonunu alır.
      const res2 = await claim(ctx.tokenB!, 2, ['grill']);
      expect(res2.status).toBe(200);
      expect(res2.body.job.id).toBe(izgaraId);
    });

    it('(c-) hedefsiz iş, filtre verilmeyen agent tarafından çekilir (backward-compat)', async () => {
      const jobId = await insertJob('kitchen', null);
      const res = await claim(ctx.tokenA!, 2);
      expect(res.status).toBe(200);
      expect(res.body.job.id).toBe(jobId);
    });

    // (d) Hedefli STALE printing iş: yalnız kendi hedefi reclaim eder.
    it('(d) target=A stale printing iş: B reclaim EDEMEZ, A reclaim eder', async () => {
      const jobId = await insertJob('bill', AGENT_A_ID, {
        status: 'printing',
        attempts: 1,
        updated_at: new Date(Date.now() - 200_000), // >90 sn stale
      });

      const resB = await claim(ctx.tokenB!, 1, ['bill']);
      expect(resB.status).toBe(204);
      expect(await dbStatus(jobId)).toBe('printing'); // B kurtaramaz

      const resA = await claim(ctx.tokenA!, 2, ['bill']);
      expect(resA.status).toBe(200);
      expect(resA.body.job.id).toBe(jobId);
      expect(resA.body.job.attempts).toBe(1); // reclaim attempts'ı bumplamaz
    });

    // (d-) retry dalı: hedefli retry-hazır iş de yalnız hedefine gider.
    it('(d-) target=A retry-hazır iş: B çekemez, A çeker', async () => {
      const jobId = await insertJob('bill', AGENT_A_ID, {
        status: 'retry',
        attempts: 1,
        retry_at: new Date(Date.now() - 5_000),
      });

      const resB = await claim(ctx.tokenB!, 1, ['bill']);
      expect(resB.status).toBe(204);
      expect(await dbStatus(jobId)).toBe('retry');

      const resA = await claim(ctx.tokenA!, 2, ['bill']);
      expect(resA.status).toBe(200);
      expect(resA.body.job.id).toBe(jobId);
    });

    // (e) Güvenlik yüklemi: agent kimliği yoksa hedefli iş ASLA dönmez.
    it('(e) agent kimliği olmayan çağrı hedefli işi almaz (hedefsiz işi alır)', async () => {
      const targetedId = await insertJob('bill', AGENT_A_ID);

      const res1 = await claim(null, 1, ['bill']);
      // Kimliksiz çağrı ya reddedilir (401) ya da yalnız hedefsiz iş görür;
      // her iki halde de hedefli iş DOKUNULMAZ kalmalıdır.
      expect(res1.status).not.toBe(200);
      expect(await dbStatus(targetedId)).toBe('queued');
    });
  },
);
