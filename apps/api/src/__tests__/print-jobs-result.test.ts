import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';

/**
 * ADR-004 Phase 3 PR-2 — POST /print/v1/jobs/:id/result integration tests.
 *
 * Kapsam (Amendment 1 state machine):
 *   1. printing + success → success, attempts DEĞİŞMEZ
 *   2. printing + failed (attempts<3) → retry, attempts+1
 *   3. printing + failed (attempts=2 → 3) → cancelled, attempts=3
 *   4. queued + result POST → 400 PRINT_JOB_NOT_IN_PRINTING_STATE
 *   5. terminal success + tekrar success POST → 200 idempotent no-op
 *   6. random UUID → 404 PRINT_JOB_NOT_FOUND
 *
 * NOT: retry → queued cron, audit log, manuel iptal Phase 4+'a aittir.
 * Bu testler yalnız state machine kontratını ve idempotency'i doğrular.
 *
 * Test stratejisi: tenant başına izole UUID; beforeEach print_jobs
 * cleanup; afterAll cascade cleanup + pool destroy. PR-1 test
 * pattern'i ile birebir aynı.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TENANT_NAME = 'Test Tenant Print Agent Result';

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
}

const ctx: Partial<TestCtx> = {};

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'POST /print/v1/jobs/:id/result (ADR-004 Phase 3 PR-2)',
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
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: TENANT_NAME,
          slug: `test-print-result-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
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

    it('printing + success → 200, status=success, attempts DEĞİŞMEZ', async () => {
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
        .set('X-Tenant-Id', TENANT_ID)
        .send({ status: 'success' });

      expect(res.status).toBe(200);
      expect(res.body.job).toBeDefined();
      expect(res.body.job.id).toBe(jobId);
      expect(res.body.job.status).toBe('success');
      expect(res.body.job.attempts).toBe(0);

      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(row?.status).toBe('success');
      expect(row?.attempts).toBe(0);
    });

    it('printing + failed (attempts=0) → 200, status=retry, attempts=1', async () => {
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
        .set('X-Tenant-Id', TENANT_ID)
        .send({ status: 'failed', errorText: 'Printer not responding' });

      expect(res.status).toBe(200);
      expect(res.body.job.status).toBe('retry');
      expect(res.body.job.attempts).toBe(1);

      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(row?.status).toBe('retry');
      expect(row?.attempts).toBe(1);
    });

    it('printing + failed (attempts=2 → 3) → 200, status=cancelled, attempts=3', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_ID,
          status: 'printing',
          attempts: 2,
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await request(ctx.app!)
        .post(`/print/v1/jobs/${jobId}/result`)
        .set('X-Tenant-Id', TENANT_ID)
        .send({ status: 'failed', errorText: 'Out of paper' });

      expect(res.status).toBe(200);
      expect(res.body.job.status).toBe('cancelled');
      expect(res.body.job.attempts).toBe(3);

      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(row?.status).toBe('cancelled');
      expect(row?.attempts).toBe(3);
    });

    it('queued + result POST → 400 PRINT_JOB_NOT_IN_PRINTING_STATE', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_ID,
          status: 'queued',
          attempts: 0,
          payload: { kind: 'kitchen' },
        })
        .execute();

      const res = await request(ctx.app!)
        .post(`/print/v1/jobs/${jobId}/result`)
        .set('X-Tenant-Id', TENANT_ID)
        .send({ status: 'success' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PRINT_JOB_NOT_IN_PRINTING_STATE');
      expect(res.body.error.message_key).toBe(
        'error.print.jobNotInPrintingState',
      );

      // DB durumu DEĞİŞMEMİŞ olmalı (atomik UPDATE guard'ı sayesinde).
      const row = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(row?.status).toBe('queued');
      expect(row?.attempts).toBe(0);
    });

    it('terminal success + tekrar success POST → 200 idempotent no-op (updated_at DEĞİŞMEZ)', async () => {
      const jobId = randomUUID();
      await ctx.db!
        .insertInto('print_jobs')
        .values({
          id: jobId,
          tenant_id: TENANT_ID,
          status: 'success',
          attempts: 0,
          payload: { kind: 'kitchen' },
        })
        .execute();

      // İlk halini oku (updated_at karşılaştırması için).
      const before = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts', 'updated_at'])
        .where('id', '=', jobId)
        .executeTakeFirst();

      const res = await request(ctx.app!)
        .post(`/print/v1/jobs/${jobId}/result`)
        .set('X-Tenant-Id', TENANT_ID)
        .send({ status: 'success' });

      expect(res.status).toBe(200);
      expect(res.body.job.status).toBe('success');
      expect(res.body.job.attempts).toBe(0);

      const after = await ctx.db!
        .selectFrom('print_jobs')
        .select(['status', 'attempts', 'updated_at'])
        .where('id', '=', jobId)
        .executeTakeFirst();
      expect(after?.status).toBe('success');
      expect(after?.attempts).toBe(0);
      // updated_at DEĞİŞMEMİŞ — atomik UPDATE 0 row affected, fallback
      // SELECT idempotent no-op olarak mevcut row'u döndürdü.
      expect(after?.updated_at.getTime()).toBe(before?.updated_at.getTime());
    });

    it('random UUID (yok) → 404 PRINT_JOB_NOT_FOUND', async () => {
      const randomJobId = randomUUID();
      const res = await request(ctx.app!)
        .post(`/print/v1/jobs/${randomJobId}/result`)
        .set('X-Tenant-Id', TENANT_ID)
        .send({ status: 'success' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRINT_JOB_NOT_FOUND');
      expect(res.body.error.message_key).toBe('error.print.jobNotFound');
    });
  },
);
