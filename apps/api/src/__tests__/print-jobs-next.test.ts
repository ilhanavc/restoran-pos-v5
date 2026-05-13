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
 * ADR-004 Phase 3 PR-1 — GET /print/v1/jobs/next integration tests.
 *
 * Kapsam:
 *   1. queued job kuyrukta var → 200 + JobsNextResponse şeması +
 *      DB satırının status'u 'printing' olarak atomik güncellendi.
 *   2. queued job yok → wait süresi dolar → 204 No Content.
 *
 * NOT: Multi-tenant izolasyon, RBAC, retry/result callback, agent
 * register/refresh testleri Phase 4+'a aittir (scope kilidi).
 *
 * Test stratejisi: tenant başına izole UUID; afterAll yalnız bu
 * test'in tenant'ına ait satırları siler (paralel test çalıştırılırken
 * cross-tenant kirletme yok).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();
const TENANT_NAME = 'Test Tenant Print Agent';

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  agentToken: string;
}

const ctx: Partial<TestCtx> = {};

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'GET /print/v1/jobs/next (ADR-004 Phase 3 PR-1)',
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
          name: TENANT_NAME,
          slug: `test-print-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      // ADR-004 §Amendment 2 — Bearer JWT auth migration.
      // apiKey plaintext sadece test scope'unda; bcrypt hash (cost 12) DB'ye.
      // agents row INSERT, sonra `type='agent'` JWT sign → suite scope.
      const agentId = randomUUID();
      const apiKey = `pk_${TENANT_ID.replace(/-/g, '').slice(0, 8)}_test-fixture-key`;
      const apiKeyHash = await bcrypt.hash(apiKey, 12);
      await db
        .insertInto('agents')
        .values({
          id: agentId,
          tenant_id: TENANT_ID,
          device_fingerprint: `fp-jobs-next-${TENANT_ID.slice(0, 8)}`,
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
      // Her test başında kendi tenant'ının print_jobs satırlarını temizle —
      // testler arası state izolasyonu (queued job kalıntısı 204 testini
      // bozmasın).
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('print_jobs')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
      }
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('print_jobs')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', '=', TENANT_ID)
          .execute();
        await ctx.db.destroy();
      }
    });

    it('queued job kuyrukta varsa → 200 + job + DB status="printing" (atomik claim)', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_ID,
          status: 'queued',
          payload: { kind: 'kitchen', orderId: randomUUID() },
        })
        .execute();

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=2')
        .set('Authorization', `Bearer ${ctx.agentToken!}`);

      expect(res.status).toBe(200);
      expect(res.body.job).toBeDefined();
      expect(res.body.job.id).toBe(jobId);
      expect(res.body.job.tenantId).toBe(TENANT_ID);
      expect(res.body.job.status).toBe('printing');
      // ADR-004 Amendment 1 (PR-2): attempts artık PrintJob şemasında.
      // queued → printing transition'ında DEĞİŞMEZ — seed default 0.
      expect(res.body.job.attempts).toBe(0);
      expect(res.body.job.payload).toMatchObject({ kind: 'kitchen' });
      expect(typeof res.body.job.createdAt).toBe('string');
      expect(typeof res.body.job.updatedAt).toBe('string');

      // DB'de atomik transition gerçekten kaydedildi mi?
      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status'])
        .where('id', '=', jobId)
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirst();
      expect(row?.status).toBe('printing');
    });

    it('kuyrukta queued job yoksa → 204 No Content (wait süresi dolduktan sonra)', async () => {
      const start = Date.now();
      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=1')
        .set('Authorization', `Bearer ${ctx.agentToken!}`);
      const elapsedMs = Date.now() - start;

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      // En az ~1 saniye beklemiş olmalı (long-poll); üst sınır gevşek
      // (CI gürültüsü için 3sn).
      expect(elapsedMs).toBeGreaterThanOrEqual(900);
      expect(elapsedMs).toBeLessThan(3000);
    });
  },
);
