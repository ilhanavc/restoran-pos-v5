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
 * Blok 6 Hat C — print-jobs.ts derin denetim (R6-PJ-*).
 *
 * Devir doğrulaması:
 *   - Blok 4 (print-agent-auth): requireAgentJwt middleware auth backbone'u
 *     zaten test edildi (register/refresh/revoke). Burada EKSİK olan:
 *     requireAgentJwt'nin KENDİSİ /jobs/next route'unda revoked-agent
 *     senaryosunu hiç görmemiş (yalnız /agent/refresh route'un kendi ayrı
 *     revoked-check kodu test edilmiş) — R6-PJ-05 bu boşluğu kapatır.
 *   - Blok 3 (039 retry_at, 036 attempts): result callback state machine
 *     temel case'leri (print-jobs-result.test.ts) zaten yeşil. Burada EKSİK
 *     olan: `retry` / `cancelled` durumundaki bir job'a TEKRAR result POST
 *     edilirse (queued dışı, printing dışı ara-durumlar) ne oluyor —
 *     R6-PJ-03/04 bu boşluğu kapatır.
 *
 * Ana soru (AVLA): "yetkisiz/farklı-tenant agent job çekebiliyor mu?"
 * requireAgentJwt DB lookup'ı `WHERE id=$sub AND tenant_id=$tid` ile JWT
 * `tid` claim'inden tenant'ı belirler (header'dan DEĞİL) — bu yüzden cross-
 * tenant testi «Tenant B'nin GERÇEK agent JWT'si Tenant A job'una ulaşabiliyor
 * mu» sorusunu sorar (header-spoofing değil, çünkü header zaten kullanılmıyor).
 *
 * Tek `buildApp()` yeterli: printJobsRouter `deps.tenantId` KULLANMAZ,
 * tenant tamamen agent JWT `tid` claim'inden gelir (agent-auth.test.ts ile
 * aynı desen).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_A_ID = randomUUID();
const TENANT_B_ID = randomUUID();

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  tokenA: string;
  tokenB: string;
  agentAId: string;
}

const ctx: Partial<TestCtx> = {};

async function insertAgent(
  db: Kysely<DB>,
  tenantId: string,
  fingerprint: string,
): Promise<{ agentId: string; token: string }> {
  const agentId = randomUUID();
  const apiKey = `pk_${tenantId.replace(/-/g, '').slice(0, 8)}_${fingerprint}`;
  const apiKeyHash = await bcrypt.hash(apiKey, 12);
  await db
    .insertInto('agents')
    .values({
      id: agentId,
      tenant_id: tenantId,
      device_fingerprint: fingerprint,
      api_key_hash: apiKeyHash,
    })
    .execute();
  const token = jwt.sign({ type: 'agent', tid: tenantId }, AGENT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
    subject: agentId,
    jwtid: randomUUID(),
  });
  return { agentId, token };
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'print-jobs.ts derin denetim (Blok 6 Hat C, R6-PJ-*)',
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
        tenantId: TENANT_A_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_A_ID,
            name: 'R6-PJ Tenant A',
            slug: `r6-pj-a-${TENANT_A_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'R6-PJ Tenant B',
            slug: `r6-pj-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const agentA = await insertAgent(db, TENANT_A_ID, `fp-a-${TENANT_A_ID.slice(0, 8)}`);
      const agentB = await insertAgent(db, TENANT_B_ID, `fp-b-${TENANT_B_ID.slice(0, 8)}`);
      ctx.tokenA = agentA.token;
      ctx.agentAId = agentA.agentId;
      ctx.tokenB = agentB.token;
    });

    beforeEach(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('print_jobs')
          .where('tenant_id', 'in', [TENANT_A_ID, TENANT_B_ID])
          .execute();
      }
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('print_jobs')
          .where('tenant_id', 'in', [TENANT_A_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('agents')
          .where('tenant_id', 'in', [TENANT_A_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', 'in', [TENANT_A_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', 'in', [TENANT_A_ID, TENANT_B_ID])
          .execute();
        await ctx.db.destroy();
      }
    });

    // ── R6-PJ-01 — SEC: cross-tenant claim izolasyonu (GET /jobs/next) ──────
    it('R6-PJ-01: Tenant B agent JWT Tenant A queued job\'una GET /jobs/next ile ulaşamaz → 204, DB job "queued" kalır', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_A_ID,
          status: 'queued',
          payload: { kind: 'kitchen', orderId: randomUUID() },
        })
        .execute();

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=1')
        .set('Authorization', `Bearer ${ctx.tokenB!}`);

      expect(res.status).toBe(204);

      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'tenant_id'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(row?.status).toBe('queued');
      expect(row?.tenant_id).toBe(TENANT_A_ID);
    });

    // ── R6-PJ-02 — SEC: cross-tenant result POST izolasyonu ─────────────────
    it('R6-PJ-02: Tenant B agent JWT Tenant A job id\'sine POST /jobs/:id/result → 404 PRINT_JOB_NOT_FOUND, DB job değişmez', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_A_ID,
          status: 'printing',
          attempts: 0,
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await request(ctx.app!)
        .post(`/print/v1/jobs/${jobId}/result`)
        .set('Authorization', `Bearer ${ctx.tokenB!}`)
        .send({ status: 'success' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRINT_JOB_NOT_FOUND');

      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(row?.status).toBe('printing');
      expect(row?.attempts).toBe(0);
    });

    // ── R6-PJ-03 — BUG/ROB: state machine — retry durumuna result POST ──────
    it('R6-PJ-03: status="retry" job\'a result POST → 400 PRINT_JOB_NOT_IN_PRINTING_STATE (geçersiz geçiş reddi)', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_A_ID,
          status: 'retry',
          attempts: 1,
          retry_at: new Date(Date.now() + 10_000),
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await request(ctx.app!)
        .post(`/print/v1/jobs/${jobId}/result`)
        .set('Authorization', `Bearer ${ctx.tokenA!}`)
        .send({ status: 'success' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PRINT_JOB_NOT_IN_PRINTING_STATE');

      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(row?.status).toBe('retry');
      expect(row?.attempts).toBe(1);
    });

    // ── R6-PJ-04 — BUG/ROB: state machine — cancelled + success (mismatch) ──
    it('R6-PJ-04: status="cancelled" job\'a status="success" POST → 400 (cancelled yalnız "failed" ile idempotent, "success" değil)', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_A_ID,
          status: 'cancelled',
          attempts: 3,
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await request(ctx.app!)
        .post(`/print/v1/jobs/${jobId}/result`)
        .set('Authorization', `Bearer ${ctx.tokenA!}`)
        .send({ status: 'success' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PRINT_JOB_NOT_IN_PRINTING_STATE');

      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(row?.status).toBe('cancelled');
      expect(row?.attempts).toBe(3);
    });

    // ── R6-PJ-05 — SEC: requireAgentJwt revoked-agent (route seviyesi) ──────
    it('R6-PJ-05: revoked agent (requireAgentJwt route-level) GET /jobs/next → 401 AGENT_REVOKED', async () => {
      const revoked = await insertAgent(
        ctx.db!,
        TENANT_A_ID,
        `fp-revoked-${randomUUID()}`,
      );
      await ctx.db!
        .updateTable('agents')
        .set({ revoked_at: new Date(), revoke_reason: 'R6-PJ-05 test' })
        .where('id', '=', revoked.agentId)
        .execute();

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=0')
        .set('Authorization', `Bearer ${revoked.token}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AGENT_REVOKED');
    });

    // ── R6-PJ-06 — regression: Authorization header eksik ───────────────────
    it('R6-PJ-06: Authorization header yok → 401 AUTH_TOKEN_MISSING (route hiç DB\'ye dokunmaz)', async () => {
      const res = await request(ctx.app!).get('/print/v1/jobs/next?wait=0');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_MISSING');
    });

    // ── R6-PJ-07 — ROB: flood/kapasite — eşzamanlı claim'de duplicate yok ───
    it('R6-PJ-07: 6 queued job + 9 eşzamanlı GET /jobs/next → tam 6 farklı job claim edilir, duplicate/kayıp yok (SKIP LOCKED doğrulaması)', async () => {
      const jobIds = Array.from({ length: 6 }, () => randomUUID());
      await ctx.db!
        .insertInto('print_jobs')
        .values(
          jobIds.map((id) => ({
            id,
            tenant_id: TENANT_A_ID,
            status: 'queued' as const,
            payload: { kind: 'kitchen', orderId: randomUUID() },
          })),
        )
        .execute();

      const requests = Array.from({ length: 9 }, () =>
        request(ctx.app!)
          .get('/print/v1/jobs/next?wait=0')
          .set('Authorization', `Bearer ${ctx.tokenA!}`),
      );
      const results = await Promise.all(requests);

      const claimed = results.filter((r) => r.status === 200);
      const empty = results.filter((r) => r.status === 204);
      expect(claimed.length).toBe(6);
      expect(empty.length).toBe(3);

      const claimedIds = claimed.map((r) => r.body.job.id as string);
      const uniqueIds = new Set(claimedIds);
      expect(uniqueIds.size).toBe(6); // hiçbir job iki kez claim edilmedi
      for (const id of jobIds) {
        expect(uniqueIds.has(id)).toBe(true); // hepsi claim edildi (kayıp yok)
      }

      const rows = await ctx.db!
        .selectFrom('print_jobs')
        .select(['id', 'status'])
        .where('tenant_id', '=', TENANT_A_ID)
        .execute();
      expect(rows.every((r) => r.status === 'printing')).toBe(true);
    });
  },
);
