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
 * ADR-015 — Reports endpoints integration tests.
 *
 * Senaryolar:
 *   1. /reports/kpi/today-revenue — happy path (1 ödeme bugün → toplam doğru)
 *   2. /reports/kpi/order-count — status breakdown
 *   3. /reports/kpi/average-bill — paid order ortalaması
 *   4. /reports/hourly-revenue — 24 bucket array, doğru saatte total
 *   5. /reports/payment-distribution — segments + sharePct toplam ~100
 *   6. /reports/top-selling — limit + qty desc sıra
 *   7. /reports/recent-orders — open status filter
 *   8. /reports/closed-orders — paid status + paymentTypeMix
 *   9. RBAC: waiter → 403 (en az 2 endpoint)
 *  10. Multi-tenant izolasyon: tenant B verisi tenant A response'da yok
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const TABLE_A_ID = randomUUID();
const TABLE_A_CODE = `M-R-${randomUUID().slice(0, 6)}`;

const ADMIN_A_ID = randomUUID();
const ADMIN_A_EMAIL = `admin-rep-a-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_A_PASSWORD = 'adminpass1234';
const ADMIN_A_USERNAME = `admin-rep-a-${randomUUID().slice(0, 8)}`;

const CASHIER_A_ID = randomUUID();
const CASHIER_A_EMAIL = `cashier-rep-a-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_A_PASSWORD = 'cashierpass1234';
const CASHIER_A_USERNAME = `cashier-rep-a-${randomUUID().slice(0, 8)}`;

const WAITER_A_ID = randomUUID();
const WAITER_A_EMAIL = `waiter-rep-a-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_A_PASSWORD = 'waiterpass1234';
const WAITER_A_USERNAME = `waiter-rep-a-${randomUUID().slice(0, 8)}`;

const ADMIN_B_ID = randomUUID();
const ADMIN_B_EMAIL = `admin-rep-b-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_B_PASSWORD = 'adminpass1234';
const ADMIN_B_USERNAME = `admin-rep-b-${randomUUID().slice(0, 8)}`;

const CATEGORY_A_ID = randomUUID();
const PRODUCT_A_ID = randomUUID();
const PRODUCT_A_PRICE = 5000;

const CATEGORY_B_ID = randomUUID();
const PRODUCT_B_ID = randomUUID();
const PRODUCT_B_PRICE = 9000;

// ADR-017 Migration 031: takeaway → customer_id NOT NULL CHECK.
// Tenant B fixture'ında 1 takeaway order için kullanılır.
const CUSTOMER_B_ID = randomUUID();

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  appA?: Express;
  appB?: Express;
  adminToken?: string;
  cashierToken?: string;
  waiterToken?: string;
  adminTokenB?: string;
}

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function createOrderAndPay(
  app: Express,
  token: string,
  tableId: string,
  productId: string,
  price: number,
  paymentType: 'cash' | 'card' | 'transfer' = 'cash',
): Promise<string> {
  const orderRes = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: [{ productId, quantity: 1 }],
    });
  const orderId = orderRes.body.data.order.id as string;
  await request(app)
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderId,
      paymentType,
      paymentScope: 'full',
      amountCents: price,
      idempotencyKey: randomUUID(),
      operation: 'pay_and_close',
    });
  return orderId;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)('Reports endpoints (PR-8, ADR-015)', () => {
  const ctx: Ctx = {};

  beforeAll(async () => {
    const pool = createPool({ connectionString: DB_URL! });
    const db = createKysely(pool);
    ctx.pool = pool;
    ctx.db = db;
    ctx.appA = buildApp({
      pool,
      db,
      accessSecret: ACCESS_SECRET,
      tenantId: TENANT_A,
      webOrigin: 'http://localhost:5173',
    });
    ctx.appB = buildApp({
      pool,
      db,
      accessSecret: ACCESS_SECRET,
      tenantId: TENANT_B,
      webOrigin: 'http://localhost:5173',
    });

    // Two tenants
    await db
      .insertInto('tenants')
      .values([
        { id: TENANT_A, name: 'Tenant A Reports', slug: `t-rep-a-${TENANT_A.slice(0, 8)}` },
        { id: TENANT_B, name: 'Tenant B Reports', slug: `t-rep-b-${TENANT_B.slice(0, 8)}` },
      ])
      .onConflict((oc) => oc.doNothing())
      .execute();
    await db
      .insertInto('tenant_settings')
      .values([{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }])
      .onConflict((oc) => oc.doNothing())
      .execute();

    const adminAHash = await hashPassword(ADMIN_A_PASSWORD);
    const cashierAHash = await hashPassword(CASHIER_A_PASSWORD);
    const waiterAHash = await hashPassword(WAITER_A_PASSWORD);
    const adminBHash = await hashPassword(ADMIN_B_PASSWORD);

    await db
      .insertInto('users')
      .values([
        {
          id: ADMIN_A_ID,
          tenant_id: TENANT_A,
          email: ADMIN_A_EMAIL,
          username: ADMIN_A_USERNAME,
          password_hash: adminAHash,
          role: 'admin',
        },
        {
          id: CASHIER_A_ID,
          tenant_id: TENANT_A,
          email: CASHIER_A_EMAIL,
          username: CASHIER_A_USERNAME,
          password_hash: cashierAHash,
          role: 'cashier',
        },
        {
          id: WAITER_A_ID,
          tenant_id: TENANT_A,
          email: WAITER_A_EMAIL,
          username: WAITER_A_USERNAME,
          password_hash: waiterAHash,
          role: 'waiter',
        },
        {
          id: ADMIN_B_ID,
          tenant_id: TENANT_B,
          email: ADMIN_B_EMAIL,
          username: ADMIN_B_USERNAME,
          password_hash: adminBHash,
          role: 'admin',
        },
      ])
      .execute();

    await db
      .insertInto('tables')
      .values({ id: TABLE_A_ID, tenant_id: TENANT_A, code: TABLE_A_CODE, capacity: 4 })
      .execute();
    await db
      .insertInto('categories')
      .values([
        { id: CATEGORY_A_ID, tenant_id: TENANT_A, name: 'Yemekler A' },
        { id: CATEGORY_B_ID, tenant_id: TENANT_B, name: 'Yemekler B' },
      ])
      .execute();
    await db
      .insertInto('products')
      .values([
        {
          id: PRODUCT_A_ID,
          tenant_id: TENANT_A,
          category_id: CATEGORY_A_ID,
          name: 'Pide A',
          price_cents: PRODUCT_A_PRICE,
          is_active: true,
        },
        {
          id: PRODUCT_B_ID,
          tenant_id: TENANT_B,
          category_id: CATEGORY_B_ID,
          name: 'Pide B',
          price_cents: PRODUCT_B_PRICE,
          is_active: true,
        },
      ])
      .execute();

    // ADR-017 Migration 031: Tenant B takeaway order için customer fixture.
    await db
      .insertInto('customers')
      .values({
        id: CUSTOMER_B_ID,
        tenant_id: TENANT_B,
        full_name: 'Test Müşteri B (reports)',
        is_blacklisted: false,
      })
      .execute();

    ctx.adminToken = await loginAndGetToken(ctx.appA, ADMIN_A_EMAIL, ADMIN_A_PASSWORD);
    ctx.cashierToken = await loginAndGetToken(ctx.appA, CASHIER_A_EMAIL, CASHIER_A_PASSWORD);
    ctx.waiterToken = await loginAndGetToken(ctx.appA, WAITER_A_EMAIL, WAITER_A_PASSWORD);
    ctx.adminTokenB = await loginAndGetToken(ctx.appB, ADMIN_B_EMAIL, ADMIN_B_PASSWORD);

    // Tenant A: 2 paid orders cash, 1 paid order card
    await createOrderAndPay(ctx.appA, ctx.cashierToken!, TABLE_A_ID, PRODUCT_A_ID, PRODUCT_A_PRICE, 'cash');
    await createOrderAndPay(ctx.appA, ctx.cashierToken!, TABLE_A_ID, PRODUCT_A_ID, PRODUCT_A_PRICE, 'cash');
    await createOrderAndPay(ctx.appA, ctx.cashierToken!, TABLE_A_ID, PRODUCT_A_ID, PRODUCT_A_PRICE, 'card');

    // Tenant A: 1 open order (recent-orders'a düşmeli)
    await request(ctx.appA)
      .post('/orders')
      .set('Authorization', `Bearer ${ctx.cashierToken}`)
      .send({
        tableId: TABLE_A_ID,
        orderType: 'dine_in',
        items: [{ productId: PRODUCT_A_ID, quantity: 2 }],
      });

    // Tenant B: 1 açık takeaway order — A'nın raporlarında görünmemeli.
    // ADR-017 yeni schema: type discriminator + customerId + plannedPaymentType.
    const tenantBRes = await request(ctx.appB)
      .post('/orders')
      .set('Authorization', `Bearer ${ctx.adminTokenB}`)
      .send({
        type: 'takeaway',
        customerId: CUSTOMER_B_ID,
        plannedPaymentType: 'cash',
        items: [{ productId: PRODUCT_B_ID, quantity: 1 }],
      });
    if (tenantBRes.status !== 201) {
      throw new Error(
        `Tenant B takeaway fixture create failed: ${tenantBRes.status} ${JSON.stringify(tenantBRes.body)}`,
      );
    }
  });

  afterAll(async () => {
    const db = ctx.db;
    if (db === undefined) return;
    for (const tid of [TENANT_A, TENANT_B]) {
      await db.deleteFrom('payment_items').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('order_item_attributes').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('order_no_counters').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('products').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('users').where('tenant_id', '=', tid).execute();
      // ADR-017: customers, tenants'tan ÖNCE silinmeli (FK customer_tenant_id_fkey).
      await db.deleteFrom('customers').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', tid).execute();
      await db.deleteFrom('tenants').where('id', '=', tid).execute();
    }
    await ctx.pool?.end();
  });

  it('GET /reports/kpi/today-revenue → 200 doğru toplam', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/kpi/today-revenue')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalRevenueCents).toBe(PRODUCT_A_PRICE * 3);
    expect(res.body.data.paidOrderCount).toBe(3);
    expect(res.body.data.windowStart).toBeTruthy();
  });

  it('GET /reports/kpi/order-count → byStatus breakdown (Session 53c paid-only)', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/kpi/order-count')
      .set('Authorization', `Bearer ${ctx.cashierToken}`);
    expect(res.status).toBe(200);
    // byStatus breakdown korundu (forensic erişim).
    expect(res.body.data.byStatus.paid).toBe(3);
    expect(res.body.data.byStatus.open).toBe(1);
    // Session 53c Amendment: totalOrders semantik değişti — yalnız paid count.
    // Eski: open + paid = 4. Yeni: paid = 3.
    expect(res.body.data.totalOrders).toBe(3);
  });

  it('GET /reports/kpi/average-bill → 5000', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/kpi/average-bill')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.averageBillCents).toBe(PRODUCT_A_PRICE);
    expect(res.body.data.sampleSize).toBe(3);
  });

  it('GET /reports/hourly-revenue → 24 bucket', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/hourly-revenue')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.buckets).toHaveLength(24);
    const total = res.body.data.buckets.reduce(
      (s: number, b: { revenueCents: number }) => s + b.revenueCents,
      0,
    );
    expect(total).toBe(PRODUCT_A_PRICE * 3);
  });

  it('GET /reports/payment-distribution → cash %66.7 + card %33.3', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/payment-distribution')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalCents).toBe(PRODUCT_A_PRICE * 3);
    const cash = res.body.data.segments.find((s: { paymentType: string }) => s.paymentType === 'cash');
    const card = res.body.data.segments.find((s: { paymentType: string }) => s.paymentType === 'card');
    expect(cash.totalCents).toBe(PRODUCT_A_PRICE * 2);
    expect(card.totalCents).toBe(PRODUCT_A_PRICE);
    expect(Math.round(cash.sharePct + card.sharePct)).toBe(100);
  });

  it('GET /reports/top-selling?limit=5 → product A en çok satan', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/top-selling?limit=5')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.items[0].productId).toBe(PRODUCT_A_ID);
    // Session 53c paid-only: open siparişin 2 quantity'si dahil değil → tam 3.
    expect(res.body.data.items[0].totalQuantity).toBe(3);
  });

  it('GET /reports/recent-orders → 3 paid orders (Session 53c paid-only)', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/recent-orders?limit=5')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    // Session 53c Amendment: tüm orders → yalnız paid orders.
    // `totalOpenCount` field adı korundu (UI sözleşmesi); değer = paid count.
    expect(res.body.data.totalOpenCount).toBe(3);
    expect(res.body.data.orders).toHaveLength(3);
    // Her paid sipariş 1 quantity ile yaratıldı (createOrderAndPay helper).
    expect(res.body.data.orders[0].itemCount).toBe(1);
    expect(res.body.data.orders[0].tableCode).toBe(TABLE_A_CODE);
  });

  it('GET /reports/closed-orders → 3 paid order paymentTypeMix', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/closed-orders?limit=10')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalClosedCount).toBe(3);
    expect(res.body.data.orders).toHaveLength(3);
    const types = res.body.data.orders.flatMap((o: { paymentTypeMix: string[] }) => o.paymentTypeMix);
    expect(new Set(types)).toEqual(new Set(['cash', 'card']));
  });

  it('RBAC: waiter token → 403 (today-revenue)', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/kpi/today-revenue')
      .set('Authorization', `Bearer ${ctx.waiterToken}`);
    expect(res.status).toBe(403);
  });

  it('RBAC: waiter token → 403 (top-selling)', async () => {
    const res = await request(ctx.appA!)
      .get('/reports/top-selling')
      .set('Authorization', `Bearer ${ctx.waiterToken}`);
    expect(res.status).toBe(403);
  });

  it('Multi-tenant izolasyon: tenant B verisi A response\'da yok', async () => {
    // Session 53c paid-only: Tenant B'nin yalnız 1 open takeaway siparişi var,
    // paid yok → recent-orders 0 sonuç döner. Cross-tenant izolasyon hâlâ
    // doğrulanır (B'nin response'unda A'nın masa kodu yok).
    const resB = await request(ctx.appB!)
      .get('/reports/recent-orders?limit=10')
      .set('Authorization', `Bearer ${ctx.adminTokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.totalOpenCount).toBe(0);
    expect(resB.body.data.orders).toHaveLength(0);
    // Tenant A'nın masa kodu B'de gözükmemeli (boş array → yine doğru).
    for (const order of resB.body.data.orders) {
      expect(order.tableCode).not.toBe(TABLE_A_CODE);
    }
  });

  it('Auth yok → 401', async () => {
    const res = await request(ctx.appA!).get('/reports/kpi/today-revenue');
    expect(res.status).toBe(401);
  });
});
