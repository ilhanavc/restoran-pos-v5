import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

// Limiter bypass'ları import-time (buildApp limiter'ı construction'da yakalar).
process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';
process.env['E2E_BYPASS_REPORTS_LIMIT'] = '1';

/**
 * ADR-026 Amendment 5 K6 — GET /reports/kpi/open-orders-total integration testleri.
 *
 * Senaryolar:
 *   1. Açık dine_in + açık takeaway + kısmi ödemeli açık sipariş → toplam KALAN
 *      doğru; `paid` sipariş toplamda YOK (paket dahil olduğu aynı testte kanıtlanır)
 *   2. Void edilmiş ödeme kalanı AZALTMAZ (ADR-033 `voided_at IS NULL`)
 *   3. Negatif clamp — fazla tahsilatlı (legacy) sipariş 0 katkı verir, eksiye düşmez
 *   4. RBAC: waiter 403, kitchen 403, cashier 200
 *   5. Multi-tenant izolasyon: tenant B'nin açık siparişi A'nın toplamına girmez
 *
 * Fixture izolasyonu: kendi tenant'ı + kendi masaları (paylaşılan masa yok) —
 * diğer suite'lerin açık siparişleri toplamı kirletemez.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

const ADMIN_A_ID = randomUUID();
const ADMIN_A_EMAIL = `admin-oot-a-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_A_USERNAME = `admin-oot-a-${randomUUID().slice(0, 8)}`;
const ADMIN_A_PASSWORD = 'adminpass1234';

const CASHIER_A_ID = randomUUID();
const CASHIER_A_EMAIL = `cashier-oot-a-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_A_USERNAME = `cashier-oot-a-${randomUUID().slice(0, 8)}`;
const CASHIER_A_PASSWORD = 'cashierpass1234';

const WAITER_A_ID = randomUUID();
const WAITER_A_EMAIL = `waiter-oot-a-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_A_USERNAME = `waiter-oot-a-${randomUUID().slice(0, 8)}`;
const WAITER_A_PASSWORD = 'waiterpass1234';

const KITCHEN_A_ID = randomUUID();
const KITCHEN_A_EMAIL = `kitchen-oot-a-${randomUUID().slice(0, 8)}@example.com`;
const KITCHEN_A_USERNAME = `kitchen-oot-a-${randomUUID().slice(0, 8)}`;
const KITCHEN_A_PASSWORD = 'kitchenpass1234';

const ADMIN_B_ID = randomUUID();
const ADMIN_B_EMAIL = `admin-oot-b-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_B_USERNAME = `admin-oot-b-${randomUUID().slice(0, 8)}`;
const ADMIN_B_PASSWORD = 'adminpass1234';

const CATEGORY_A_ID = randomUUID();
const PRODUCT_A_ID = randomUUID();
const PRICE = 5000; // kuruş

const CATEGORY_B_ID = randomUUID();
const PRODUCT_B_ID = randomUUID();

const CUSTOMER_A_ID = randomUUID(); // takeaway → customer_id NOT NULL (Migration 031)
const CUSTOMER_B_ID = randomUUID();

/** 4 ayrı dine_in masası — bir masada aynı anda tek aktif sipariş invariantı. */
const TABLES = [1, 2, 3, 4, 5].map(() => ({
  id: randomUUID(),
  code: `M-OOT-${randomUUID().slice(0, 6)}`,
}));

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  appA?: Express;
  appB?: Express;
  adminToken?: string;
  cashierToken?: string;
  waiterToken?: string;
  kitchenToken?: string;
  adminTokenB?: string;
}

const ctx: Ctx = {};

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

/** Açık dine_in sipariş (ödemesiz). Döner: orderId. */
async function createDineInOrder(
  tableId: string,
  quantity: number,
): Promise<string> {
  const res = await request(ctx.appA!)
    .post('/orders')
    .set('Authorization', `Bearer ${ctx.cashierToken!}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: [{ productId: PRODUCT_A_ID, quantity }],
    });
  if (res.status !== 201) {
    throw new Error(
      `dine_in create failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.order.id as string;
}

/** Açık takeaway sipariş (ödemesiz). Döner: orderId. */
async function createTakeawayOrder(quantity: number): Promise<string> {
  const res = await request(ctx.appA!)
    .post('/orders')
    .set('Authorization', `Bearer ${ctx.cashierToken!}`)
    .send({
      type: 'takeaway',
      customerId: CUSTOMER_A_ID,
      plannedPaymentType: 'cash',
      items: [{ productId: PRODUCT_A_ID, quantity }],
    });
  if (res.status !== 201) {
    throw new Error(
      `takeaway create failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.id as string;
}

/** Kısmi ödeme (sipariş açık kalır). Döner: paymentId. */
async function payPartial(
  orderId: string,
  amountCents: number,
): Promise<string> {
  const res = await request(ctx.appA!)
    .post('/payments')
    .set('Authorization', `Bearer ${ctx.cashierToken!}`)
    .send({
      orderId,
      paymentType: 'cash',
      paymentScope: 'partial',
      amountCents,
      idempotencyKey: randomUUID(),
      operation: 'pay',
    });
  if (res.status !== 201) {
    throw new Error(
      `payPartial failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.payment.id as string;
}

/** Tam ödeme + kapat → sipariş `paid` olur. */
async function payAndClose(orderId: string, amountCents: number): Promise<void> {
  const res = await request(ctx.appA!)
    .post('/payments')
    .set('Authorization', `Bearer ${ctx.cashierToken!}`)
    .send({
      orderId,
      paymentType: 'cash',
      paymentScope: 'full',
      amountCents,
      idempotencyKey: randomUUID(),
      operation: 'pay_and_close',
    });
  if (res.status !== 201) {
    throw new Error(
      `payAndClose failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

async function fetchTotal(token: string): Promise<{
  status: number;
  openTotalCents: number;
  openOrderCount: number;
  asOf: string;
}> {
  const res = await request(ctx.appA!)
    .get('/reports/kpi/open-orders-total')
    .set('Authorization', `Bearer ${token}`);
  return {
    status: res.status,
    openTotalCents: res.body?.data?.openTotalCents as number,
    openOrderCount: res.body?.data?.openOrderCount as number,
    asOf: res.body?.data?.asOf as string,
  };
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'GET /reports/kpi/open-orders-total (ADR-026 Amd5 K6)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.appA = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_A,
        webOrigin: 'http://localhost:5173',
      });
      ctx.appB = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_B,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_A,
            name: 'Tenant A OOT',
            slug: `t-oot-a-${TENANT_A.slice(0, 8)}`,
          },
          {
            id: TENANT_B,
            name: 'Tenant B OOT',
            slug: `t-oot-b-${TENANT_B.slice(0, 8)}`,
          },
        ])
        .execute();
      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }])
        .execute();

      await db
        .insertInto('users')
        .values([
          {
            id: ADMIN_A_ID,
            tenant_id: TENANT_A,
            email: ADMIN_A_EMAIL,
            username: ADMIN_A_USERNAME,
            password_hash: await hashPassword(ADMIN_A_PASSWORD),
            role: 'admin',
          },
          {
            id: CASHIER_A_ID,
            tenant_id: TENANT_A,
            email: CASHIER_A_EMAIL,
            username: CASHIER_A_USERNAME,
            password_hash: await hashPassword(CASHIER_A_PASSWORD),
            role: 'cashier',
          },
          {
            id: WAITER_A_ID,
            tenant_id: TENANT_A,
            email: WAITER_A_EMAIL,
            username: WAITER_A_USERNAME,
            password_hash: await hashPassword(WAITER_A_PASSWORD),
            role: 'waiter',
          },
          {
            id: KITCHEN_A_ID,
            tenant_id: TENANT_A,
            email: KITCHEN_A_EMAIL,
            username: KITCHEN_A_USERNAME,
            password_hash: await hashPassword(KITCHEN_A_PASSWORD),
            role: 'kitchen',
          },
          {
            id: ADMIN_B_ID,
            tenant_id: TENANT_B,
            email: ADMIN_B_EMAIL,
            username: ADMIN_B_USERNAME,
            password_hash: await hashPassword(ADMIN_B_PASSWORD),
            role: 'admin',
          },
        ])
        .execute();

      await db
        .insertInto('tables')
        .values(
          TABLES.map((t) => ({
            id: t.id,
            tenant_id: TENANT_A,
            code: t.code,
            capacity: 4,
          })),
        )
        .execute();

      await db
        .insertInto('categories')
        .values([
          { id: CATEGORY_A_ID, tenant_id: TENANT_A, name: 'Yemekler OOT A' },
          { id: CATEGORY_B_ID, tenant_id: TENANT_B, name: 'Yemekler OOT B' },
        ])
        .execute();
      await db
        .insertInto('products')
        .values([
          {
            id: PRODUCT_A_ID,
            tenant_id: TENANT_A,
            category_id: CATEGORY_A_ID,
            name: 'Pide OOT A',
            price_cents: PRICE,
            is_active: true,
          },
          {
            id: PRODUCT_B_ID,
            tenant_id: TENANT_B,
            category_id: CATEGORY_B_ID,
            name: 'Pide OOT B',
            price_cents: PRICE,
            is_active: true,
          },
        ])
        .execute();
      await db
        .insertInto('customers')
        .values([
          {
            id: CUSTOMER_A_ID,
            tenant_id: TENANT_A,
            full_name: 'Test Müşteri A (oot)',
            is_blacklisted: false,
          },
          {
            id: CUSTOMER_B_ID,
            tenant_id: TENANT_B,
            full_name: 'Test Müşteri B (oot)',
            is_blacklisted: false,
          },
        ])
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.appA,
        ADMIN_A_EMAIL,
        ADMIN_A_PASSWORD,
      );
      ctx.cashierToken = await loginAndGetToken(
        ctx.appA,
        CASHIER_A_EMAIL,
        CASHIER_A_PASSWORD,
      );
      ctx.waiterToken = await loginAndGetToken(
        ctx.appA,
        WAITER_A_EMAIL,
        WAITER_A_PASSWORD,
      );
      ctx.kitchenToken = await loginAndGetToken(
        ctx.appA,
        KITCHEN_A_EMAIL,
        KITCHEN_A_PASSWORD,
      );
      ctx.adminTokenB = await loginAndGetToken(
        ctx.appB,
        ADMIN_B_EMAIL,
        ADMIN_B_PASSWORD,
      );
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      for (const tid of [TENANT_A, TENANT_B]) {
        await db
          .deleteFrom('payment_items')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
        await db
          .deleteFrom('order_item_attributes')
          .where('tenant_id', '=', tid)
          .execute();
        await db
          .deleteFrom('order_items')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
        await db
          .deleteFrom('order_no_counters')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('products').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
        await db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('users').where('tenant_id', '=', tid).execute();
        await db.deleteFrom('customers').where('tenant_id', '=', tid).execute();
        await db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await ctx.pool?.end();
    });

    it('boş tenant → 0 / 0 (asOf ISO)', async () => {
      const res = await fetchTotal(ctx.adminToken!);
      expect(res.status).toBe(200);
      expect(res.openTotalCents).toBe(0);
      expect(res.openOrderCount).toBe(0);
      expect(Number.isNaN(Date.parse(res.asOf))).toBe(false);
    });

    it('açık dine_in + açık takeaway + kısmi ödemeli → KALAN toplamı; paid sipariş DAHİL DEĞİL', async () => {
      // 1) Açık dine_in, ödemesiz → kalan 5000
      await createDineInOrder(TABLES[0]!.id, 1);
      // 2) Açık takeaway, ödemesiz → kalan 5000 (order_type filtresi YOK — K6)
      await createTakeawayOrder(1);
      // 3) Açık dine_in 10000, 3000 kısmi ödendi → kalan 7000
      const partialOrderId = await createDineInOrder(TABLES[1]!.id, 2);
      await payPartial(partialOrderId, 3000);
      // 4) Tam ödenip kapanmış sipariş → status='paid', toplamda YOK
      const paidOrderId = await createDineInOrder(TABLES[2]!.id, 1);
      await payAndClose(paidOrderId, PRICE);

      const res = await fetchTotal(ctx.adminToken!);
      expect(res.status).toBe(200);
      expect(res.openTotalCents).toBe(5000 + 5000 + 7000);
      expect(res.openOrderCount).toBe(3);
    });

    it('void edilmiş ödeme kalanı AZALTMAZ (ADR-033 voided_at IS NULL)', async () => {
      const before = await fetchTotal(ctx.adminToken!);

      const orderId = await createDineInOrder(TABLES[3]!.id, 1); // total 5000
      const paymentId = await payPartial(orderId, 2000); // kalan 3000

      const afterPay = await fetchTotal(ctx.adminToken!);
      expect(afterPay.openTotalCents).toBe(before.openTotalCents + 3000);
      expect(afterPay.openOrderCount).toBe(before.openOrderCount + 1);

      const voidRes = await request(ctx.appA!)
        .post(`/payments/${paymentId}/void`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ reasonCode: 'wrong_amount' });
      expect(voidRes.status).toBe(200);

      // Void sonrası ödeme sayılmaz → kalan tam tutara geri çıkar.
      const afterVoid = await fetchTotal(ctx.adminToken!);
      expect(afterVoid.openTotalCents).toBe(before.openTotalCents + PRICE);
      expect(afterVoid.openOrderCount).toBe(before.openOrderCount + 1);
    });

    it('fazla tahsilat (legacy veri) negatife düşmez — 0 katkı (clamp)', async () => {
      const before = await fetchTotal(ctx.adminToken!);

      const orderId = await createDineInOrder(TABLES[4]!.id, 1); // total 5000
      // ADR-014 Amd3 sonrası fazla tahsilat API'den ARTIK oluşamaz; clamp
      // savunma katmanı olduğu için doğrudan DB'ye legacy satır yazılır.
      await ctx
        .db!.insertInto('payments')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_A,
          order_id: orderId,
          payment_type: 'cash',
          payment_scope: 'partial',
          amount_cents: 8000, // total'ın 3000 üstü
          idempotency_key: randomUUID(),
          created_by_user_id: ADMIN_A_ID,
        })
        .execute();

      const after = await fetchTotal(ctx.adminToken!);
      // −3000 değil 0 katkı: toplam değişmez, sayaç 1 artar.
      expect(after.openTotalCents).toBe(before.openTotalCents);
      expect(after.openOrderCount).toBe(before.openOrderCount + 1);
    });

    it('RBAC: waiter 403, kitchen 403, cashier 200 (reports ailesi = admin+cashier)', async () => {
      const waiter = await fetchTotal(ctx.waiterToken!);
      expect(waiter.status).toBe(403);

      const kitchen = await fetchTotal(ctx.kitchenToken!);
      expect(kitchen.status).toBe(403);

      const cashier = await fetchTotal(ctx.cashierToken!);
      expect(cashier.status).toBe(200);
      expect(typeof cashier.openTotalCents).toBe('number');
    });

    it('multi-tenant: tenant B açık siparişi tenant A toplamına girmez', async () => {
      const beforeA = await fetchTotal(ctx.adminToken!);

      const bRes = await request(ctx.appB!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminTokenB!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_B_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_B_ID, quantity: 1 }],
        });
      expect(bRes.status).toBe(201);

      const afterA = await fetchTotal(ctx.adminToken!);
      expect(afterA.openTotalCents).toBe(beforeA.openTotalCents);
      expect(afterA.openOrderCount).toBe(beforeA.openOrderCount);
    });
  },
);
