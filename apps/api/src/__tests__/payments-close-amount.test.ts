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
 * ADR-014 §12 — `/payments *_close` tutar doğrulaması (correctness bug fix).
 *
 * `closeOrder=true` (operation=pay_and_close / pay_and_print_close) bir adisyonu
 * `paid`'e kapatırken `canCloseOrder` invariant'ını uygular:
 *   SUM(payments.amount_cents) === payable (= orders.total_cents, comp dışlanmış).
 *   underpaid (<) → 400 PAYMENT_INSUFFICIENT_FOR_CLOSE
 *   overpaid  (>) → 400 PAYMENT_EXCEEDS_TOTAL
 * İhlalde tüm transaction rollback (INSERT'ler dahil) → order 'open' kalır,
 * payment satırı yazılmaz, idempotency satırı oluşmaz (retry temiz).
 *
 * Senaryolar:
 *   1. underpaid close reddi → 400 + rollback (order open, payment yok)
 *   2. overpaid close reddi → 400 + rollback
 *   3. exact-match close → 201, order paid, SUM=payable
 *   4. partial (pay) sonra exact close (pay_and_close) → birikim ile 201
 *   5. idempotency replay → 200 replay, çift kapatma/çift satır yok
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TABLE_ID = randomUUID();
const TABLE_CODE = `M-CA-${randomUUID().slice(0, 6)}`;

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-closeamt-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-closeamt-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-closeamt-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-closeamt-${randomUUID().slice(0, 8)}`;

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 5000;
const ORDER_QTY = 2;
const ORDER_TOTAL = PRODUCT_PRICE * ORDER_QTY; // 10000

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
  cashierToken?: string;
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

async function pay(
  app: Express,
  token: string,
  orderId: string,
  amountCents: number,
  operation: 'pay' | 'pay_and_close',
  idempotencyKey: string = randomUUID(),
): Promise<request.Response> {
  return request(app)
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderId,
      paymentType: 'cash',
      paymentScope: 'full',
      amountCents,
      idempotencyKey,
      operation,
    });
}

describe.skipIf(DB_URL === undefined)(
  'POST /payments *_close tutar doğrulaması (ADR-014 §12)',
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
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant Close Amount',
          slug: `t-closeamt-${TENANT_ID.slice(0, 8)}`,
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
        ])
        .execute();

      await db
        .insertInto('tables')
        .values({ id: TABLE_ID, tenant_id: TENANT_ID, code: TABLE_CODE, capacity: 4 })
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

    async function orderStatus(orderId: string): Promise<string> {
      const row = await ctx
        .db!.selectFrom('orders')
        .select('status')
        .where('id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      return row.status;
    }

    async function paymentCount(orderId: string): Promise<number> {
      const rows = await ctx
        .db!.selectFrom('payments')
        .select('id')
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      return rows.length;
    }

    it('underpaid pay_and_close → 400 PAYMENT_INSUFFICIENT_FOR_CLOSE + rollback', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);

      const res = await pay(
        ctx.app!,
        ctx.cashierToken!,
        orderId,
        Math.floor(ORDER_TOTAL / 2), // 5000 < 10000
        'pay_and_close',
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_INSUFFICIENT_FOR_CLOSE');

      // Rollback: order open kalır, payment satırı yazılmaz.
      expect(await orderStatus(orderId)).toBe('open');
      expect(await paymentCount(orderId)).toBe(0);
    });

    it('overpaid pay_and_close → 400 PAYMENT_EXCEEDS_TOTAL + rollback', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);

      const res = await pay(
        ctx.app!,
        ctx.cashierToken!,
        orderId,
        ORDER_TOTAL + 5000, // 15000 > 10000
        'pay_and_close',
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_EXCEEDS_TOTAL');

      expect(await orderStatus(orderId)).toBe('open');
      expect(await paymentCount(orderId)).toBe(0);
    });

    it('exact-match pay_and_close → 201, order paid', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);

      const res = await pay(ctx.app!, ctx.cashierToken!, orderId, ORDER_TOTAL, 'pay_and_close');
      expect(res.status).toBe(201);

      expect(await orderStatus(orderId)).toBe('paid');
      expect(await paymentCount(orderId)).toBe(1);
    });

    it('partial pay sonra exact pay_and_close → birikim ile 201 paid', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);

      // 1. partial (close değil) — order açık kalmalı
      const partial = await pay(ctx.app!, ctx.cashierToken!, orderId, 4000, 'pay');
      expect(partial.status).toBe(201);
      expect(await orderStatus(orderId)).toBe('open');

      // 2. kalanı öde + kapat → SUM = 4000 + 6000 = 10000 = payable
      const close = await pay(ctx.app!, ctx.cashierToken!, orderId, 6000, 'pay_and_close');
      expect(close.status).toBe(201);
      expect(await orderStatus(orderId)).toBe('paid');
      expect(await paymentCount(orderId)).toBe(2);
    });

    it('idempotency replay → 200 replay, çift kapatma yok', async () => {
      await freeTable();
      const orderId = await createOrder(ctx.app!, ctx.adminToken!);
      const key = randomUUID();

      const first = await pay(ctx.app!, ctx.cashierToken!, orderId, ORDER_TOTAL, 'pay_and_close', key);
      expect(first.status).toBe(201);
      expect(await orderStatus(orderId)).toBe('paid');

      const replay = await pay(ctx.app!, ctx.cashierToken!, orderId, ORDER_TOTAL, 'pay_and_close', key);
      expect(replay.status).toBe(200);
      expect(replay.body.data.replay).toBe(true);

      // Çift satır / çift kapatma yok.
      expect(await orderStatus(orderId)).toBe('paid');
      expect(await paymentCount(orderId)).toBe(1);
    });
  },
);
