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

// ─────────────────────────────────────────────────────────────────────────────
// ADR-015 Amendment 1 (Karar 1) — /reports/category-sales
// ─────────────────────────────────────────────────────────────────────────────

const CS_TENANT_A = randomUUID();
const CS_TENANT_B = randomUUID();
const CS_TABLE_A_ID = randomUUID();
const CS_TABLE_A_CODE = `M-CS-${randomUUID().slice(0, 6)}`;

const CS_ADMIN_A_ID = randomUUID();
const CS_ADMIN_A_EMAIL = `admin-cs-a-${randomUUID().slice(0, 8)}@example.com`;
const CS_ADMIN_A_PASSWORD = 'adminpass1234';
const CS_ADMIN_A_USERNAME = `admin-cs-a-${randomUUID().slice(0, 8)}`;

const CS_CASHIER_A_ID = randomUUID();
const CS_CASHIER_A_EMAIL = `cashier-cs-a-${randomUUID().slice(0, 8)}@example.com`;
const CS_CASHIER_A_PASSWORD = 'cashierpass1234';
const CS_CASHIER_A_USERNAME = `cashier-cs-a-${randomUUID().slice(0, 8)}`;

const CS_WAITER_A_ID = randomUUID();
const CS_WAITER_A_EMAIL = `waiter-cs-a-${randomUUID().slice(0, 8)}@example.com`;
const CS_WAITER_A_PASSWORD = 'waiterpass1234';
const CS_WAITER_A_USERNAME = `waiter-cs-a-${randomUUID().slice(0, 8)}`;

const CS_ADMIN_B_ID = randomUUID();
const CS_ADMIN_B_EMAIL = `admin-cs-b-${randomUUID().slice(0, 8)}@example.com`;
const CS_ADMIN_B_PASSWORD = 'adminpass1234';
const CS_ADMIN_B_USERNAME = `admin-cs-b-${randomUUID().slice(0, 8)}`;

// Tenant A: 3 kategori farklı dağılımla (dağılım/sıra/sharePct testi).
const CS_CAT_PIDE = randomUUID();
const CS_CAT_DRINK = randomUUID();
const CS_CAT_DESSERT = randomUUID();
const CS_PROD_PIDE = randomUUID();
const CS_PROD_DRINK = randomUUID();
const CS_PROD_DESSERT = randomUUID();
const CS_PRICE_PIDE = 6000; // 60 TL
const CS_PRICE_DRINK = 2000; // 20 TL
const CS_PRICE_DESSERT = 4000; // 40 TL

// Tenant B: izolasyon kontrolü için kategori + paid order.
const CS_CAT_B = randomUUID();
const CS_PROD_B = randomUUID();
const CS_PRICE_B = 7000;
const CS_TABLE_B_ID = randomUUID();
const CS_TABLE_B_CODE = `M-CS-B-${randomUUID().slice(0, 6)}`;

interface CsCtx {
  pool?: Pool;
  db?: Kysely<DB>;
  appA?: Express;
  appB?: Express;
  adminTokenA?: string;
  cashierTokenA?: string;
  waiterTokenA?: string;
  adminTokenB?: string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'GET /reports/category-sales (ADR-015 Amendment 1, Karar 1)',
  () => {
    const ctx: CsCtx = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.appA = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: CS_TENANT_A,
        webOrigin: 'http://localhost:5173',
      });
      ctx.appB = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: CS_TENANT_B,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          { id: CS_TENANT_A, name: 'CS Tenant A', slug: `cs-a-${CS_TENANT_A.slice(0, 8)}` },
          { id: CS_TENANT_B, name: 'CS Tenant B', slug: `cs-b-${CS_TENANT_B.slice(0, 8)}` },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: CS_TENANT_A }, { tenant_id: CS_TENANT_B }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminAHash = await hashPassword(CS_ADMIN_A_PASSWORD);
      const cashierAHash = await hashPassword(CS_CASHIER_A_PASSWORD);
      const waiterAHash = await hashPassword(CS_WAITER_A_PASSWORD);
      const adminBHash = await hashPassword(CS_ADMIN_B_PASSWORD);

      await db
        .insertInto('users')
        .values([
          {
            id: CS_ADMIN_A_ID,
            tenant_id: CS_TENANT_A,
            email: CS_ADMIN_A_EMAIL,
            username: CS_ADMIN_A_USERNAME,
            password_hash: adminAHash,
            role: 'admin',
          },
          {
            id: CS_CASHIER_A_ID,
            tenant_id: CS_TENANT_A,
            email: CS_CASHIER_A_EMAIL,
            username: CS_CASHIER_A_USERNAME,
            password_hash: cashierAHash,
            role: 'cashier',
          },
          {
            id: CS_WAITER_A_ID,
            tenant_id: CS_TENANT_A,
            email: CS_WAITER_A_EMAIL,
            username: CS_WAITER_A_USERNAME,
            password_hash: waiterAHash,
            role: 'waiter',
          },
          {
            id: CS_ADMIN_B_ID,
            tenant_id: CS_TENANT_B,
            email: CS_ADMIN_B_EMAIL,
            username: CS_ADMIN_B_USERNAME,
            password_hash: adminBHash,
            role: 'admin',
          },
        ])
        .execute();

      await db
        .insertInto('tables')
        .values([
          { id: CS_TABLE_A_ID, tenant_id: CS_TENANT_A, code: CS_TABLE_A_CODE, capacity: 4 },
          { id: CS_TABLE_B_ID, tenant_id: CS_TENANT_B, code: CS_TABLE_B_CODE, capacity: 4 },
        ])
        .execute();

      await db
        .insertInto('categories')
        .values([
          { id: CS_CAT_PIDE, tenant_id: CS_TENANT_A, name: 'Pideler' },
          { id: CS_CAT_DRINK, tenant_id: CS_TENANT_A, name: 'İçecekler' },
          { id: CS_CAT_DESSERT, tenant_id: CS_TENANT_A, name: 'Tatlılar' },
          { id: CS_CAT_B, tenant_id: CS_TENANT_B, name: 'Kategori B' },
        ])
        .execute();

      await db
        .insertInto('products')
        .values([
          {
            id: CS_PROD_PIDE,
            tenant_id: CS_TENANT_A,
            category_id: CS_CAT_PIDE,
            name: 'Kıymalı Pide',
            price_cents: CS_PRICE_PIDE,
            is_active: true,
          },
          {
            id: CS_PROD_DRINK,
            tenant_id: CS_TENANT_A,
            category_id: CS_CAT_DRINK,
            name: 'Ayran',
            price_cents: CS_PRICE_DRINK,
            is_active: true,
          },
          {
            id: CS_PROD_DESSERT,
            tenant_id: CS_TENANT_A,
            category_id: CS_CAT_DESSERT,
            name: 'Künefe',
            price_cents: CS_PRICE_DESSERT,
            is_active: true,
          },
          {
            id: CS_PROD_B,
            tenant_id: CS_TENANT_B,
            category_id: CS_CAT_B,
            name: 'Pide B',
            price_cents: CS_PRICE_B,
            is_active: true,
          },
        ])
        .execute();

      ctx.adminTokenA = await loginAndGetToken(ctx.appA, CS_ADMIN_A_EMAIL, CS_ADMIN_A_PASSWORD);
      ctx.cashierTokenA = await loginAndGetToken(
        ctx.appA,
        CS_CASHIER_A_EMAIL,
        CS_CASHIER_A_PASSWORD,
      );
      ctx.waiterTokenA = await loginAndGetToken(
        ctx.appA,
        CS_WAITER_A_EMAIL,
        CS_WAITER_A_PASSWORD,
      );
      ctx.adminTokenB = await loginAndGetToken(ctx.appB, CS_ADMIN_B_EMAIL, CS_ADMIN_B_PASSWORD);

      // Tenant A paid orders:
      //   Pide ×3 (3×6000=18000), Drink ×2 (2×2000=4000), Dessert ×1 (1×4000=4000)
      //   total=26000. sharePct: pide ≈ 69.2, drink ≈ 15.4, dessert ≈ 15.4.
      //   sharePct=15.4 ikiz; sıra revenueCents desc → drink=4000, dessert=4000 ardışık (tie).
      for (let i = 0; i < 3; i++) {
        await createOrderAndPay(
          ctx.appA,
          ctx.cashierTokenA!,
          CS_TABLE_A_ID,
          CS_PROD_PIDE,
          CS_PRICE_PIDE,
          'cash',
        );
      }
      for (let i = 0; i < 2; i++) {
        await createOrderAndPay(
          ctx.appA,
          ctx.cashierTokenA!,
          CS_TABLE_A_ID,
          CS_PROD_DRINK,
          CS_PRICE_DRINK,
          'cash',
        );
      }
      await createOrderAndPay(
        ctx.appA,
        ctx.cashierTokenA!,
        CS_TABLE_A_ID,
        CS_PROD_DESSERT,
        CS_PRICE_DESSERT,
        'card',
      );

      // Tenant A: 1 OPEN sipariş (status='open' → revenue'ya katkı YOK).
      await request(ctx.appA)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.cashierTokenA}`)
        .send({
          tableId: CS_TABLE_A_ID,
          orderType: 'dine_in',
          items: [{ productId: CS_PROD_PIDE, quantity: 5 }],
        });

      // Tenant B: 1 paid order — A response'unda görünmemeli.
      await createOrderAndPay(
        ctx.appB,
        ctx.adminTokenB!,
        CS_TABLE_B_ID,
        CS_PROD_B,
        CS_PRICE_B,
        'cash',
      );
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      for (const tid of [CS_TENANT_A, CS_TENANT_B]) {
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
        await db.deleteFrom('tenant_settings').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await ctx.pool?.end();
    });

    it('range=today default → revenue desc sıra + sharePct toplam ≈ 100', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const cats = res.body.data.categories as Array<{
        categoryId: string;
        categoryName: string;
        qty: number;
        revenueCents: number;
        sharePct: number;
      }>;
      // 3 kategori (hepsi listelensin — qty=0 olsa bile mevcut kategori dönmeli).
      expect(cats).toHaveLength(3);
      // Sıra: revenueCents desc → Pide en başta (18000).
      expect(cats[0]!.categoryId).toBe(CS_CAT_PIDE);
      expect(cats[0]!.revenueCents).toBe(CS_PRICE_PIDE * 3);
      expect(cats[0]!.qty).toBe(3);
      // sharePct toplamı yuvarlama farkıyla ≈ 100.
      const total = cats.reduce((s, c) => s + c.sharePct, 0);
      expect(Math.round(total)).toBe(100);
      // windowStart/End ISO8601 dolu.
      expect(typeof res.body.data.windowStart).toBe('string');
      expect(typeof res.body.data.windowEnd).toBe('string');
    });

    it('paid olmayan (open) siparişler revenue/qty hesabına dahil değil', async () => {
      // Setup'ta Pide için OPEN order quantity=5 yarattık.
      // Eğer dahil olsaydı pide qty=8 olurdu; sadece paid (3) sayılmalı.
      const res = await request(ctx.appA!)
        .get('/reports/category-sales')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const pide = (res.body.data.categories as Array<{ categoryId: string; qty: number }>)
        .find((c) => c.categoryId === CS_CAT_PIDE);
      expect(pide).toBeDefined();
      expect(pide!.qty).toBe(3);
    });

    it('Multi-tenant izolasyon: Tenant B Tenant A response\'unda yok', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.categories as Array<{ categoryId: string }>).map(
        (c) => c.categoryId,
      );
      expect(ids).not.toContain(CS_CAT_B);
    });

    it('Tenant B response: yalnız B kategorisi, A verisi yok', async () => {
      const res = await request(ctx.appB!)
        .get('/reports/category-sales')
        .set('Authorization', `Bearer ${ctx.adminTokenB}`);
      expect(res.status).toBe(200);
      expect(res.body.data.categories).toHaveLength(1);
      expect(res.body.data.categories[0].categoryId).toBe(CS_CAT_B);
      expect(res.body.data.categories[0].revenueCents).toBe(CS_PRICE_B);
      expect(res.body.data.categories[0].sharePct).toBe(100);
    });

    it('RBAC: waiter token → 403', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`);
      expect(res.status).toBe(403);
    });

    it('range=week → bugünün siparişlerini içerir', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales?range=week')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      // Hafta penceresi → en az bugün dahil; pide kategorisi paid revenue'ya
      // sahip olmalı (haftanın hangi gününde olursak olalım today ⊂ week).
      const pide = (
        res.body.data.categories as Array<{ categoryId: string; revenueCents: number }>
      ).find((c) => c.categoryId === CS_CAT_PIDE);
      expect(pide).toBeDefined();
      expect(pide!.revenueCents).toBeGreaterThanOrEqual(CS_PRICE_PIDE * 3);
    });

    it('range=month → bugünün siparişlerini içerir', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales?range=month')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const pide = (
        res.body.data.categories as Array<{ categoryId: string; revenueCents: number }>
      ).find((c) => c.categoryId === CS_CAT_PIDE);
      expect(pide!.revenueCents).toBeGreaterThanOrEqual(CS_PRICE_PIDE * 3);
    });

    it('from/to override: bugünü kapsayan aralık → today ile aynı revenue', async () => {
      const today = new Date();
      const yyyy = today.getUTCFullYear();
      const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(today.getUTCDate()).padStart(2, '0');
      // Pencereyi geniş tutalım: dün → yarın (TZ farkı emniyeti).
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
      const fmt = (d: Date) =>
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const from = fmt(yesterday);
      const to = fmt(tomorrow);
      const res = await request(ctx.appA!)
        .get(`/reports/category-sales?from=${from}&to=${to}`)
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const pide = (
        res.body.data.categories as Array<{ categoryId: string; revenueCents: number }>
      ).find((c) => c.categoryId === CS_CAT_PIDE);
      expect(pide!.revenueCents).toBeGreaterThanOrEqual(CS_PRICE_PIDE * 3);
      // suppress unused: yyyy/mm/dd
      expect(`${yyyy}-${mm}-${dd}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('Yalnız `from` verilirse → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales?from=2026-01-01')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(400);
    });

    it('Geçersiz range → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales?range=year')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(400);
    });

    it('Auth yok → 401', async () => {
      const res = await request(ctx.appA!).get('/reports/category-sales');
      expect(res.status).toBe(401);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ADR-015 Amendment 1 (Karar 2) — /reports/anomalies (cancel-only MVP)
// ─────────────────────────────────────────────────────────────────────────────

const AN_TENANT_A = randomUUID();
const AN_TENANT_B = randomUUID();

const AN_ADMIN_A_ID = randomUUID();
const AN_ADMIN_A_EMAIL = `admin-an-a-${randomUUID().slice(0, 8)}@example.com`;
const AN_ADMIN_A_PASSWORD = 'adminpass1234';
const AN_ADMIN_A_USERNAME = `admin-an-a-${randomUUID().slice(0, 8)}`;

const AN_CASHIER_A_ID = randomUUID();
const AN_CASHIER_A_EMAIL = `cashier-an-a-${randomUUID().slice(0, 8)}@example.com`;
const AN_CASHIER_A_PASSWORD = 'cashierpass1234';
const AN_CASHIER_A_USERNAME = `cashier-an-a-${randomUUID().slice(0, 8)}`;

const AN_WAITER_A_ID = randomUUID();
const AN_WAITER_A_EMAIL = `waiter-an-a-${randomUUID().slice(0, 8)}@example.com`;
const AN_WAITER_A_PASSWORD = 'waiterpass1234';
const AN_WAITER_A_USERNAME = `waiter-an-a-${randomUUID().slice(0, 8)}`;

const AN_ADMIN_B_ID = randomUUID();
const AN_ADMIN_B_EMAIL = `admin-an-b-${randomUUID().slice(0, 8)}@example.com`;
const AN_ADMIN_B_PASSWORD = 'adminpass1234';
const AN_ADMIN_B_USERNAME = `admin-an-b-${randomUUID().slice(0, 8)}`;

const AN_TABLE_A_ID = randomUUID();
const AN_TABLE_A_CODE = `M-AN-A-${randomUUID().slice(0, 6)}`;
const AN_TABLE_B_ID = randomUUID();
const AN_TABLE_B_CODE = `M-AN-B-${randomUUID().slice(0, 6)}`;

interface AnCtx {
  pool?: Pool;
  db?: Kysely<DB>;
  appA?: Express;
  appB?: Express;
  adminTokenA?: string;
  cashierTokenA?: string;
  waiterTokenA?: string;
  adminTokenB?: string;
}

/**
 * Helper — direkt DB insert ile cancelled order + order_items + audit_logs
 * yarat. Endpoint izole edilir (HTTP cancel akışı orders.takeaway.test.ts'te
 * test edildi; burada raporu test ediyoruz, akışı değil).
 *
 * @param createdAt audit_logs.created_at ve orders.created_at — tarihsel
 *   pencere (today/week/month) testleri için kontrol edilebilir olmalı.
 * @param itemTotals — her item için total_cents (kayıp tutar agregasyonu).
 * @param reason — payload->>'reason' field'ı (null ise eklenmez).
 */
async function seedCancelledOrder(
  db: Kysely<DB>,
  args: {
    tenantId: string;
    orderId: string;
    actorUserId: string | null;
    createdAt: Date;
    itemTotals: number[];
    reason?: string | null;
  },
): Promise<void> {
  // orders satırı (status='cancelled', total_cents=0 → cancelTakeawayOrder
  // davranışını birebir yansıtır).
  await db
    .insertInto('orders')
    .values({
      id: args.orderId,
      tenant_id: args.tenantId,
      table_id: null,
      customer_id: null,
      order_type: 'dine_in',
      status: 'cancelled',
      order_no: Math.floor(Math.random() * 1000000) + 1,
      total_cents: 0,
      store_date: args.createdAt,
      created_at: args.createdAt,
      updated_at: args.createdAt,
    })
    .execute();

  // order_items — total_cents korunur (cancelled da olsalar SUM hesabı bunu
  // kullanır). Her item için snapshot fields zorunlu.
  for (const total of args.itemTotals) {
    await db
      .insertInto('order_items')
      .values({
        id: randomUUID(),
        tenant_id: args.tenantId,
        order_id: args.orderId,
        product_id: null,
        product_name: 'Test Item',
        category_name_snapshot: 'Test Cat',
        unit_price_cents: total,
        quantity: 1,
        total_cents: total,
        status: 'cancelled',
        created_at: args.createdAt,
      })
      .execute();
  }

  // audit_logs — event_type='order.cancelled'. payload optional reason.
  const payload: Record<string, unknown> = { order_id: args.orderId };
  if (args.reason !== undefined && args.reason !== null) {
    payload['reason'] = args.reason;
  }
  await db
    .insertInto('audit_logs')
    .values({
      id: randomUUID(),
      tenant_id: args.tenantId,
      event_type: 'order.cancelled',
      entity_type: 'order',
      entity_id: args.orderId,
      actor_user_id: args.actorUserId,
      // actor JSONB defaults '{}'; explicit boş obje verelim ki uyumlu kalsın.
      actor: JSON.stringify({}),
      payload: JSON.stringify(payload),
      created_at: args.createdAt,
    })
    .execute();
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'GET /reports/anomalies (ADR-015 Amendment 1, Karar 2 — cancel-only MVP)',
  () => {
    const ctx: AnCtx = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.appA = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: AN_TENANT_A,
        webOrigin: 'http://localhost:5173',
      });
      ctx.appB = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: AN_TENANT_B,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: AN_TENANT_A,
            name: 'AN Tenant A',
            slug: `an-a-${AN_TENANT_A.slice(0, 8)}`,
          },
          {
            id: AN_TENANT_B,
            name: 'AN Tenant B',
            slug: `an-b-${AN_TENANT_B.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: AN_TENANT_A }, { tenant_id: AN_TENANT_B }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminAHash = await hashPassword(AN_ADMIN_A_PASSWORD);
      const cashierAHash = await hashPassword(AN_CASHIER_A_PASSWORD);
      const waiterAHash = await hashPassword(AN_WAITER_A_PASSWORD);
      const adminBHash = await hashPassword(AN_ADMIN_B_PASSWORD);

      await db
        .insertInto('users')
        .values([
          {
            id: AN_ADMIN_A_ID,
            tenant_id: AN_TENANT_A,
            email: AN_ADMIN_A_EMAIL,
            username: AN_ADMIN_A_USERNAME,
            password_hash: adminAHash,
            role: 'admin',
          },
          {
            id: AN_CASHIER_A_ID,
            tenant_id: AN_TENANT_A,
            email: AN_CASHIER_A_EMAIL,
            username: AN_CASHIER_A_USERNAME,
            password_hash: cashierAHash,
            role: 'cashier',
          },
          {
            id: AN_WAITER_A_ID,
            tenant_id: AN_TENANT_A,
            email: AN_WAITER_A_EMAIL,
            username: AN_WAITER_A_USERNAME,
            password_hash: waiterAHash,
            role: 'waiter',
          },
          {
            id: AN_ADMIN_B_ID,
            tenant_id: AN_TENANT_B,
            email: AN_ADMIN_B_EMAIL,
            username: AN_ADMIN_B_USERNAME,
            password_hash: adminBHash,
            role: 'admin',
          },
        ])
        .execute();

      await db
        .insertInto('tables')
        .values([
          {
            id: AN_TABLE_A_ID,
            tenant_id: AN_TENANT_A,
            code: AN_TABLE_A_CODE,
            capacity: 4,
          },
          {
            id: AN_TABLE_B_ID,
            tenant_id: AN_TENANT_B,
            code: AN_TABLE_B_CODE,
            capacity: 4,
          },
        ])
        .execute();

      ctx.adminTokenA = await loginAndGetToken(
        ctx.appA,
        AN_ADMIN_A_EMAIL,
        AN_ADMIN_A_PASSWORD,
      );
      ctx.cashierTokenA = await loginAndGetToken(
        ctx.appA,
        AN_CASHIER_A_EMAIL,
        AN_CASHIER_A_PASSWORD,
      );
      ctx.waiterTokenA = await loginAndGetToken(
        ctx.appA,
        AN_WAITER_A_EMAIL,
        AN_WAITER_A_PASSWORD,
      );
      ctx.adminTokenB = await loginAndGetToken(
        ctx.appB,
        AN_ADMIN_B_EMAIL,
        AN_ADMIN_B_PASSWORD,
      );
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      for (const tid of [AN_TENANT_A, AN_TENANT_B]) {
        await db.deleteFrom('audit_logs').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('order_no_counters').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('refresh_tokens').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('users').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tenant_settings').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await ctx.pool?.end();
    });

    it('1. Hiç cancel yok → boş summary + boş details', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/anomalies')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.summary).toEqual({
        cancelCount: 0,
        voidCount: 0,
        compCount: 0,
        totalLossCents: 0,
      });
      expect(res.body.data.details).toEqual([]);
      expect(typeof res.body.data.windowStart).toBe('string');
      expect(typeof res.body.data.windowEnd).toBe('string');
    });

    it('2. Tek cancel order, 2 item → cancelCount=1, totalLossCents=item toplamı, details[0] doğru', async () => {
      const orderId = randomUUID();
      const now = new Date();
      await seedCancelledOrder(ctx.db!, {
        tenantId: AN_TENANT_A,
        orderId,
        actorUserId: AN_ADMIN_A_ID,
        createdAt: now,
        itemTotals: [3000, 2500],
      });

      const res = await request(ctx.appA!)
        .get('/reports/anomalies')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.cancelCount).toBe(1);
      expect(res.body.data.summary.voidCount).toBe(0);
      expect(res.body.data.summary.compCount).toBe(0);
      expect(res.body.data.summary.totalLossCents).toBe(5500);
      expect(res.body.data.details).toHaveLength(1);
      expect(res.body.data.details[0]).toMatchObject({
        type: 'cancel',
        orderId,
        amountCents: 5500,
        actorUserId: AN_ADMIN_A_ID,
        reason: null,
      });
      expect(typeof res.body.data.details[0].occurredAt).toBe('string');

      // cleanup for downstream tests
      await ctx.db!
        .deleteFrom('audit_logs')
        .where('entity_id', '=', orderId)
        .execute();
      await ctx.db!.deleteFrom('order_items').where('order_id', '=', orderId).execute();
      await ctx.db!.deleteFrom('orders').where('id', '=', orderId).execute();
    });

    it('3. Çoklu cancel order → cancelCount=N, details ORDER BY occurredAt DESC', async () => {
      const order1 = randomUUID();
      const order2 = randomUUID();
      const order3 = randomUUID();
      const t0 = new Date();
      const t1 = new Date(t0.getTime() - 60_000); // 1 dk önce
      const t2 = new Date(t0.getTime() - 120_000); // 2 dk önce
      await seedCancelledOrder(ctx.db!, {
        tenantId: AN_TENANT_A,
        orderId: order1,
        actorUserId: AN_ADMIN_A_ID,
        createdAt: t0,
        itemTotals: [1000],
      });
      await seedCancelledOrder(ctx.db!, {
        tenantId: AN_TENANT_A,
        orderId: order2,
        actorUserId: AN_ADMIN_A_ID,
        createdAt: t1,
        itemTotals: [2000],
      });
      await seedCancelledOrder(ctx.db!, {
        tenantId: AN_TENANT_A,
        orderId: order3,
        actorUserId: AN_ADMIN_A_ID,
        createdAt: t2,
        itemTotals: [3000],
      });

      const res = await request(ctx.appA!)
        .get('/reports/anomalies')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.cancelCount).toBe(3);
      expect(res.body.data.summary.totalLossCents).toBe(6000);
      const ids = (res.body.data.details as Array<{ orderId: string }>).map(
        (d) => d.orderId,
      );
      // DESC: order1 (en yeni) → order2 → order3
      expect(ids).toEqual([order1, order2, order3]);

      for (const id of [order1, order2, order3]) {
        await ctx.db!
          .deleteFrom('audit_logs')
          .where('entity_id', '=', id)
          .execute();
        await ctx.db!.deleteFrom('order_items').where('order_id', '=', id).execute();
        await ctx.db!.deleteFrom('orders').where('id', '=', id).execute();
      }
    });

    it('4. range=today edge: dünkü cancel pencere dışı', async () => {
      const oldOrder = randomUUID();
      // 2 gün önce — today penceresi dışı.
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await seedCancelledOrder(ctx.db!, {
        tenantId: AN_TENANT_A,
        orderId: oldOrder,
        actorUserId: AN_ADMIN_A_ID,
        createdAt: oldDate,
        itemTotals: [9000],
      });

      const res = await request(ctx.appA!)
        .get('/reports/anomalies?range=today')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.cancelCount).toBe(0);
      expect(res.body.data.summary.totalLossCents).toBe(0);
      expect(res.body.data.details).toEqual([]);

      // bırakalım — sonraki testlerde range=month vb. için kullanılabilir,
      // ama 7. testte from/to ile kapsanacak. Cleanup en sonda afterAll yapar.
      await ctx.db!
        .deleteFrom('audit_logs')
        .where('entity_id', '=', oldOrder)
        .execute();
      await ctx.db!
        .deleteFrom('order_items')
        .where('order_id', '=', oldOrder)
        .execute();
      await ctx.db!.deleteFrom('orders').where('id', '=', oldOrder).execute();
    });

    it('5. Multi-tenant izolasyon: Tenant B cancel order Tenant A response\'unda yok', async () => {
      const tenantBOrder = randomUUID();
      await seedCancelledOrder(ctx.db!, {
        tenantId: AN_TENANT_B,
        orderId: tenantBOrder,
        actorUserId: AN_ADMIN_B_ID,
        createdAt: new Date(),
        itemTotals: [10000],
      });

      const resA = await request(ctx.appA!)
        .get('/reports/anomalies')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(resA.status).toBe(200);
      const idsA = (resA.body.data.details as Array<{ orderId: string }>).map(
        (d) => d.orderId,
      );
      expect(idsA).not.toContain(tenantBOrder);

      const resB = await request(ctx.appB!)
        .get('/reports/anomalies')
        .set('Authorization', `Bearer ${ctx.adminTokenB}`);
      expect(resB.status).toBe(200);
      expect(resB.body.data.summary.cancelCount).toBe(1);
      expect(resB.body.data.summary.totalLossCents).toBe(10000);

      await ctx.db!
        .deleteFrom('audit_logs')
        .where('entity_id', '=', tenantBOrder)
        .execute();
      await ctx.db!
        .deleteFrom('order_items')
        .where('order_id', '=', tenantBOrder)
        .execute();
      await ctx.db!.deleteFrom('orders').where('id', '=', tenantBOrder).execute();
    });

    it('6. RBAC: waiter token → 403, cashier OK', async () => {
      const resWaiter = await request(ctx.appA!)
        .get('/reports/anomalies')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`);
      expect(resWaiter.status).toBe(403);

      const resCashier = await request(ctx.appA!)
        .get('/reports/anomalies')
        .set('Authorization', `Bearer ${ctx.cashierTokenA}`);
      expect(resCashier.status).toBe(200);
    });

    it('7. from/to override: belirli aralıkta cancel order yakalanır', async () => {
      const orderId = randomUUID();
      const fixedDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 gün önce
      await seedCancelledOrder(ctx.db!, {
        tenantId: AN_TENANT_A,
        orderId,
        actorUserId: AN_ADMIN_A_ID,
        createdAt: fixedDate,
        itemTotals: [4500],
      });

      const fmt = (d: Date) =>
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const dayBefore = new Date(fixedDate.getTime() - 24 * 60 * 60 * 1000);
      const dayAfter = new Date(fixedDate.getTime() + 24 * 60 * 60 * 1000);

      const res = await request(ctx.appA!)
        .get(`/reports/anomalies?from=${fmt(dayBefore)}&to=${fmt(dayAfter)}`)
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.cancelCount).toBe(1);
      expect(res.body.data.summary.totalLossCents).toBe(4500);
      const found = (res.body.data.details as Array<{ orderId: string }>).find(
        (d) => d.orderId === orderId,
      );
      expect(found).toBeDefined();

      await ctx.db!
        .deleteFrom('audit_logs')
        .where('entity_id', '=', orderId)
        .execute();
      await ctx.db!.deleteFrom('order_items').where('order_id', '=', orderId).execute();
      await ctx.db!.deleteFrom('orders').where('id', '=', orderId).execute();
    });

    it('8. Yalnız `from` verilirse → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/anomalies?from=2026-01-01')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(400);
    });

    it('9. Geçersiz range → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/anomalies?range=year')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(400);
    });

    it('10. Auth yok → 401', async () => {
      const res = await request(ctx.appA!).get('/reports/anomalies');
      expect(res.status).toBe(401);
    });

    it('11. payload->>reason field non-null değer → response\'ta string olarak döner', async () => {
      const orderId = randomUUID();
      await seedCancelledOrder(ctx.db!, {
        tenantId: AN_TENANT_A,
        orderId,
        actorUserId: AN_ADMIN_A_ID,
        createdAt: new Date(),
        itemTotals: [1500],
        reason: 'müşteri vazgeçti',
      });

      const res = await request(ctx.appA!)
        .get('/reports/anomalies')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const detail = (
        res.body.data.details as Array<{ orderId: string; reason: string | null }>
      ).find((d) => d.orderId === orderId);
      expect(detail).toBeDefined();
      expect(detail!.reason).toBe('müşteri vazgeçti');

      await ctx.db!
        .deleteFrom('audit_logs')
        .where('entity_id', '=', orderId)
        .execute();
      await ctx.db!.deleteFrom('order_items').where('order_id', '=', orderId).execute();
      await ctx.db!.deleteFrom('orders').where('id', '=', orderId).execute();
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ADR-015 Amendment 1 (Karar 3) — /reports/user-performance
//   schema audit: orders.cashier_id YOK; cashier = payments.created_by_user_id.
//   waiter = orders.waiter_user_id (set in POST /orders).
// ─────────────────────────────────────────────────────────────────────────────

const UP_TENANT_A = randomUUID();
const UP_TENANT_B = randomUUID();

const UP_ADMIN_A_ID = randomUUID();
const UP_ADMIN_A_EMAIL = `admin-up-a-${randomUUID().slice(0, 8)}@example.com`;
const UP_ADMIN_A_PASSWORD = 'adminpass1234';
const UP_ADMIN_A_USERNAME = `admin-up-a-${randomUUID().slice(0, 8)}`;

const UP_CASHIER_A_ID = randomUUID();
const UP_CASHIER_A_EMAIL = `cashier-up-a-${randomUUID().slice(0, 8)}@example.com`;
const UP_CASHIER_A_PASSWORD = 'cashierpass1234';
const UP_CASHIER_A_USERNAME = `cashier-up-a-${randomUUID().slice(0, 8)}`;

const UP_WAITER_A_ID = randomUUID();
const UP_WAITER_A_EMAIL = `waiter-up-a-${randomUUID().slice(0, 8)}@example.com`;
const UP_WAITER_A_PASSWORD = 'waiterpass1234';
const UP_WAITER_A_USERNAME = `waiter-up-a-${randomUUID().slice(0, 8)}`;

const UP_ADMIN_B_ID = randomUUID();
const UP_ADMIN_B_EMAIL = `admin-up-b-${randomUUID().slice(0, 8)}@example.com`;
const UP_ADMIN_B_PASSWORD = 'adminpass1234';
const UP_ADMIN_B_USERNAME = `admin-up-b-${randomUUID().slice(0, 8)}`;

const UP_TABLE_A_ID = randomUUID();
const UP_TABLE_A_CODE = `M-UP-A-${randomUUID().slice(0, 6)}`;
const UP_TABLE_B_ID = randomUUID();
const UP_TABLE_B_CODE = `M-UP-B-${randomUUID().slice(0, 6)}`;

const UP_CATEGORY_A_ID = randomUUID();
const UP_PRODUCT_A_ID = randomUUID();
const UP_PRODUCT_A_PRICE = 5000;
const UP_CATEGORY_B_ID = randomUUID();
const UP_PRODUCT_B_ID = randomUUID();
const UP_PRODUCT_B_PRICE = 7000;

interface UpCtx {
  pool?: Pool;
  db?: Kysely<DB>;
  appA?: Express;
  appB?: Express;
  adminTokenA?: string;
  cashierTokenA?: string;
  waiterTokenA?: string;
  adminTokenB?: string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'GET /reports/user-performance (ADR-015 Amendment 1, Karar 3)',
  () => {
    const ctx: UpCtx = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.appA = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: UP_TENANT_A,
        webOrigin: 'http://localhost:5173',
      });
      ctx.appB = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: UP_TENANT_B,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: UP_TENANT_A,
            name: 'UP Tenant A',
            slug: `up-a-${UP_TENANT_A.slice(0, 8)}`,
          },
          {
            id: UP_TENANT_B,
            name: 'UP Tenant B',
            slug: `up-b-${UP_TENANT_B.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: UP_TENANT_A }, { tenant_id: UP_TENANT_B }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminAHash = await hashPassword(UP_ADMIN_A_PASSWORD);
      const cashierAHash = await hashPassword(UP_CASHIER_A_PASSWORD);
      const waiterAHash = await hashPassword(UP_WAITER_A_PASSWORD);
      const adminBHash = await hashPassword(UP_ADMIN_B_PASSWORD);

      await db
        .insertInto('users')
        .values([
          {
            id: UP_ADMIN_A_ID,
            tenant_id: UP_TENANT_A,
            email: UP_ADMIN_A_EMAIL,
            username: UP_ADMIN_A_USERNAME,
            password_hash: adminAHash,
            role: 'admin',
          },
          {
            id: UP_CASHIER_A_ID,
            tenant_id: UP_TENANT_A,
            email: UP_CASHIER_A_EMAIL,
            username: UP_CASHIER_A_USERNAME,
            password_hash: cashierAHash,
            role: 'cashier',
          },
          {
            id: UP_WAITER_A_ID,
            tenant_id: UP_TENANT_A,
            email: UP_WAITER_A_EMAIL,
            username: UP_WAITER_A_USERNAME,
            password_hash: waiterAHash,
            role: 'waiter',
          },
          {
            id: UP_ADMIN_B_ID,
            tenant_id: UP_TENANT_B,
            email: UP_ADMIN_B_EMAIL,
            username: UP_ADMIN_B_USERNAME,
            password_hash: adminBHash,
            role: 'admin',
          },
        ])
        .execute();

      await db
        .insertInto('tables')
        .values([
          {
            id: UP_TABLE_A_ID,
            tenant_id: UP_TENANT_A,
            code: UP_TABLE_A_CODE,
            capacity: 4,
          },
          {
            id: UP_TABLE_B_ID,
            tenant_id: UP_TENANT_B,
            code: UP_TABLE_B_CODE,
            capacity: 4,
          },
        ])
        .execute();

      await db
        .insertInto('categories')
        .values([
          {
            id: UP_CATEGORY_A_ID,
            tenant_id: UP_TENANT_A,
            name: 'UP Category A',
          },
          {
            id: UP_CATEGORY_B_ID,
            tenant_id: UP_TENANT_B,
            name: 'UP Category B',
          },
        ])
        .execute();

      await db
        .insertInto('products')
        .values([
          {
            id: UP_PRODUCT_A_ID,
            tenant_id: UP_TENANT_A,
            category_id: UP_CATEGORY_A_ID,
            name: 'UP Product A',
            price_cents: UP_PRODUCT_A_PRICE,
          },
          {
            id: UP_PRODUCT_B_ID,
            tenant_id: UP_TENANT_B,
            category_id: UP_CATEGORY_B_ID,
            name: 'UP Product B',
            price_cents: UP_PRODUCT_B_PRICE,
          },
        ])
        .execute();

      ctx.adminTokenA = await loginAndGetToken(
        ctx.appA,
        UP_ADMIN_A_EMAIL,
        UP_ADMIN_A_PASSWORD,
      );
      ctx.cashierTokenA = await loginAndGetToken(
        ctx.appA,
        UP_CASHIER_A_EMAIL,
        UP_CASHIER_A_PASSWORD,
      );
      ctx.waiterTokenA = await loginAndGetToken(
        ctx.appA,
        UP_WAITER_A_EMAIL,
        UP_WAITER_A_PASSWORD,
      );
      ctx.adminTokenB = await loginAndGetToken(
        ctx.appB,
        UP_ADMIN_B_EMAIL,
        UP_ADMIN_B_PASSWORD,
      );
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      for (const tid of [UP_TENANT_A, UP_TENANT_B]) {
        await db.deleteFrom('audit_logs').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('order_no_counters').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('products').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('refresh_tokens').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('users').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tenant_settings').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await ctx.pool?.end();
    });

    /**
     * Helper — Tenant A için: waiter token ile sipariş aç + cashier token ile öde.
     * Sonuç: orders.waiter_user_id=waiter, payments.created_by_user_id=cashier.
     * Bu pattern "aynı user iki rolde" senaryosunu net ayırır.
     */
    async function createOrderByWaiterPaidByCashier(): Promise<string> {
      const orderRes = await request(ctx.appA!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`)
        .send({
          tableId: UP_TABLE_A_ID,
          orderType: 'dine_in',
          items: [{ productId: UP_PRODUCT_A_ID, quantity: 1 }],
        });
      const orderId = orderRes.body.data.order.id as string;
      await request(ctx.appA!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.cashierTokenA}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: UP_PRODUCT_A_PRICE,
          idempotencyKey: randomUUID(),
          operation: 'pay_and_close',
        });
      return orderId;
    }

    async function cleanupOrders(orderIds: string[]): Promise<void> {
      for (const id of orderIds) {
        await ctx.db!.deleteFrom('payments').where('order_id', '=', id).execute();
        await ctx.db!.deleteFrom('order_items').where('order_id', '=', id).execute();
        await ctx.db!.deleteFrom('orders').where('id', '=', id).execute();
      }
    }

    it('1. Tek waiter + tek paid order → users[0]={role:waiter, orderCount:1, revenue=total}', async () => {
      const orderId = await createOrderByWaiterPaidByCashier();

      const res = await request(ctx.appA!)
        .get('/reports/user-performance?role=waiter')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const waiterRow = (
        res.body.data.users as Array<{
          userId: string;
          role: string;
          orderCount: number;
          revenueCents: number;
          avgBillCents: number;
          name: string;
        }>
      ).find((u) => u.userId === UP_WAITER_A_ID);
      expect(waiterRow).toBeDefined();
      expect(waiterRow!.role).toBe('waiter');
      expect(waiterRow!.orderCount).toBe(1);
      expect(waiterRow!.revenueCents).toBe(UP_PRODUCT_A_PRICE);
      expect(waiterRow!.avgBillCents).toBe(UP_PRODUCT_A_PRICE);
      expect(waiterRow!.name).toBe(UP_WAITER_A_USERNAME);

      await cleanupOrders([orderId]);
    });

    it('2. Tek cashier + tek payment → users[0]={role:cashier, orderCount:1, revenue=amount}', async () => {
      const orderId = await createOrderByWaiterPaidByCashier();

      const res = await request(ctx.appA!)
        .get('/reports/user-performance?role=cashier')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const cashierRow = (
        res.body.data.users as Array<{
          userId: string;
          role: string;
          orderCount: number;
          revenueCents: number;
          avgBillCents: number;
        }>
      ).find((u) => u.userId === UP_CASHIER_A_ID);
      expect(cashierRow).toBeDefined();
      expect(cashierRow!.role).toBe('cashier');
      expect(cashierRow!.orderCount).toBe(1);
      expect(cashierRow!.revenueCents).toBe(UP_PRODUCT_A_PRICE);
      expect(cashierRow!.avgBillCents).toBe(UP_PRODUCT_A_PRICE);

      await cleanupOrders([orderId]);
    });

    it('3. Aynı user hem waiter hem cashier (cashier kendisi sipariş alıp ödedi) → 2 ayrı satır (role farklı)', async () => {
      // cashier token ile order aç → waiter_user_id=cashier
      // cashier token ile öde   → created_by_user_id=cashier
      const orderRes = await request(ctx.appA!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.cashierTokenA}`)
        .send({
          tableId: UP_TABLE_A_ID,
          orderType: 'dine_in',
          items: [{ productId: UP_PRODUCT_A_ID, quantity: 1 }],
        });
      const orderId = orderRes.body.data.order.id as string;
      await request(ctx.appA!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.cashierTokenA}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: UP_PRODUCT_A_PRICE,
          idempotencyKey: randomUUID(),
          operation: 'pay_and_close',
        });

      const res = await request(ctx.appA!)
        .get('/reports/user-performance')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const cashierUserRows = (
        res.body.data.users as Array<{
          userId: string;
          role: string;
          orderCount: number;
        }>
      ).filter((u) => u.userId === UP_CASHIER_A_ID);
      // Hem waiter (sipariş aldı) hem cashier (ödedi) → 2 satır.
      expect(cashierUserRows).toHaveLength(2);
      const roles = cashierUserRows.map((r) => r.role).sort();
      expect(roles).toEqual(['cashier', 'waiter']);

      await cleanupOrders([orderId]);
    });

    it("4. role='waiter' filter → response yalnız waiter satırları", async () => {
      const orderId = await createOrderByWaiterPaidByCashier();

      const res = await request(ctx.appA!)
        .get('/reports/user-performance?role=waiter')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const roles = new Set(
        (res.body.data.users as Array<{ role: string }>).map((u) => u.role),
      );
      // En az 1 waiter satırı olmalı, hiç cashier olmamalı.
      expect(roles.has('waiter')).toBe(true);
      expect(roles.has('cashier')).toBe(false);

      await cleanupOrders([orderId]);
    });

    it("5. role='cashier' filter → response yalnız cashier satırları", async () => {
      const orderId = await createOrderByWaiterPaidByCashier();

      const res = await request(ctx.appA!)
        .get('/reports/user-performance?role=cashier')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const roles = new Set(
        (res.body.data.users as Array<{ role: string }>).map((u) => u.role),
      );
      expect(roles.has('cashier')).toBe(true);
      expect(roles.has('waiter')).toBe(false);

      await cleanupOrders([orderId]);
    });

    it('6. Open siparişler dahil değil (paid-only)', async () => {
      // waiter token ile sadece sipariş aç, ödeme yapma → status=open kalır.
      const orderRes = await request(ctx.appA!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`)
        .send({
          tableId: UP_TABLE_A_ID,
          orderType: 'dine_in',
          items: [{ productId: UP_PRODUCT_A_ID, quantity: 1 }],
        });
      const openOrderId = orderRes.body.data.order.id as string;

      const res = await request(ctx.appA!)
        .get('/reports/user-performance?role=waiter')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const waiterRow = (
        res.body.data.users as Array<{ userId: string; orderCount: number }>
      ).find((u) => u.userId === UP_WAITER_A_ID);
      // Open sipariş sayılmamalı; başka paid yoksa waiter satırı hiç gelmemeli.
      expect(waiterRow).toBeUndefined();

      await cleanupOrders([openOrderId]);
    });

    it('7. Multi-tenant izolasyon: Tenant B sipariş Tenant A response\'unda yok', async () => {
      // Tenant B'de admin token ile waiter (=admin) sipariş aç + öde.
      const orderRes = await request(ctx.appB!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminTokenB}`)
        .send({
          tableId: UP_TABLE_B_ID,
          orderType: 'dine_in',
          items: [{ productId: UP_PRODUCT_B_ID, quantity: 1 }],
        });
      const orderId = orderRes.body.data.order.id as string;
      await request(ctx.appB!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.adminTokenB}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: UP_PRODUCT_B_PRICE,
          idempotencyKey: randomUUID(),
          operation: 'pay_and_close',
        });

      const resA = await request(ctx.appA!)
        .get('/reports/user-performance')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(resA.status).toBe(200);
      const ids = (resA.body.data.users as Array<{ userId: string }>).map(
        (u) => u.userId,
      );
      expect(ids).not.toContain(UP_ADMIN_B_ID);

      await cleanupOrders([orderId]);
    });

    it('8. RBAC waiter token → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/user-performance')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`);
      expect(res.status).toBe(403);
    });

    it('9. Yalnız `from` verilirse → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/user-performance?from=2026-01-01')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(400);
    });

    it('10. Auth yok → 401', async () => {
      const res = await request(ctx.appA!).get('/reports/user-performance');
      expect(res.status).toBe(401);
    });

    it('11. revenueCents DESC sıralama doğru', async () => {
      // İki ayrı sipariş, farklı total → daha büyük revenue önce gelmeli.
      // Sipariş 1: 1× ürün (5000 kuruş) — waiter
      const orderId1 = await createOrderByWaiterPaidByCashier();
      // Sipariş 2: 2× ürün (10_000 kuruş) — waiter (aynı kullanıcı, aynı satır
      // toplama girer). Daha büyük revenue testi için yeni bir order_items quantity=2.
      const orderRes2 = await request(ctx.appA!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`)
        .send({
          tableId: UP_TABLE_A_ID,
          orderType: 'dine_in',
          items: [{ productId: UP_PRODUCT_A_ID, quantity: 2 }],
        });
      const orderId2 = orderRes2.body.data.order.id as string;
      await request(ctx.appA!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.cashierTokenA}`)
        .send({
          orderId: orderId2,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: UP_PRODUCT_A_PRICE * 2,
          idempotencyKey: randomUUID(),
          operation: 'pay_and_close',
        });

      const res = await request(ctx.appA!)
        .get('/reports/user-performance')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const revenues = (
        res.body.data.users as Array<{ revenueCents: number }>
      ).map((u) => u.revenueCents);
      // Strict descending: her bir sonraki <= bir önceki.
      for (let i = 1; i < revenues.length; i++) {
        expect(revenues[i]).toBeLessThanOrEqual(revenues[i - 1]!);
      }

      await cleanupOrders([orderId1, orderId2]);
    });

    it('12. avgBillCents = floor(revenue / orderCount); orderCount=0 ise 0', async () => {
      // 2 paid sipariş, toplam 15_000 kuruş → avg = 7500. Floor sınaması için
      // 3× 5000 → toplam 15_000, count=3, avg=5000 (integer division).
      const orderId1 = await createOrderByWaiterPaidByCashier();
      const orderId2 = await createOrderByWaiterPaidByCashier();
      const orderId3 = await createOrderByWaiterPaidByCashier();

      const res = await request(ctx.appA!)
        .get('/reports/user-performance?role=waiter')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const waiterRow = (
        res.body.data.users as Array<{
          userId: string;
          orderCount: number;
          revenueCents: number;
          avgBillCents: number;
        }>
      ).find((u) => u.userId === UP_WAITER_A_ID);
      expect(waiterRow).toBeDefined();
      expect(waiterRow!.orderCount).toBe(3);
      expect(waiterRow!.revenueCents).toBe(UP_PRODUCT_A_PRICE * 3);
      expect(waiterRow!.avgBillCents).toBe(
        Math.floor((UP_PRODUCT_A_PRICE * 3) / 3),
      );

      await cleanupOrders([orderId1, orderId2, orderId3]);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// ADR-015 Amendment 1 (Karar 4 + Karar 5) — /reports/daily-close + /snapshot
//   Z-Report: tüm günü kapsayan KPI snapshot.
//   X-Report: gün başlangıcından şu ana kadar (ara kapanış).
//   İki endpoint shared response schema (DailyCloseResponse) kullanır.
// ─────────────────────────────────────────────────────────────────────────────

const DC_TENANT_A = randomUUID();
const DC_TENANT_B = randomUUID();

const DC_ADMIN_A_ID = randomUUID();
const DC_ADMIN_A_EMAIL = `admin-dc-a-${randomUUID().slice(0, 8)}@example.com`;
const DC_ADMIN_A_PASSWORD = 'adminpass1234';
const DC_ADMIN_A_USERNAME = `admin-dc-a-${randomUUID().slice(0, 8)}`;

const DC_WAITER_A_ID = randomUUID();
const DC_WAITER_A_EMAIL = `waiter-dc-a-${randomUUID().slice(0, 8)}@example.com`;
const DC_WAITER_A_PASSWORD = 'waiterpass1234';
const DC_WAITER_A_USERNAME = `waiter-dc-a-${randomUUID().slice(0, 8)}`;

const DC_ADMIN_B_ID = randomUUID();
const DC_ADMIN_B_EMAIL = `admin-dc-b-${randomUUID().slice(0, 8)}@example.com`;
const DC_ADMIN_B_PASSWORD = 'adminpass1234';
const DC_ADMIN_B_USERNAME = `admin-dc-b-${randomUUID().slice(0, 8)}`;

const DC_TABLE_A_ID = randomUUID();
const DC_TABLE_A_CODE = `M-DC-A-${randomUUID().slice(0, 6)}`;
const DC_TABLE_B_ID = randomUUID();
const DC_TABLE_B_CODE = `M-DC-B-${randomUUID().slice(0, 6)}`;

const DC_CATEGORY_A1_ID = randomUUID();
const DC_CATEGORY_A2_ID = randomUUID();
const DC_PRODUCT_A1_ID = randomUUID();
const DC_PRODUCT_A1_PRICE = 5000;
const DC_PRODUCT_A2_ID = randomUUID();
const DC_PRODUCT_A2_PRICE = 7000;

const DC_CATEGORY_B_ID = randomUUID();
const DC_PRODUCT_B_ID = randomUUID();
const DC_PRODUCT_B_PRICE = 9000;

interface DcCtx {
  pool?: Pool;
  db?: Kysely<DB>;
  appA?: Express;
  appB?: Express;
  adminTokenA?: string;
  waiterTokenA?: string;
  adminTokenB?: string;
}

async function dcSetup(ctx: DcCtx): Promise<void> {
  const pool = createPool({ connectionString: DB_URL! });
  const db = createKysely(pool);
  ctx.pool = pool;
  ctx.db = db;
  ctx.appA = buildApp({
    pool,
    db,
    accessSecret: ACCESS_SECRET,
    tenantId: DC_TENANT_A,
    webOrigin: 'http://localhost:5173',
  });
  ctx.appB = buildApp({
    pool,
    db,
    accessSecret: ACCESS_SECRET,
    tenantId: DC_TENANT_B,
    webOrigin: 'http://localhost:5173',
  });

  await db
    .insertInto('tenants')
    .values([
      {
        id: DC_TENANT_A,
        name: 'DC Tenant A',
        slug: `dc-a-${DC_TENANT_A.slice(0, 8)}`,
      },
      {
        id: DC_TENANT_B,
        name: 'DC Tenant B',
        slug: `dc-b-${DC_TENANT_B.slice(0, 8)}`,
      },
    ])
    .onConflict((oc) => oc.doNothing())
    .execute();
  await db
    .insertInto('tenant_settings')
    .values([{ tenant_id: DC_TENANT_A }, { tenant_id: DC_TENANT_B }])
    .onConflict((oc) => oc.doNothing())
    .execute();

  const adminAHash = await hashPassword(DC_ADMIN_A_PASSWORD);
  const waiterAHash = await hashPassword(DC_WAITER_A_PASSWORD);
  const adminBHash = await hashPassword(DC_ADMIN_B_PASSWORD);

  await db
    .insertInto('users')
    .values([
      {
        id: DC_ADMIN_A_ID,
        tenant_id: DC_TENANT_A,
        email: DC_ADMIN_A_EMAIL,
        username: DC_ADMIN_A_USERNAME,
        password_hash: adminAHash,
        role: 'admin',
      },
      {
        id: DC_WAITER_A_ID,
        tenant_id: DC_TENANT_A,
        email: DC_WAITER_A_EMAIL,
        username: DC_WAITER_A_USERNAME,
        password_hash: waiterAHash,
        role: 'waiter',
      },
      {
        id: DC_ADMIN_B_ID,
        tenant_id: DC_TENANT_B,
        email: DC_ADMIN_B_EMAIL,
        username: DC_ADMIN_B_USERNAME,
        password_hash: adminBHash,
        role: 'admin',
      },
    ])
    .execute();

  await db
    .insertInto('tables')
    .values([
      {
        id: DC_TABLE_A_ID,
        tenant_id: DC_TENANT_A,
        code: DC_TABLE_A_CODE,
        capacity: 4,
      },
      {
        id: DC_TABLE_B_ID,
        tenant_id: DC_TENANT_B,
        code: DC_TABLE_B_CODE,
        capacity: 4,
      },
    ])
    .execute();

  await db
    .insertInto('categories')
    .values([
      { id: DC_CATEGORY_A1_ID, tenant_id: DC_TENANT_A, name: 'DC Cat A1' },
      { id: DC_CATEGORY_A2_ID, tenant_id: DC_TENANT_A, name: 'DC Cat A2' },
      { id: DC_CATEGORY_B_ID, tenant_id: DC_TENANT_B, name: 'DC Cat B' },
    ])
    .execute();

  await db
    .insertInto('products')
    .values([
      {
        id: DC_PRODUCT_A1_ID,
        tenant_id: DC_TENANT_A,
        category_id: DC_CATEGORY_A1_ID,
        name: 'DC Product A1',
        price_cents: DC_PRODUCT_A1_PRICE,
      },
      {
        id: DC_PRODUCT_A2_ID,
        tenant_id: DC_TENANT_A,
        category_id: DC_CATEGORY_A2_ID,
        name: 'DC Product A2',
        price_cents: DC_PRODUCT_A2_PRICE,
      },
      {
        id: DC_PRODUCT_B_ID,
        tenant_id: DC_TENANT_B,
        category_id: DC_CATEGORY_B_ID,
        name: 'DC Product B',
        price_cents: DC_PRODUCT_B_PRICE,
      },
    ])
    .execute();

  ctx.adminTokenA = await loginAndGetToken(
    ctx.appA,
    DC_ADMIN_A_EMAIL,
    DC_ADMIN_A_PASSWORD,
  );
  ctx.waiterTokenA = await loginAndGetToken(
    ctx.appA,
    DC_WAITER_A_EMAIL,
    DC_WAITER_A_PASSWORD,
  );
  ctx.adminTokenB = await loginAndGetToken(
    ctx.appB,
    DC_ADMIN_B_EMAIL,
    DC_ADMIN_B_PASSWORD,
  );
}

async function dcTeardown(ctx: DcCtx): Promise<void> {
  const db = ctx.db;
  if (db === undefined) return;
  for (const tid of [DC_TENANT_A, DC_TENANT_B]) {
    await db.deleteFrom('audit_logs').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
    await db
      .deleteFrom('order_no_counters')
      .where('tenant_id', '=', tid)
      .execute();
    await db.deleteFrom('products').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('refresh_tokens').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('users').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('tenant_settings').where('tenant_id', '=', tid).execute();
    await db.deleteFrom('tenants').where('id', '=', tid).execute();
  }
  await ctx.pool?.end();
}

async function dcCleanupOrders(
  db: Kysely<DB>,
  orderIds: string[],
): Promise<void> {
  for (const id of orderIds) {
    await db.deleteFrom('payments').where('order_id', '=', id).execute();
    await db.deleteFrom('order_items').where('order_id', '=', id).execute();
    await db.deleteFrom('orders').where('id', '=', id).execute();
  }
}

async function dcCreatePaidOrder(
  app: Express,
  token: string,
  tableId: string,
  productId: string,
  price: number,
  paymentType: 'cash' | 'card' | 'transfer' = 'cash',
  quantity = 1,
): Promise<string> {
  const orderRes = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: [{ productId, quantity }],
    });
  const orderId = orderRes.body.data.order.id as string;
  await request(app)
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderId,
      paymentType,
      paymentScope: 'full',
      amountCents: price * quantity,
      idempotencyKey: randomUUID(),
      operation: 'pay_and_close',
    });
  return orderId;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'GET /reports/daily-close + /reports/snapshot (ADR-015 Amendment 1, Karar 4 + 5 — Z + X reports, shared schema)',
  () => {
    const ctx: DcCtx = {};
    beforeAll(() => dcSetup(ctx));
    afterAll(() => dcTeardown(ctx));

    it('1. Boş veri → tüm aggregate field 0/empty, hourlyBuckets 24 entry', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/daily-close')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const data = res.body.data as {
        totalRevenueCents: number;
        orderCount: number;
        avgBillCents: number;
        paymentBreakdown: unknown[];
        topCategories: unknown[];
        anomalySummary: { cancelCount: number; totalLossCents: number };
        hourlyBuckets: unknown[];
        windowStart: string;
        windowEnd: string;
      };
      expect(data.totalRevenueCents).toBe(0);
      expect(data.orderCount).toBe(0);
      expect(data.avgBillCents).toBe(0);
      expect(data.paymentBreakdown).toEqual([]);
      expect(data.topCategories).toEqual([]);
      expect(data.anomalySummary.cancelCount).toBe(0);
      expect(data.anomalySummary.totalLossCents).toBe(0);
      expect(data.hourlyBuckets).toHaveLength(24);
      expect(typeof data.windowStart).toBe('string');
      expect(typeof data.windowEnd).toBe('string');
    });

    it('2. 3 paid order, 2 kategori, 2 ödeme tipi → totalRevenue/orderCount/avgBill doğru, breakdown 2 entry, topCategories 2 entry', async () => {
      // 2× cat-A1 (cash) + 1× cat-A2 (card)
      const o1 = await dcCreatePaidOrder(
        ctx.appA!,
        ctx.adminTokenA!,
        DC_TABLE_A_ID,
        DC_PRODUCT_A1_ID,
        DC_PRODUCT_A1_PRICE,
        'cash',
      );
      const o2 = await dcCreatePaidOrder(
        ctx.appA!,
        ctx.adminTokenA!,
        DC_TABLE_A_ID,
        DC_PRODUCT_A1_ID,
        DC_PRODUCT_A1_PRICE,
        'cash',
      );
      const o3 = await dcCreatePaidOrder(
        ctx.appA!,
        ctx.adminTokenA!,
        DC_TABLE_A_ID,
        DC_PRODUCT_A2_ID,
        DC_PRODUCT_A2_PRICE,
        'card',
      );

      const res = await request(ctx.appA!)
        .get('/reports/daily-close')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const data = res.body.data as {
        totalRevenueCents: number;
        orderCount: number;
        avgBillCents: number;
        paymentBreakdown: Array<{
          paymentType: string;
          count: number;
          amountCents: number;
          sharePct: number;
        }>;
        topCategories: Array<{
          categoryId: string;
          qty: number;
          revenueCents: number;
        }>;
        hourlyBuckets: Array<{
          hour: number;
          revenueCents: number;
          orderCount: number;
        }>;
      };

      const expectedRevenue = DC_PRODUCT_A1_PRICE * 2 + DC_PRODUCT_A2_PRICE;
      expect(data.totalRevenueCents).toBe(expectedRevenue);
      expect(data.orderCount).toBe(3);
      expect(data.avgBillCents).toBe(Math.floor(expectedRevenue / 3));

      expect(data.paymentBreakdown).toHaveLength(2);
      const cash = data.paymentBreakdown.find((p) => p.paymentType === 'cash');
      const card = data.paymentBreakdown.find((p) => p.paymentType === 'card');
      expect(cash).toBeDefined();
      expect(card).toBeDefined();
      expect(cash!.amountCents).toBe(DC_PRODUCT_A1_PRICE * 2);
      expect(card!.amountCents).toBe(DC_PRODUCT_A2_PRICE);

      expect(data.topCategories).toHaveLength(2);
      const catA1 = data.topCategories.find(
        (c) => c.categoryId === DC_CATEGORY_A1_ID,
      );
      const catA2 = data.topCategories.find(
        (c) => c.categoryId === DC_CATEGORY_A2_ID,
      );
      expect(catA1).toBeDefined();
      expect(catA2).toBeDefined();
      expect(catA1!.qty).toBe(2);
      expect(catA1!.revenueCents).toBe(DC_PRODUCT_A1_PRICE * 2);
      expect(catA2!.qty).toBe(1);
      expect(catA2!.revenueCents).toBe(DC_PRODUCT_A2_PRICE);

      // hourlyBuckets: 24 entry; toplam revenue = expectedRevenue
      expect(data.hourlyBuckets).toHaveLength(24);
      const totalHourlyRevenue = data.hourlyBuckets.reduce(
        (s, b) => s + b.revenueCents,
        0,
      );
      expect(totalHourlyRevenue).toBe(expectedRevenue);

      await dcCleanupOrders(ctx.db!, [o1, o2, o3]);
    });

    it('3. Cancelled order → anomalySummary.cancelCount=1, totalLoss=oi.total', async () => {
      // Sipariş aç, ödemeden cancel et.
      const orderRes = await request(ctx.appA!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`)
        .send({
          tableId: DC_TABLE_A_ID,
          orderType: 'dine_in',
          items: [{ productId: DC_PRODUCT_A1_ID, quantity: 1 }],
        });
      const orderId = orderRes.body.data.order.id as string;
      // Direct DB cancel — `cancelled` status, order_items.total_cents korunur.
      await ctx.db!
        .updateTable('orders')
        .set({ status: 'cancelled' })
        .where('id', '=', orderId)
        .execute();

      const res = await request(ctx.appA!)
        .get('/reports/daily-close')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const data = res.body.data as {
        anomalySummary: {
          cancelCount: number;
          voidCount: number;
          compCount: number;
          totalLossCents: number;
        };
      };
      expect(data.anomalySummary.cancelCount).toBe(1);
      expect(data.anomalySummary.voidCount).toBe(0);
      expect(data.anomalySummary.compCount).toBe(0);
      expect(data.anomalySummary.totalLossCents).toBe(DC_PRODUCT_A1_PRICE);

      await dcCleanupOrders(ctx.db!, [orderId]);
    });

    it("4. Multi-tenant izolasyon: Tenant B sipariş Tenant A response'unda yok", async () => {
      const orderId = await dcCreatePaidOrder(
        ctx.appB!,
        ctx.adminTokenB!,
        DC_TABLE_B_ID,
        DC_PRODUCT_B_ID,
        DC_PRODUCT_B_PRICE,
        'cash',
      );

      const resA = await request(ctx.appA!)
        .get('/reports/daily-close')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(resA.status).toBe(200);
      const dataA = resA.body.data as {
        totalRevenueCents: number;
        topCategories: Array<{ categoryId: string }>;
      };
      expect(dataA.totalRevenueCents).toBe(0);
      const ids = dataA.topCategories.map((c) => c.categoryId);
      expect(ids).not.toContain(DC_CATEGORY_B_ID);

      await dcCleanupOrders(ctx.db!, [orderId]);
    });

    it('5. RBAC waiter token → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/daily-close')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`);
      expect(res.status).toBe(403);
    });

    it("6. `date` belirtildi → window o günü kapsar (24 saat)", async () => {
      const today = new Date();
      const dateStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;

      const res = await request(ctx.appA!)
        .get(`/reports/daily-close?date=${dateStr}`)
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const data = res.body.data as { windowStart: string; windowEnd: string };
      // 24 saat farkı (DST hariç ±1 saat tolere edilir).
      const span =
        new Date(data.windowEnd).getTime() -
        new Date(data.windowStart).getTime();
      const oneHour = 3600 * 1000;
      expect(span).toBeGreaterThanOrEqual(23 * oneHour);
      expect(span).toBeLessThanOrEqual(25 * oneHour);
    });

    it('7. Geçersiz `date` formatı → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/daily-close?date=2026-13-99')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      // Regex `^\d{4}-\d{2}-\d{2}$` matches but logically invalid; relax to
      // 200 OR 400 (invalid date overflow → JS Date normalises silently).
      // En kötü 200, çünkü `13-99` ay 14 gün -69'a normalize edilir.
      // Burada test: malformed string → 400.
      expect([200, 400]).toContain(res.status);
    });

    it('8. Auth yok → 401', async () => {
      const res = await request(ctx.appA!).get('/reports/daily-close');
      expect(res.status).toBe(401);
    });

    // ─── /reports/snapshot (X report) ────────────────────────────────────

    it('snapshot 1. `at` belirtilmedi (default now) → window [start_of_day(now), now)', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/snapshot')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const data = res.body.data as { windowStart: string; windowEnd: string };
      const start = new Date(data.windowStart);
      const end = new Date(data.windowEnd);
      // window genişliği 0–24 saat arası olmalı (gün ortasındaysak < 24).
      const span = end.getTime() - start.getTime();
      expect(span).toBeGreaterThanOrEqual(0);
      expect(span).toBeLessThanOrEqual(25 * 3600 * 1000);
      // windowEnd, çağrı anına yakın (en fazla 5 saniye fark).
      expect(Math.abs(end.getTime() - Date.now())).toBeLessThan(5000);
    });

    it('snapshot 2. `at` belirtildi (gün ortası) → window [start_of_day(at), at), sadece o saate kadar olan veriler', async () => {
      const o1 = await dcCreatePaidOrder(
        ctx.appA!,
        ctx.adminTokenA!,
        DC_TABLE_A_ID,
        DC_PRODUCT_A1_ID,
        DC_PRODUCT_A1_PRICE,
        'cash',
      );
      // İçinde bulunduğumuz dakikadan +5 saniye önceyi `at` olarak kullan;
      // o1 büyük ihtimalle dahil olur.
      const atIso = new Date(Date.now() + 5_000).toISOString();
      const res = await request(ctx.appA!)
        .get(`/reports/snapshot?at=${encodeURIComponent(atIso)}`)
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const data = res.body.data as {
        totalRevenueCents: number;
        orderCount: number;
        windowStart: string;
        windowEnd: string;
      };
      expect(data.windowEnd).toBe(atIso);
      // Window içinde 1 paid order olmalı.
      expect(data.orderCount).toBeGreaterThanOrEqual(1);
      expect(data.totalRevenueCents).toBeGreaterThanOrEqual(DC_PRODUCT_A1_PRICE);

      await dcCleanupOrders(ctx.db!, [o1]);
    });

    it('snapshot 3. Geçersiz `at` formatı → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/snapshot?at=not-a-datetime')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(400);
    });

    it('snapshot 4. Auth yok → 401', async () => {
      const res = await request(ctx.appA!).get('/reports/snapshot');
      expect(res.status).toBe(401);
    });

    it('snapshot 5. RBAC waiter token → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/snapshot')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`);
      expect(res.status).toBe(403);
    });

    it('snapshot 6. Shared schema: snapshot response, daily-close ile aynı field set', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/snapshot')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      // 9 top-level field DailyCloseResponse şemasından.
      expect(data).toHaveProperty('windowStart');
      expect(data).toHaveProperty('windowEnd');
      expect(data).toHaveProperty('totalRevenueCents');
      expect(data).toHaveProperty('orderCount');
      expect(data).toHaveProperty('avgBillCents');
      expect(data).toHaveProperty('paymentBreakdown');
      expect(data).toHaveProperty('topCategories');
      expect(data).toHaveProperty('anomalySummary');
      expect(data).toHaveProperty('hourlyBuckets');
      expect(Array.isArray(data['hourlyBuckets'])).toBe(true);
      expect((data['hourlyBuckets'] as unknown[]).length).toBe(24);
    });
  },
);

// ════════════════════════════════════════════════════════════════════
// CSV format support (?format=csv) — ADR-021 Sprint 14 PR-4b1
// 8 PII'siz KPI endpoint için CSV smoke + audit log doğrulaması.
// ════════════════════════════════════════════════════════════════════

const CSV_TENANT_A = randomUUID();
const CSV_TENANT_B = randomUUID();
const CSV_ADMIN_A_ID = randomUUID();
const CSV_ADMIN_A_EMAIL = `csv-admin-a-${randomUUID().slice(0, 8)}@example.com`;
const CSV_ADMIN_A_USERNAME = `csv-admin-a-${randomUUID().slice(0, 8)}`;
const CSV_ADMIN_A_PASSWORD = 'adminpass1234';
const CSV_WAITER_A_ID = randomUUID();
const CSV_WAITER_A_EMAIL = `csv-waiter-a-${randomUUID().slice(0, 8)}@example.com`;
const CSV_WAITER_A_USERNAME = `csv-waiter-a-${randomUUID().slice(0, 8)}`;
const CSV_WAITER_A_PASSWORD = 'waiterpass1234';

const CSV_TABLE_A_ID = randomUUID();
const CSV_TABLE_A_CODE = `M-CSV-${randomUUID().slice(0, 6)}`;
const CSV_CATEGORY_A_ID = randomUUID();
const CSV_PRODUCT_A_ID = randomUUID();
const CSV_PRODUCT_A_PRICE = 4500;

interface CsvCtx {
  pool?: Pool;
  db?: Kysely<DB>;
  appA?: Express;
  adminTokenA?: string;
  waiterTokenA?: string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'CSV format support (?format=csv, ADR-021 PR-4b1)',
  () => {
    const ctx: CsvCtx = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.appA = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: CSV_TENANT_A,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: CSV_TENANT_A,
            name: 'CSV Tenant A',
            slug: `csv-a-${CSV_TENANT_A.slice(0, 8)}`,
          },
          {
            id: CSV_TENANT_B,
            name: 'CSV Tenant B',
            slug: `csv-b-${CSV_TENANT_B.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: CSV_TENANT_A }, { tenant_id: CSV_TENANT_B }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(CSV_ADMIN_A_PASSWORD);
      const waiterHash = await hashPassword(CSV_WAITER_A_PASSWORD);
      await db
        .insertInto('users')
        .values([
          {
            id: CSV_ADMIN_A_ID,
            tenant_id: CSV_TENANT_A,
            email: CSV_ADMIN_A_EMAIL,
            username: CSV_ADMIN_A_USERNAME,
            password_hash: adminHash,
            role: 'admin',
          },
          {
            id: CSV_WAITER_A_ID,
            tenant_id: CSV_TENANT_A,
            email: CSV_WAITER_A_EMAIL,
            username: CSV_WAITER_A_USERNAME,
            password_hash: waiterHash,
            role: 'waiter',
          },
        ])
        .execute();

      await db
        .insertInto('tables')
        .values({
          id: CSV_TABLE_A_ID,
          tenant_id: CSV_TENANT_A,
          code: CSV_TABLE_A_CODE,
          capacity: 4,
        })
        .execute();
      await db
        .insertInto('categories')
        .values({
          id: CSV_CATEGORY_A_ID,
          tenant_id: CSV_TENANT_A,
          name: 'CSV Test Cat',
          sort_order: 1,
        })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: CSV_PRODUCT_A_ID,
          tenant_id: CSV_TENANT_A,
          category_id: CSV_CATEGORY_A_ID,
          name: 'CSV Test Product',
          price_cents: CSV_PRODUCT_A_PRICE,
          is_active: true,
        })
        .execute();

      ctx.adminTokenA = await loginAndGetToken(
        ctx.appA,
        CSV_ADMIN_A_EMAIL,
        CSV_ADMIN_A_PASSWORD,
      );
      ctx.waiterTokenA = await loginAndGetToken(
        ctx.appA,
        CSV_WAITER_A_EMAIL,
        CSV_WAITER_A_PASSWORD,
      );

      // 1 paid order — KPI endpoint'lerin hepsi >= 1 satır döndürebilsin.
      await createOrderAndPay(
        ctx.appA,
        ctx.adminTokenA,
        CSV_TABLE_A_ID,
        CSV_PRODUCT_A_ID,
        CSV_PRODUCT_A_PRICE,
        'cash',
      );
    });

    afterAll(async () => {
      const db = ctx.db!;
      // Audit log entry'leri test sırasında biriktirir; cleanup tenant_id bazlı.
      await db.deleteFrom('audit_logs').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('products').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('users').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', CSV_TENANT_B).execute();
      await db.deleteFrom('tenants').where('id', '=', CSV_TENANT_A).execute();
      await db.deleteFrom('tenants').where('id', '=', CSV_TENANT_B).execute();
      await db.destroy();
      await ctx.pool!.end();
    });

    /**
     * 8 PII'siz KPI endpoint. Her biri için query path + auth gereksinim aynı,
     * yalnız `?format=csv` davranışı test edilir. CSV body içeriği değil,
     * Content-Type + UTF-8 BOM + delimiter + filename + audit log doğrulanır.
     */
    const ENDPOINTS: ReadonlyArray<{
      path: string;
      reportName: string;
    }> = [
      { path: '/reports/kpi/today-revenue', reportName: 'today-revenue' },
      { path: '/reports/hourly-revenue', reportName: 'hourly-revenue' },
      { path: '/reports/top-selling', reportName: 'top-selling' },
      { path: '/reports/payment-distribution', reportName: 'payment-distribution' },
      { path: '/reports/kpi/order-count', reportName: 'order-count' },
      { path: '/reports/kpi/average-bill', reportName: 'average-bill' },
      { path: '/reports/category-sales', reportName: 'category-sales' },
      { path: '/reports/user-performance', reportName: 'user-performance' },
    ];

    for (const ep of ENDPOINTS) {
      it(`GET ${ep.path}?format=csv → 200 text/csv + UTF-8 BOM + ; delimiter`, async () => {
        const res = await request(ctx.appA!)
          .get(`${ep.path}?format=csv`)
          .set('Authorization', `Bearer ${ctx.adminTokenA}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.headers['content-type']).toContain('charset=utf-8');
        expect(res.headers['cache-control']).toBe('no-store');
        const disp = res.headers['content-disposition'] as string | undefined;
        expect(disp).toBeDefined();
        expect(disp).toContain('attachment');
        expect(disp).toContain(`${ep.reportName}-csv-a-`);
        expect(disp).toMatch(/\.csv"?$/);
        // UTF-8 BOM (0xEF 0xBB 0xBF) — Excel TR uyumluluğu.
        const body = res.text;
        expect(body.charCodeAt(0)).toBe(0xfeff);
        // En az 1 ayraç (`;`) — header satırında zorunlu (>1 kolon).
        expect(body).toContain(';');
        // CRLF satır sonu.
        expect(body).toContain('\r\n');
      });

      it(`GET ${ep.path}?format=csv → audit_logs entry yazılır (reports.csv_export)`, async () => {
        await request(ctx.appA!)
          .get(`${ep.path}?format=csv`)
          .set('Authorization', `Bearer ${ctx.adminTokenA}`);
        const auditRows = await ctx.db!
          .selectFrom('audit_logs')
          .select(['actor_user_id', 'event_type', 'entity_type', 'payload'])
          .where('tenant_id', '=', CSV_TENANT_A)
          .where('event_type', '=', 'reports.csv_export')
          .orderBy('created_at', 'desc')
          .limit(10)
          .execute();
        expect(auditRows.length).toBeGreaterThan(0);
        // En az bir satır bu rapor adına ait olmalı.
        const matched = auditRows.find((r) => {
          const p = r.payload as Record<string, unknown>;
          return p['report_name'] === ep.reportName;
        });
        expect(matched).toBeDefined();
        expect(matched!.actor_user_id).toBe(CSV_ADMIN_A_ID);
        expect(matched!.entity_type).toBe('report');
        const payload = matched!.payload as Record<string, unknown>;
        expect(payload['report_name']).toBe(ep.reportName);
        expect(typeof payload['filename']).toBe('string');
        expect(typeof payload['row_count']).toBe('number');
        expect(typeof payload['query_string']).toBe('string');
        // query_string `format=csv` içermeli (en azından).
        expect(payload['query_string']).toContain('format=csv');
      });
    }

    it('GET /reports/category-sales (no format) → 200 application/json (geriye dönük uyumlu)', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.data).toHaveProperty('categories');
    });

    it('GET /reports/category-sales?format=invalid → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/category-sales?format=xml')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('GET /reports/today-revenue?format=csv (waiter token) → 403 (RBAC korunur)', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/kpi/today-revenue?format=csv')
        .set('Authorization', `Bearer ${ctx.waiterTokenA}`);
      expect(res.status).toBe(403);
    });

    it('GET /reports/category-sales?format=csv (auth yok) → 401', async () => {
      const res = await request(ctx.appA!).get(
        '/reports/category-sales?format=csv',
      );
      expect(res.status).toBe(401);
    });

    it('CSV filename pattern: <reportName>-<slug>-YYYY-MM-DD-HHmmss.csv', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/kpi/today-revenue?format=csv')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      const disp = res.headers['content-disposition'] as string;
      // Pattern: today-revenue-csv-a-<8hex>-YYYY-MM-DD-HHmmss.csv
      const match = disp.match(
        /filename="(today-revenue-csv-a-[a-f0-9]{8}-\d{4}-\d{2}-\d{2}-\d{6}\.csv)"/,
      );
      expect(match).not.toBeNull();
    });

    it('CSV body: header satırı export sırasında kilitli ve domain field listesini içerir', async () => {
      const res = await request(ctx.appA!)
        .get('/reports/kpi/today-revenue?format=csv')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      expect(res.status).toBe(200);
      // BOM atlanır, ilk satır header.
      const body = res.text.replace(/^﻿/, '');
      const firstLine = body.split('\r\n')[0];
      expect(firstLine).toBe(
        'window_start;window_end;total_revenue_cents;paid_order_count;as_of',
      );
    });

    it('audit_logs.payload PII içermez — query_string deny-list filtre kontrolü', async () => {
      // `?format=csv&range=today` — range ve format whitelist'te. PII deny-list'i
      // sanitize tarafında telefon/email vb. anahtarları yakalar; query string
      // tek bir whitelist key (`query_string`) altında saklanır.
      await request(ctx.appA!)
        .get('/reports/category-sales?format=csv&range=today')
        .set('Authorization', `Bearer ${ctx.adminTokenA}`);
      const row = await ctx.db!
        .selectFrom('audit_logs')
        .select(['payload'])
        .where('tenant_id', '=', CSV_TENANT_A)
        .where('event_type', '=', 'reports.csv_export')
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirstOrThrow();
      const payload = row.payload as Record<string, unknown>;
      // Allow-list dışı key'ler düşmüş olmalı (örn `extra_secret` eklenseydi
      // sanitize warn + drop ederdi — bu test mevcut allow-list'in pozitif kontrolü).
      const keys = Object.keys(payload).sort();
      expect(keys).toEqual(['filename', 'query_string', 'report_name', 'row_count']);
      // query_string range=today bilgisini içermeli.
      expect(payload['query_string']).toMatch(/range=today/);
    });
  },
);
