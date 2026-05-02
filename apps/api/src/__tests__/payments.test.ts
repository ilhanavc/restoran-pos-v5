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
 * PR-7a (ADR-014) — POST /payments integration.
 *
 * Senaryolar:
 *  1. full scope + pay → 201, order.status='open' (kapatma yok)
 *  2. full scope + pay_and_close → 201, order.status='paid'
 *  3. idempotency replay → 2. POST aynı key → 200 + replay:true (yeni satır YOK)
 *  4. paymentScope='full' + operation='pay_and_close' default OK; ama
 *     operation='pay_and_close' + paymentScope='item' → 400 VALIDATION_ERROR
 *  5. comped item → scope='item' + comped order_item_id → 409 COMP_ITEM_IN_PAYMENT
 *  6. waiter rolü → 403 AUTH_FORBIDDEN (payments.create yetkisi yok)
 *  7. terminal order (paid) → 409 ORDER_INVARIANT_VIOLATED
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TABLE_ID = randomUUID();
const TABLE_CODE = `M-P-${randomUUID().slice(0, 6)}`;

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-pay-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-pay-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-pay-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-pay-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-pay-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-pay-${randomUUID().slice(0, 8)}`;

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

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function createOrderWithItems(
  app: Express,
  token: string,
  itemCount: number,
): Promise<{ orderId: string; itemIds: string[] }> {
  const items = Array(itemCount)
    .fill(null)
    .map(() => ({ productId: PRODUCT_ID, quantity: 1 }));
  const res = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId: TABLE_ID, orderType: 'dine_in', items });
  return {
    orderId: res.body.data.order.id as string,
    itemIds: (res.body.data.items as Array<{ id: string }>).map((i) => i.id),
  };
}

describe.skipIf(DB_URL === undefined)('POST /payments (PR-7a, ADR-014)', () => {
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
        name: 'Test Tenant Pay',
        slug: `t-pay-${TENANT_ID.slice(0, 8)}`,
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

    ctx.adminToken = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
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
    const db = ctx.db;
    if (db === undefined) return;
    await db
      .deleteFrom('payment_items')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
    await db
      .deleteFrom('order_item_attributes')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db
      .deleteFrom('order_items')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
    await db
      .deleteFrom('order_no_counters')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db
      .deleteFrom('products')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db
      .deleteFrom('categories')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
    await db
      .deleteFrom('refresh_tokens')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
    await db
      .deleteFrom('tenant_settings')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
    await db.destroy();
  });

  async function freeTable(): Promise<void> {
    await ctx.db!
      .deleteFrom('payment_items')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await ctx.db!
      .deleteFrom('payments')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await ctx.db!
      .deleteFrom('order_item_attributes')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await ctx.db!
      .deleteFrom('order_items')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
    await ctx.db!
      .deleteFrom('orders')
      .where('tenant_id', '=', TENANT_ID)
      .execute();
  }

  it('full scope + pay → 201, order kalır open', async () => {
    await freeTable();
    const { orderId } = await createOrderWithItems(ctx.app!, ctx.adminToken!, 2);
    const res = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send({
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRODUCT_PRICE * 2,
        idempotencyKey: randomUUID(),
        operation: 'pay',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.payment.amount_cents).toBe(PRODUCT_PRICE * 2);
    expect(res.body.data.payment.payment_scope).toBe('full');

    const order = await ctx.db!
      .selectFrom('orders')
      .select('status')
      .where('id', '=', orderId)
      .executeTakeFirstOrThrow();
    expect(order.status).toBe('open');
  });

  it('full + pay_and_close → 201, order.status=paid', async () => {
    await freeTable();
    const { orderId } = await createOrderWithItems(ctx.app!, ctx.adminToken!, 1);
    const res = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.adminToken!}`)
      .send({
        orderId,
        paymentType: 'card',
        paymentScope: 'full',
        amountCents: PRODUCT_PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay_and_close',
      });
    expect(res.status).toBe(201);
    const order = await ctx.db!
      .selectFrom('orders')
      .select('status')
      .where('id', '=', orderId)
      .executeTakeFirstOrThrow();
    expect(order.status).toBe('paid');
  });

  it('idempotency replay → aynı key 2. POST → 200 replay:true, tek satır', async () => {
    await freeTable();
    const { orderId } = await createOrderWithItems(ctx.app!, ctx.adminToken!, 1);
    const key = randomUUID();
    const body = {
      orderId,
      paymentType: 'cash' as const,
      paymentScope: 'full' as const,
      amountCents: PRODUCT_PRICE,
      idempotencyKey: key,
      operation: 'pay' as const,
    };
    const r1 = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send(body);
    expect(r1.status).toBe(201);
    const r2 = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send(body);
    expect(r2.status).toBe(200);
    expect(r2.body.data.replay).toBe(true);
    expect(r2.body.data.payment.id).toBe(r1.body.data.payment.id);

    const count = await ctx.db!
      .selectFrom('payments')
      .select((eb) => eb.fn.countAll().as('c'))
      .where('order_id', '=', orderId)
      .executeTakeFirstOrThrow();
    expect(Number(count.c)).toBe(1);
  });

  it('pay_and_close + scope=item → 400 VALIDATION_ERROR (closeRequiresFullScope)', async () => {
    await freeTable();
    const { orderId, itemIds } = await createOrderWithItems(
      ctx.app!,
      ctx.adminToken!,
      2,
    );
    const res = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send({
        orderId,
        paymentType: 'cash',
        paymentScope: 'item',
        amountCents: PRODUCT_PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay_and_close',
        orderItemIds: [itemIds[0]!],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('comped item → scope=item INSERT 409 COMP_ITEM_IN_PAYMENT (DB trigger)', async () => {
    await freeTable();
    const { orderId, itemIds } = await createOrderWithItems(
      ctx.app!,
      ctx.adminToken!,
      2,
    );
    await request(ctx.app!)
      .patch(`/orders/${orderId}/items/${itemIds[0]}`)
      .set('Authorization', `Bearer ${ctx.adminToken!}`)
      .send({ isComped: true });

    const res = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send({
        orderId,
        paymentType: 'cash',
        paymentScope: 'item',
        amountCents: PRODUCT_PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
        itemAllocations: [{ orderItemId: itemIds[0]!, quantity: 1 }],
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMP_ITEM_IN_PAYMENT');
  });

  it('partial-qty: tek order_item qty=1, 2 farklı payment her biri qty=1 yerine ikinci payment 409 PAYMENT_QTY_EXCEEDS_ORDER_ITEM', async () => {
    await freeTable();
    const { orderId, itemIds } = await createOrderWithItems(
      ctx.app!,
      ctx.adminToken!,
      1,
    );
    // İlk payment: qty=1 → OK (tüm qty kullanıldı)
    const r1 = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send({
        orderId,
        paymentType: 'cash',
        paymentScope: 'item',
        amountCents: PRODUCT_PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
        itemAllocations: [{ orderItemId: itemIds[0]!, quantity: 1 }],
      });
    expect(r1.status).toBe(201);
    // İkinci payment aynı kaleme: qty=1 daha → 409
    const r2 = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send({
        orderId,
        paymentType: 'cash',
        paymentScope: 'item',
        amountCents: PRODUCT_PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
        itemAllocations: [{ orderItemId: itemIds[0]!, quantity: 1 }],
      });
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('PAYMENT_QTY_EXCEEDS_ORDER_ITEM');
  });

  it('waiter rolü → 403 AUTH_FORBIDDEN', async () => {
    await freeTable();
    const { orderId } = await createOrderWithItems(ctx.app!, ctx.adminToken!, 1);
    const res = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.waiterToken!}`)
      .send({
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRODUCT_PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('terminal order (paid) → 409 ORDER_INVARIANT_VIOLATED', async () => {
    await freeTable();
    const { orderId } = await createOrderWithItems(ctx.app!, ctx.adminToken!, 1);
    // 1. ödeme close
    await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send({
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRODUCT_PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay_and_close',
      });
    // 2. ödeme aynı order'a → 409
    const res = await request(ctx.app!)
      .post('/payments')
      .set('Authorization', `Bearer ${ctx.cashierToken!}`)
      .send({
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRODUCT_PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_INVARIANT_VIOLATED');
  });
});
