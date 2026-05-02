import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * PR-7-amend (ADR-014 §9 Karar 9.6) — PATCH /orders/:id { status: 'cancelled' }
 *
 * Senaryolar:
 *  1. admin cancel → 200, order.status='cancelled', order_items.status='cancelled', total_cents=0
 *  2. cashier cancel → 200 (admin/cashier yetkisi)
 *  3. waiter cancel → 403 AUTH_FORBIDDEN
 *  4. paid order cancel → 409 ORDER_CANCEL_NOT_ALLOWED
 *  5. cross-tenant order → 404 ORDER_NOT_FOUND
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TABLE_ID = randomUUID();
const TABLE_CODE = `M-C-${randomUUID().slice(0, 6)}`;

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-cancel-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-cancel-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-cancel-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-cancel-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-cancel-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-cancel-${randomUUID().slice(0, 8)}`;

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 5000;

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
  cashierToken?: string;
  waiterToken?: string;
}

async function login(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function createOrder(app: Express, token: string): Promise<string> {
  const res = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId: TABLE_ID,
      orderType: 'dine_in',
      items: [
        { productId: PRODUCT_ID, quantity: 2 },
      ],
    });
  return res.body.data.order.id as string;
}

describe.skipIf(DB_URL === undefined)(
  'PATCH /orders/:id cancel (PR-7-amend, ADR-014 §9.6)',
  () => {
    const ctx: Ctx = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
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
          name: 'Test Tenant Cancel',
          slug: `t-cancel-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
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

      await db
        .insertInto('tables')
        .values({
          id: TABLE_ID,
          tenant_id: TENANT_ID,
          code: TABLE_CODE,
          capacity: 4,
        })
        .execute();
      await db
        .insertInto('categories')
        .values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Yemekler' })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Test Ürün',
          price_cents: PRODUCT_PRICE,
          is_active: true,
        })
        .execute();

      ctx.adminToken = await login(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
      ctx.cashierToken = await login(ctx.app, CASHIER_EMAIL, CASHIER_PASSWORD);
      ctx.waiterToken = await login(ctx.app, WAITER_EMAIL, WAITER_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('payment_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await db.destroy();
    });

    async function freeTable(): Promise<void> {
      await ctx.db!.deleteFrom('payment_items').where('tenant_id', '=', TENANT_ID).execute();
      await ctx.db!.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
      await ctx.db!.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
      await ctx.db!.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await ctx.db!.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
    }

    it('admin cancel → 200, order + items cancelled, total_cents=0', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe('cancelled');
      expect(res.body.data.order.total_cents).toBe(0);
      for (const it of res.body.data.items) {
        expect(it.status).toBe('cancelled');
      }
    });

    it('cashier cancel → 200', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe('cancelled');
    });

    it('waiter cancel → 403 AUTH_FORBIDDEN', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('zaten cancelled order → 409 ORDER_CANCEL_NOT_ALLOWED', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      // 1. cancel
      await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      // 2. tekrar cancel
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_CANCEL_NOT_ALLOWED');
    });

    it('paid order cancel → 409 ORDER_CANCEL_NOT_ALLOWED', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      // pay_and_close → order.status='paid'
      await request(ctx.app!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: PRODUCT_PRICE * 2,
          idempotencyKey: randomUUID(),
          operation: 'pay_and_close',
        });
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_CANCEL_NOT_ALLOWED');
    });
  },
);
