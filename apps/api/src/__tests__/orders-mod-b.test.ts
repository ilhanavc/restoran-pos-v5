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
 * Sprint 13 — ADR-014 §10 Karar 10.4 ("Masayı Kapat" Mod B).
 *
 * PATCH /orders/:id { status: 'paid' } → repo.payOrder()
 *   - SUM(payments.amount_cents) >= orders.total_cents → status='paid' (200)
 *   - paid_total < total → 400 PAYMENT_INSUFFICIENT_FOR_CLOSE
 *   - order.status zaten 'paid'/'cancelled'/'void' → 409 ORDER_INVARIANT_VIOLATED
 *
 * Senaryolar:
 *   1. tam ödenmiş + Mod B → 200, order.status='paid'
 *   2. kısmi ödenmiş → 400 PAYMENT_INSUFFICIENT_FOR_CLOSE
 *   3. hiç ödeme yok → 400 PAYMENT_INSUFFICIENT_FOR_CLOSE
 *   4. waiter → 403 AUTH_FORBIDDEN (authorize ['admin','cashier'])
 *   5. zaten paid order + tekrar PATCH → 409 ORDER_INVARIANT_VIOLATED (idempotency guard)
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TABLE_ID = randomUUID();
const TABLE_CODE = `M-B-${randomUUID().slice(0, 6)}`;

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-modb-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-modb-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-modb-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-modb-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-modb-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-modb-${randomUUID().slice(0, 8)}`;

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 5000;
const ORDER_QTY = 2;
const ORDER_TOTAL = PRODUCT_PRICE * ORDER_QTY;

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
      items: [{ productId: PRODUCT_ID, quantity: ORDER_QTY }],
    });
  return res.body.data.order.id as string;
}

async function payAmount(
  app: Express,
  token: string,
  orderId: string,
  amountCents: number,
): Promise<request.Response> {
  return request(app)
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderId,
      paymentType: 'cash',
      paymentScope: 'full',
      amountCents,
      idempotencyKey: randomUUID(),
      operation: 'pay',
    });
}

describe.skipIf(DB_URL === undefined)(
  'PATCH /orders/:id paid (Mod B "Masayı Kapat", ADR-014 §10.4)',
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
          name: 'Test Tenant Mod B',
          slug: `t-modb-${TENANT_ID.slice(0, 8)}`,
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

    it('tam ödenmiş + Mod B → 200, order.status=paid', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      const payRes = await payAmount(ctx.app!, ctx.cashierToken!, orderId, ORDER_TOTAL);
      expect(payRes.status).toBe(201);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'paid' });
      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe('paid');
    });

    it('kısmi ödenmiş + Mod B → 400 PAYMENT_INSUFFICIENT_FOR_CLOSE', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      const payRes = await payAmount(
        ctx.app!,
        ctx.cashierToken!,
        orderId,
        Math.floor(ORDER_TOTAL / 2),
      );
      expect(payRes.status).toBe(201);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'paid' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_INSUFFICIENT_FOR_CLOSE');
    });

    it('hiç ödeme yok + Mod B → 400 PAYMENT_INSUFFICIENT_FOR_CLOSE', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'paid' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_INSUFFICIENT_FOR_CLOSE');
    });

    it('waiter rolü + Mod B → 403 AUTH_FORBIDDEN', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      await payAmount(ctx.app!, ctx.cashierToken!, orderId, ORDER_TOTAL);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ status: 'paid' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('zaten paid order + tekrar Mod B → 409 ORDER_INVARIANT_VIOLATED', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      await payAmount(ctx.app!, ctx.cashierToken!, orderId, ORDER_TOTAL);

      const first = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'paid' });
      expect(first.status).toBe(200);
      expect(first.body.data.order.status).toBe('paid');

      const second = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'paid' });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ORDER_INVARIANT_VIOLATED');
    });
  },
);
