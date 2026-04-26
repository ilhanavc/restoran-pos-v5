import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  createPool,
  createKysely,
  type DB,
} from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;
const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-${randomUUID()}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-${randomUUID().slice(0, 8)}`;
const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-${randomUUID()}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-${randomUUID().slice(0, 8)}`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  waiterToken: string;
}

const ctx: Partial<TestCtx> = {};

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'POST /tables integration',
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
          name: 'Test Tenant Tables',
          slug: `test-tables-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      const cashierHash = await hashPassword(CASHIER_PASSWORD);
      const waiterHash = await hashPassword(WAITER_PASSWORD);

      await db
        .insertInto('users')
        .values([
          {
            id: ADMIN_ID,
            tenant_id: TENANT_ID,
            email: ADMIN_EMAIL,
            username: ADMIN_USERNAME,
            password_hash: adminHash,
            role: 'admin',
          },
          {
            id: CASHIER_ID,
            tenant_id: TENANT_ID,
            email: CASHIER_EMAIL,
            username: CASHIER_USERNAME,
            password_hash: cashierHash,
            role: 'cashier',
          },
          {
            id: WAITER_ID,
            tenant_id: TENANT_ID,
            email: WAITER_EMAIL,
            username: WAITER_USERNAME,
            password_hash: waiterHash,
            role: 'waiter',
          },
        ])
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
      ctx.cashierToken = await loginAndGetToken(
        ctx.app,
        CASHIER_EMAIL,
        CASHIER_PASSWORD,
      );
      ctx.waiterToken = await loginAndGetToken(
        ctx.app,
        WAITER_EMAIL,
        WAITER_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('orders')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tables')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('users')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', '=', TENANT_ID)
          .execute();
        await ctx.db.destroy();
      }
    });

    it('admin → 201, body.data.table.code matches request', async () => {
      const code = `M-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code, capacity: 4 });
      expect(res.status).toBe(201);
      expect(res.body.data.table.code).toBe(code);
      expect(res.body.data.table.capacity).toBe(4);
      expect(res.body.data.table.tenant_id).toBe(TENANT_ID);
      expect(res.body.data.table.status).toBe('available');
    });

    it('cashier → 403 AUTH_FORBIDDEN', async () => {
      const code = `M-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ code });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('no auth → 401 AUTH_TOKEN_INVALID', async () => {
      const code = `M-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!).post('/tables').send({ code });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('duplicate code → 409 TABLE_ALREADY_EXISTS', async () => {
      const code = `M-DUP-${randomUUID().slice(0, 6)}`;
      const first = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code });
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('TABLE_ALREADY_EXISTS');
    });

    it('empty code → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET admin → 200, body.data.tables array', async () => {
      const res = await request(ctx.app!)
        .get('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.tables)).toBe(true);
    });

    it('GET waiter → 200 (4 rol erişebilir)', async () => {
      const res = await request(ctx.app!)
        .get('/tables')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.tables)).toBe(true);
    });

    it('GET no auth → 401 AUTH_TOKEN_INVALID', async () => {
      const res = await request(ctx.app!).get('/tables');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('GET ?status=available → 200, her item status === available', async () => {
      const res = await request(ctx.app!)
        .get('/tables?status=available')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.tables)).toBe(true);
      for (const t of res.body.data.tables) {
        expect(t.status).toBe('available');
      }
    });

    it('GET ?status=invalid → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.app!)
        .get('/tables?status=zombie')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  },
);
