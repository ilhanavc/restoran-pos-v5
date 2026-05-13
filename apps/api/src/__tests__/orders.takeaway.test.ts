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
const TENANT_B_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `tw-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `tw-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `tw-cashier-${randomUUID()}@example.com`;
const CASHIER_USERNAME = `tw-cashier-${randomUUID().slice(0, 8)}`;
const CASHIER_PASSWORD = 'cashierpass1234';

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `tw-waiter-${randomUUID()}@example.com`;
const WAITER_USERNAME = `tw-waiter-${randomUUID().slice(0, 8)}`;
const WAITER_PASSWORD = 'waiterpass1234';

// Seeded entities (populated in beforeAll)
let CATEGORY_ID: string;
let PRODUCT_A_ID: string;
let PRODUCT_B_ID: string;
let CUSTOMER_A_ID: string;
let CUSTOMER_A_ADDR_ID: string;
let CUSTOMER_B_ID: string; // tenant B — isolation test

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
    throw new Error(
      `login failed: ${res.status} ${JSON.stringify(res.body)} [email=${email}]`,
    );
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  '/orders takeaway integration',
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
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      // --- Tenants ---
      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_ID,
            name: 'Takeaway Test Tenant',
            slug: `tw-a-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'Takeaway Test Tenant B',
            slug: `tw-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_ID }, { tenant_id: TENANT_B_ID }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      // --- Users (tenant A) ---
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

      // --- Category + Products (tenant A) ---
      CATEGORY_ID = randomUUID();
      await db
        .insertInto('categories')
        .values({
          id: CATEGORY_ID,
          tenant_id: TENANT_ID,
          name: 'Pideler',
          sort_order: 1,
        })
        .execute();

      PRODUCT_A_ID = randomUUID();
      PRODUCT_B_ID = randomUUID();
      await db
        .insertInto('products')
        .values([
          {
            id: PRODUCT_A_ID,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_ID,
            name: 'Kuşbaşılı Pide',
            price_cents: 14000,
            is_active: true,
          },
          {
            id: PRODUCT_B_ID,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_ID,
            name: 'Karışık Pide',
            price_cents: 16000,
            is_active: true,
          },
        ])
        .execute();

      // --- Customer A (tenant A) + address ---
      CUSTOMER_A_ID = randomUUID();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_A_ID,
          tenant_id: TENANT_ID,
          full_name: 'Ali Demir',
          note: null,
        })
        .execute();

      await db
        .insertInto('customer_phones')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          customer_id: CUSTOMER_A_ID,
          raw_phone: '05321234567',
          normalized_phone: '05321234567',
          is_primary: true,
          is_mobile: true,
        })
        .execute();

      CUSTOMER_A_ADDR_ID = randomUUID();
      await db
        .insertInto('customer_addresses')
        .values({
          id: CUSTOMER_A_ADDR_ID,
          tenant_id: TENANT_ID,
          customer_id: CUSTOMER_A_ID,
          title: 'Ev',
          address_line: 'Atatürk Cad. No:12',
          neighborhood: 'Merkez',
          district: 'Akçaabat',
          is_default: true,
          is_deleted: false,
        })
        .execute();

      // --- Customer B (tenant B — isolation seed) ---
      CUSTOMER_B_ID = randomUUID();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_B_ID,
          tenant_id: TENANT_B_ID,
          full_name: 'Tenant B Müşteri',
          note: null,
        })
        .execute();

      // --- Tokens ---
      ctx.adminToken = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
      ctx.cashierToken = await loginAndGetToken(ctx.app, CASHIER_EMAIL, CASHIER_PASSWORD);
      ctx.waiterToken = await loginAndGetToken(ctx.app, WAITER_EMAIL, WAITER_PASSWORD);
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        for (const tid of [TENANT_ID, TENANT_B_ID]) {
          await ctx.db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('audit_logs').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('order_no_counters').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('customer_addresses').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('customer_phones').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('customers').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('products').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('refresh_tokens').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('users').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('tenant_settings').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('tenants').where('id', '=', tid).execute();
        }
        await ctx.db.destroy();
      }
    });

    // ----------------------------------------------------------------
    // 1. POST /orders happy path (admin)
    // ----------------------------------------------------------------
    it('1. POST /orders takeaway (admin) → 201, response shape, DB row check', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          customerAddressId: CUSTOMER_A_ADDR_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 2 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.data.type).toBe('takeaway');
      expect(res.body.data.status).toBe('open');
      expect(res.body.data.takeawayStage).toBe('preparing');
      expect(res.body.data.plannedPaymentType).toBe('cash');
      expect(res.body.data.customerId).toBe(CUSTOMER_A_ID);
      expect(res.body.data.deliveryAddressSnapshot).toContain('Atatürk Cad. No:12');
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.totalCents).toBe(28000); // 14000 * 2

      // ADR-013 §5 actor rozeti — items[].createdByUserId + createdByName
      // dine_in ile aynı pattern; AdisyonPanel "İLHAN · 16:46" chip için.
      expect(res.body.data.items[0].createdByUserId).toBe(ADMIN_ID);
      expect(res.body.data.items[0].createdByName).toBe(ADMIN_USERNAME);

      // DB row check
      const orderId = res.body.data.id as string;
      const row = await ctx.db!
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirst();
      expect(row).toBeDefined();
      expect(row!.takeaway_stage).toBe('preparing');
      expect(row!.planned_payment_type).toBe('cash');
      expect(row!.delivery_address_snapshot).toContain('Atatürk Cad. No:12');
      expect(row!.status).toBe('open');

      // order_items row check
      const items = await ctx.db!
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      expect(items.length).toBe(1);
      expect(items[0]!.product_id).toBe(PRODUCT_A_ID);
      expect(items[0]!.quantity).toBe(2);

      // audit log 'order.created'
      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_id', '=', orderId)
        .where('event_type', '=', 'order.created')
        .executeTakeFirst();
      expect(audit).toBeDefined();
    });

    // ----------------------------------------------------------------
    // 2. POST /orders — waiter rolü → 201
    // ----------------------------------------------------------------
    it('2. POST /orders takeaway waiter rolü → 201', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'card',
          items: [{ productId: PRODUCT_B_ID, quantity: 1 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.takeawayStage).toBe('preparing');
      expect(res.body.data.plannedPaymentType).toBe('card');
      expect(res.body.data.deliveryAddressSnapshot).toBeNull();
    });

    // ----------------------------------------------------------------
    // 3. POST /orders — customerId eksik (zod) → 400
    // ----------------------------------------------------------------
    it('3. POST /orders customerId eksik → 400', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });

      expect(res.status).toBe(400);
    });

    // ----------------------------------------------------------------
    // 4. POST /orders — customerId tenant B'nin müşterisi → 404 CUSTOMER_NOT_FOUND
    // ----------------------------------------------------------------
    it('4. POST /orders customerId tenant B → 404 CUSTOMER_NOT_FOUND (izolasyon)', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_B_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    // ----------------------------------------------------------------
    // 5. POST /orders — items[] boş → 400 (zod min 1)
    // ----------------------------------------------------------------
    it('5. POST /orders items boş array → 400', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [],
        });

      expect(res.status).toBe(400);
    });

    // ----------------------------------------------------------------
    // 6. POST /orders — items[].productId tenant B'nin → 404 PRODUCT_NOT_FOUND
    // ----------------------------------------------------------------
    it('6. POST /orders productId tenant B → 404 PRODUCT_NOT_FOUND', async () => {
      // Tenant B'ye product seed
      const tenantBProductId = randomUUID();
      const tenantBCategoryId = randomUUID();
      await ctx.db!
        .insertInto('categories')
        .values({
          id: tenantBCategoryId,
          tenant_id: TENANT_B_ID,
          name: 'B Kategori',
          sort_order: 1,
        })
        .execute();
      await ctx.db!
        .insertInto('products')
        .values({
          id: tenantBProductId,
          tenant_id: TENANT_B_ID,
          category_id: tenantBCategoryId,
          name: 'B Ürün',
          price_cents: 5000,
          is_active: true,
        })
        .execute();

      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: tenantBProductId, quantity: 1 }],
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });

    // ----------------------------------------------------------------
    // 7. POST /orders — plannedPaymentType eksik → 400
    // ----------------------------------------------------------------
    it('7. POST /orders plannedPaymentType eksik → 400', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });

      expect(res.status).toBe(400);
    });

    // ----------------------------------------------------------------
    // 8. GET /orders?type=takeaway&status=open — tenant izolasyon
    // ----------------------------------------------------------------
    it('8. GET /orders?type=takeaway&status=open → liste, tenant B siparişi yok', async () => {
      // Tenant B için DB'de doğrudan order seed et
      const tenantBOrderId = randomUUID();

      // Tenant B'nin tenant_settings timezone gerekiyor; zaten seeded.
      // store_date hesabı için DB trigger'a güveniyoruz; explicit veriyoruz.
      await ctx.db!
        .insertInto('order_no_counters')
        .values({
          tenant_id: TENANT_B_ID,
          business_date: new Date('2026-01-01'),
          last_no: 1,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      await ctx.db!
        .insertInto('orders')
        .values({
          id: tenantBOrderId,
          tenant_id: TENANT_B_ID,
          table_id: null,
          customer_id: CUSTOMER_B_ID,
          order_type: 'takeaway',
          status: 'open',
          order_no: 1,
          store_date: new Date('2026-01-01'),
          total_cents: 10000,
          takeaway_stage: 'preparing',
          planned_payment_type: 'cash',
          delivery_address_snapshot: null,
          delivery_note: null,
        })
        .execute();

      const res = await request(ctx.app!)
        .get('/orders?type=takeaway&status=open')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);

      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(tenantBOrderId);
    });

    // ----------------------------------------------------------------
    // 9. PATCH /orders/:id/takeaway-stage preparing→out_for_delivery (cashier)
    // ----------------------------------------------------------------
    it('9. PATCH takeaway-stage preparing→out_for_delivery (cashier) → 200, DB check', async () => {
      // Create an order to transition
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id as string;

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/takeaway-stage`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ stage: 'out_for_delivery' });

      expect(res.status).toBe(200);
      expect(res.body.data.takeawayStage).toBe('out_for_delivery');
      expect(res.body.data.status).toBe('open'); // not yet paid

      // DB check
      const row = await ctx.db!
        .selectFrom('orders')
        .select(['takeaway_stage', 'status'])
        .where('id', '=', orderId)
        .executeTakeFirst();
      expect(row!.takeaway_stage).toBe('out_for_delivery');
      expect(row!.status).toBe('open');

      // No payment yet
      const payments = await ctx.db!
        .selectFrom('payments')
        .selectAll()
        .where('order_id', '=', orderId)
        .execute();
      expect(payments.length).toBe(0);
    });

    // ----------------------------------------------------------------
    // 10. PATCH out_for_delivery→delivered (cashier) → 200, status=paid, payments insert
    // ----------------------------------------------------------------
    it('10. PATCH takeaway-stage out_for_delivery→delivered → 200, status=paid, payment row', async () => {
      // Create + advance to out_for_delivery
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'card',
          items: [
            { productId: PRODUCT_A_ID, quantity: 1 },
            { productId: PRODUCT_B_ID, quantity: 1 },
          ],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id as string;
      const expectedTotal = 14000 + 16000; // 30000

      const step1 = await request(ctx.app!)
        .patch(`/orders/${orderId}/takeaway-stage`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ stage: 'out_for_delivery' });
      expect(step1.status).toBe(200);

      // Now deliver
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/takeaway-stage`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ stage: 'delivered' });

      expect(res.status).toBe(200);
      expect(res.body.data.takeawayStage).toBe('delivered');
      expect(res.body.data.status).toBe('paid');

      // DB: stage=delivered, status=paid
      const row = await ctx.db!
        .selectFrom('orders')
        .select(['takeaway_stage', 'status', 'total_cents'])
        .where('id', '=', orderId)
        .executeTakeFirst();
      expect(row!.takeaway_stage).toBe('delivered');
      expect(row!.status).toBe('paid');
      expect(row!.total_cents).toBe(expectedTotal);

      // payments row
      const payment = await ctx.db!
        .selectFrom('payments')
        .selectAll()
        .where('order_id', '=', orderId)
        .executeTakeFirst();
      expect(payment).toBeDefined();
      // payments.idempotency_key UUID — orderId 1:1 takeaway için doğal key
      // (ADR-017 prefix string yerine, schema gereği)
      expect(payment!.idempotency_key).toBe(orderId);
      expect(payment!.amount_cents).toBe(expectedTotal);
      expect(payment!.payment_type).toBe('card');

      // audit: order.takeaway_stage_changed + order.paid
      const audits = await ctx.db!
        .selectFrom('audit_logs')
        .select('event_type')
        .where('entity_id', '=', orderId)
        .execute();
      const eventTypes = audits.map((a) => a.event_type);
      expect(eventTypes).toContain('order.takeaway_stage_changed');
      expect(eventTypes).toContain('order.paid');
    });

    // ----------------------------------------------------------------
    // 11. PATCH geçersiz transition (preparing→delivered) → 409 INVALID_TRANSITION
    // ----------------------------------------------------------------
    it('11. PATCH preparing→delivered geçersiz transition → 409 INVALID_TRANSITION', async () => {
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id as string;

      // Skip out_for_delivery — go directly to delivered
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/takeaway-stage`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ stage: 'delivered' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });

    // ----------------------------------------------------------------
    // 12. PATCH takeaway-stage waiter rolü → 403
    // ----------------------------------------------------------------
    it('12. PATCH takeaway-stage waiter rolü → 403 AUTH_FORBIDDEN', async () => {
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id as string;

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/takeaway-stage`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ stage: 'out_for_delivery' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    // ----------------------------------------------------------------
    // 13. POST /orders/:id/cancel admin, preparing+open → 200, status=cancelled
    // ----------------------------------------------------------------
    it('13. POST /orders/:id/cancel admin, preparing+open → 200, DB cancelled + audit', async () => {
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 3 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id as string;

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');

      // DB check
      const row = await ctx.db!
        .selectFrom('orders')
        .select(['status'])
        .where('id', '=', orderId)
        .executeTakeFirst();
      expect(row!.status).toBe('cancelled');

      // audit
      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_id', '=', orderId)
        .where('event_type', '=', 'order.cancelled')
        .executeTakeFirst();
      expect(audit).toBeDefined();
    });

    // ----------------------------------------------------------------
    // 14. POST /orders/:id/cancel admin, delivered sipariş → 409 INVALID_STATE
    // ----------------------------------------------------------------
    it('14. POST /orders/:id/cancel admin, delivered sipariş → 409 INVALID_STATE', async () => {
      // Create + advance to delivered
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id as string;

      await request(ctx.app!)
        .patch(`/orders/${orderId}/takeaway-stage`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ stage: 'out_for_delivery' });
      await request(ctx.app!)
        .patch(`/orders/${orderId}/takeaway-stage`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ stage: 'delivered' });

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    // ----------------------------------------------------------------
    // 15. POST /orders/:id/cancel cashier rolü → 403 AUTH_FORBIDDEN
    // ----------------------------------------------------------------
    it('15. POST /orders/:id/cancel cashier rolü → 403 AUTH_FORBIDDEN', async () => {
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id as string;

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });
  },
);
