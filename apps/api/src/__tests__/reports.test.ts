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
