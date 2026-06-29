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
const TABLE_ID = randomUUID();
const TABLE_CODE = `M-${randomUUID().slice(0, 6)}`;

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-${randomUUID()}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-${randomUUID().slice(0, 8)}`;

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-${randomUUID()}@example.com`;
const KITCHEN_PASSWORD = 'kitchenpass1234';
const KITCHEN_USERNAME = `kitchen-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-${randomUUID()}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-${randomUUID().slice(0, 8)}`;

const WAITER2_ID = randomUUID();
const WAITER2_EMAIL = `waiter2-${randomUUID()}@example.com`;
const WAITER2_PASSWORD = 'waiter2pass1234';
const WAITER2_USERNAME = `waiter2-${randomUUID().slice(0, 8)}`;

// ADR-017 Migration 031: takeaway → customer_id NOT NULL CHECK constraint.
// Tüm takeaway POST'larında bu sabit ID kullanılır.
const CUSTOMER_ID = randomUUID();

// ADR-017 §3: takeaway POST /orders schema items.min(1) bekler — product fixture seed.
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE_CENTS = 5000;

/**
 * ADR-017 §3 — POST /orders takeaway body builder.
 * - `type: 'takeaway'` discriminator (orderType DEĞIL — yeni schema)
 * - customerId zorunlu (CHECK constraint)
 * - plannedPaymentType zorunlu (cash|card)
 * - items min 1 zorunlu (CreateTakeawayOrderInputSchema)
 */
const takeawayBody = () => ({
  type: 'takeaway' as const,
  customerId: CUSTOMER_ID,
  plannedPaymentType: 'cash' as const,
  items: [{ productId: PRODUCT_ID, quantity: 1 }],
});

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  kitchenToken: string;
  waiterToken: string;
  waiter2Token: string;
}

const ctx: Partial<TestCtx> = {};
let prevBypass: string | undefined;

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
  'POST /orders integration',
  () => {
    beforeAll(async () => {
      // Suite tek `app` paylaşır; 5 rol-login (beforeAll) + cross-tenant ekstra
      // login `loginLimiter` limit:5'i aşar. ABAC akışını test ediyoruz, limiter'ı
      // değil (429 testi yok) → bypass aç (buildApp ÖNCESİ); afterAll geri alır.
      prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';
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

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant Orders',
          slug: `test-orders-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      // ADR-003 §11 store_date trigger tenant_settings.business_day_cutoff_hour okur;
      // INSERT olmadan POST /orders → 'tenant_settings missing' RAISE EXCEPTION.
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      const cashierHash = await hashPassword(CASHIER_PASSWORD);
      const kitchenHash = await hashPassword(KITCHEN_PASSWORD);
      const waiterHash = await hashPassword(WAITER_PASSWORD);
      const waiter2Hash = await hashPassword(WAITER2_PASSWORD);

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
            id: KITCHEN_ID,
            tenant_id: TENANT_ID,
            email: KITCHEN_EMAIL,
            username: KITCHEN_USERNAME,
            password_hash: kitchenHash,
            role: 'kitchen',
          },
          {
            id: WAITER_ID,
            tenant_id: TENANT_ID,
            email: WAITER_EMAIL,
            username: WAITER_USERNAME,
            password_hash: waiterHash,
            role: 'waiter',
          },
          {
            id: WAITER2_ID,
            tenant_id: TENANT_ID,
            email: WAITER2_EMAIL,
            username: WAITER2_USERNAME,
            password_hash: waiter2Hash,
            role: 'waiter',
          },
        ])
        .execute();

      // Bir masa seed et (doğrudan DB, route üzerinden değil)
      await db
        .insertInto('tables')
        .values({
          id: TABLE_ID,
          tenant_id: TENANT_ID,
          code: TABLE_CODE,
          capacity: 4,
        })
        .execute();

      // ADR-017 Migration 031: takeaway sipariş customer_id NOT NULL bekler.
      // Test customer'ı seed ediyoruz; tüm takeaway test'leri bunu kullanır.
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_ID,
          tenant_id: TENANT_ID,
          full_name: 'Test Müşteri (orders.test)',
          is_blacklisted: false,
        })
        .execute();

      // ADR-017 §3 — CreateTakeawayOrderInputSchema items.min(1) bekler;
      // POST /orders takeaway için en az 1 product gerekir.
      await db
        .insertInto('categories')
        .values({
          id: CATEGORY_ID,
          tenant_id: TENANT_ID,
          name: 'Test Kategori',
        })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Test Ürün',
          price_cents: PRODUCT_PRICE_CENTS,
        })
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
      ctx.kitchenToken = await loginAndGetToken(
        ctx.app,
        KITCHEN_EMAIL,
        KITCHEN_PASSWORD,
      );
      ctx.waiterToken = await loginAndGetToken(
        ctx.app,
        WAITER_EMAIL,
        WAITER_PASSWORD,
      );
      ctx.waiter2Token = await loginAndGetToken(
        ctx.app,
        WAITER2_EMAIL,
        WAITER2_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        // order_items, orders, order_no_counters önce (FK orders'a bağımlı)
        await ctx.db
          .deleteFrom('order_items')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('orders')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('order_no_counters')
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
        // products, categories: orders cleanup sonrası, customers'dan önce
        await ctx.db
          .deleteFrom('products')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('categories')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('customers')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', '=', TENANT_ID)
          .execute();
        await ctx.db.destroy();
      }
      if (prevBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = prevBypass;
      }
    });

    it('dine_in + valid tableId → 201, order_no > 0, status open', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: TABLE_ID, orderType: 'dine_in' });
      expect(res.status).toBe(201);
      expect(res.body.data.order.order_no).toBeGreaterThan(0);
      expect(res.body.data.order.status).toBe('open');
      expect(res.body.data.order.table_id).toBe(TABLE_ID);
      expect(res.body.data.order.order_type).toBe('dine_in');
      expect(res.body.data.order.tenant_id).toBe(TENANT_ID);

      // Cleanup: bu siparişi sil ki sonraki test'lerde masa serbest kalsın
      await ctx.db!
        .deleteFrom('orders')
        .where('id', '=', res.body.data.order.id)
        .execute();
    });

    it('dine_in + null tableId → 400 VALIDATION_ERROR (refine)', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: null, orderType: 'dine_in' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('takeaway + null tableId → 201', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send(takeawayBody());
      // ADR-017 takeaway POST → toOrderResponseDto (camelCase, flat data).
      // dine_in legacy handler `data.order` nested, takeaway flat — Sprint 11
      // unify edilecek. Şimdilik takeaway test'leri camelCase access kullanır.
      expect(res.status).toBe(201);
      expect(res.body.data.tableId).toBeNull();
      expect(res.body.data.type).toBe('takeaway');
      expect(res.body.data.status).toBe('open');
    });

    it('aynı masa ikinci sipariş (open) → 409 TABLE_ALREADY_OCCUPIED', async () => {
      const first = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: TABLE_ID, orderType: 'dine_in' });
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: TABLE_ID, orderType: 'dine_in' });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('TABLE_ALREADY_OCCUPIED');
    });

    it('kitchen rolü → 403 AUTH_FORBIDDEN (orders.create yok)', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send(takeawayBody());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('GET admin → 200, body.data.orders array', async () => {
      const res = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.orders)).toBe(true);
    });

    // ADR-008 Amendment 2026-06-28 / ADR-025 K4 — garson tenant-geneli AÇIK
    // adisyon görür (masa-devri). Eski own-only `waiter_user_id===self` filtresi
    // kaldırıldı; yerine açık-status (terminal olmayan) kapsamı.
    it('GET waiter → 200, yalnız AÇIK (terminal olmayan) adisyonlar (ADR-025 K4)', async () => {
      const res = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.orders)).toBe(true);
      for (const o of res.body.data.orders) {
        expect(['paid', 'cancelled', 'void']).not.toContain(o.status);
      }
    });

    it('GET kitchen → 200 (orders.read 4 rolde var)', async () => {
      const res = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.orders)).toBe(true);
    });

    it('GET no auth → 401 AUTH_TOKEN_INVALID', async () => {
      const res = await request(ctx.app!).get('/orders');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('GET ?storeDate=YYYY-MM-DD (geçmiş tarih) → 200, array', async () => {
      const res = await request(ctx.app!)
        .get('/orders?storeDate=2026-04-26')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.orders)).toBe(true);
    });

    it('GET ?storeDate=invalid-format → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.app!)
        .get('/orders?storeDate=not-a-date')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET ?status=open → 200, her item status === open', async () => {
      const res = await request(ctx.app!)
        .get('/orders?status=open')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.orders)).toBe(true);
      for (const o of res.body.data.orders) {
        expect(o.status).toBe('open');
      }
    });

    // ADR-008 §4.1 amendment — waiter_user_id POST /orders'da set ediliyor.
    // Takeaway DTO camelCase: data.waiterUserId (toOrderResponseDto).
    it('admin POST /orders → waiter_user_id === admin.id', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send(takeawayBody());
      expect(res.status).toBe(201);
      expect(res.body.data.waiterUserId).toBe(ADMIN_ID);
    });

    it('cashier POST /orders → waiter_user_id === cashier.id', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send(takeawayBody());
      expect(res.status).toBe(201);
      expect(res.body.data.waiterUserId).toBe(CASHIER_ID);
    });

    it('waiter POST /orders → waiter_user_id === waiter.id', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send(takeawayBody());
      expect(res.status).toBe(201);
      expect(res.body.data.waiterUserId).toBe(WAITER_ID);
    });

    // ADR-008 Amendment 2026-06-28 / ADR-025 K4 — masa-devri: garson DİĞER
    // garsonun AÇIK adisyonunu GÖRÜR (eski own-only IDOR davranışı tersine).
    it('waiter başka waiter\'ın AÇIK siparişini GÖRÜR (ADR-025 K4 handoff)', async () => {
      // Waiter2 takeaway sipariş kesiyor (status='open')
      const created = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiter2Token!}`)
        .send(takeawayBody());
      expect(created.status).toBe(201);
      expect(created.body.data.waiterUserId).toBe(WAITER2_ID);

      // Waiter1 GET → waiter2'nin açık siparişini GÖRMELİ
      const res = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.orders as Array<{ id: string }>).map((o) => o.id);
      expect(ids).toContain(created.body.data.id);
    });

    // ADR-008 Amendment 2026-06-28 / ADR-025 K4 — by-id: garson DİĞER garsonun
    // AÇIK adisyonunu 200 ile çeker (eski own-only 403/404 tersine).
    it('waiter GET /orders/:id başka waiter\'ın AÇIK adisyonu → 200 (ADR-025 K4)', async () => {
      const created = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiter2Token!}`)
        .send(takeawayBody());
      expect(created.status).toBe(201);

      const res = await request(ctx.app!)
        .get(`/orders/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(200);
      expect(res.body.data.order.id).toBe(created.body.data.id);
    });

    it('admin → tüm siparişleri görür (filtresiz, kendi + tüm waiter\'lar)', async () => {
      // Setup: hem waiter hem waiter2 sipariş kessin
      const w1 = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send(takeawayBody());
      expect(w1.status).toBe(201);
      const w2 = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiter2Token!}`)
        .send(takeawayBody());
      expect(w2.status).toBe(201);

      const res = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.orders as Array<{ id: string }>).map((o) => o.id);
      expect(ids).toContain(w1.body.data.id);
      expect(ids).toContain(w2.body.data.id);
    });

    it('cashier → tüm siparişleri görür (filtresiz, ABAC waiter scope cashier\'a uygulanmaz)', async () => {
      const w2 = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiter2Token!}`)
        .send(takeawayBody());
      expect(w2.status).toBe(201);

      const res = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.orders as Array<{ id: string }>).map((o) => o.id);
      expect(ids).toContain(w2.body.data.id);
    });

    // ADR-008 Amendment 2026-06-28 / ADR-025 K4 — garson kapsamı artık açık-status
    // bazlı (waiter_user_id bazlı DEĞİL). NULL attribusyonlu AÇIK orphan adisyon
    // garsona GÖRÜNÜR (eski own-only davranışta görünmüyordu).
    it('NULL waiter_user_id AÇIK orphan adisyon waiter\'a GÖRÜNÜR (ADR-025 K4 açık-status kapsamı)', async () => {
      // Raw INSERT: waiter_user_id = NULL (eski/migrate edilmemiş kayıt simülasyonu).
      // store_date trigger okur; bugünkü iş gününü vermek için todayStoreDate eşdeğeri.
      const orphanId = randomUUID();
      const today = new Date();
      const utcMidnight = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
      );
      // order_no_counters atomik artırma (route handler ile aynı pattern)
      await ctx.db!
        .insertInto('order_no_counters')
        .values({
          tenant_id: TENANT_ID,
          business_date: utcMidnight,
          last_no: 9000,
        })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'business_date'])
            .doUpdateSet({ last_no: 9000 }),
        )
        .execute();
      await ctx.db!
        .insertInto('orders')
        .values({
          id: orphanId,
          tenant_id: TENANT_ID,
          table_id: null,
          order_type: 'takeaway',
          order_no: 9000,
          store_date: utcMidnight,
          waiter_user_id: null,
          // ADR-017 Migration 031 CHECK constraints (takeaway):
          // - customer_id NOT NULL
          // - takeaway_stage NOT NULL (default lifecycle 'preparing')
          customer_id: CUSTOMER_ID,
          takeaway_stage: 'preparing',
        })
        .execute();
      // Cleanup: afterAll'da `deleteFrom('orders').where('tenant_id', '=', TENANT_ID)`
      // bu satırı (NULL waiter_user_id dahil) zaten siler; ek explicit cleanup gerekmez.

      const res = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.orders as Array<{ id: string }>).map((o) => o.id);
      expect(ids).toContain(orphanId);

      // Sanity: admin orphan satırı görür (ABAC scope yok)
      const adminRes = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(adminRes.status).toBe(200);
      const adminIds = (adminRes.body.data.orders as Array<{ id: string }>).map(
        (o) => o.id,
      );
      expect(adminIds).toContain(orphanId);
    });

    // ── ADR-008 Amendment 2026-06-28 / ADR-025 K4 — garson tenant-geneli açık
    //    adisyon (görünürlük + kalem-ekleme genişler; void/edit item-owner ile
    //    sınırlanır; ödeme/iptal/comp/sent-item-void DEĞİŞMEZ; cross-tenant ASLA).
    //    Yardımcılar: dine_in açık adisyon kur + kalem ekle (status='new').

    /** waiter2'nin dine_in açık adisyonu + 1 kalem (kalem owner=waiter2). */
    async function seedDineInWithItem(
      token: string,
    ): Promise<{ orderId: string; itemId: string }> {
      // Her seed kendi izole masasını açar. Paylaşılan TABLE_ID suite'in önceki
      // testlerinden açık siparişle dolu olabiliyor → dine_in create "masa dolu"
      // 409 verir. İzole masa = çakışma yok (afterAll tables'ı TENANT_ID ile siler).
      const seatTableId = randomUUID();
      await ctx.db!
        .insertInto('tables')
        .values({
          id: seatTableId,
          tenant_id: TENANT_ID,
          code: `M-${seatTableId.slice(0, 6)}`,
          capacity: 4,
        })
        .execute();

      const created = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ tableId: seatTableId, orderType: 'dine_in' });
      expect(created.status).toBe(201);
      const orderId = created.body.data.order.id as string;

      const added = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }] });
      expect(added.status).toBe(200);
      const itemId = added.body.data.items[0].id as string;
      return { orderId, itemId };
    }

    async function cleanupOrder(orderId: string): Promise<void> {
      await ctx.db!.deleteFrom('order_items').where('order_id', '=', orderId).execute();
      await ctx.db!.deleteFrom('orders').where('id', '=', orderId).execute();
    }

    it('waiter POST items başka waiter\'ın AÇIK adisyonuna → 200 (ADR-025 K4)', async () => {
      const { orderId } = await seedDineInWithItem(ctx.waiter2Token!);

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ items: [{ productId: PRODUCT_ID, quantity: 2 }] });
      expect(res.status).toBe(200);
      // Adisyonda artık ≥2 kalem (waiter2'nin seed kalemi + waiter1'in eklediği).
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);
      // Yeni kalem owner = waiter1 (kendi ekledi) — DB'den doğrula.
      const owners = await ctx.db!
        .selectFrom('order_items')
        .select('created_by_user_id')
        .where('order_id', '=', orderId)
        .execute();
      expect(owners.map((o) => o.created_by_user_id)).toContain(WAITER_ID);

      await cleanupOrder(orderId);
    });

    it('waiter KENDİ status=new kalemini void → 200', async () => {
      const { orderId, itemId } = await seedDineInWithItem(ctx.waiterToken!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);

      await cleanupOrder(orderId);
    });

    it('waiter BAŞKA waiter\'ın status=new kalemini void → 403 (owner guard)', async () => {
      const { orderId, itemId } = await seedDineInWithItem(ctx.waiter2Token!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');

      await cleanupOrder(orderId);
    });

    it('waiter BAŞKA waiter\'ın kaleminin note-edit → 403 (owner guard)', async () => {
      const { orderId, itemId } = await seedDineInWithItem(ctx.waiter2Token!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ note: 'az pişmiş' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');

      await cleanupOrder(orderId);
    });

    it('waiter sent (mutfağa gönderilmiş) kalemi void → 403 (mevcut status kuralı)', async () => {
      const { orderId, itemId } = await seedDineInWithItem(ctx.waiterToken!);
      // Kalemi mutfağa gönderilmiş duruma çek (DB direkt; KDS flow simülasyonu).
      // order_items.status enum: new|sent|preparing|ready|served|cancelled.
      await ctx.db!
        .updateTable('order_items')
        .set({ status: 'sent' })
        .where('id', '=', itemId)
        .execute();

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');

      await cleanupOrder(orderId);
    });

    it('waiter comp (isComped) → 403 (mevcut §9.2 kuralı)', async () => {
      const { orderId, itemId } = await seedDineInWithItem(ctx.waiterToken!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ isComped: true });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');

      await cleanupOrder(orderId);
    });

    it('admin BAŞKA aktörün status=new kalemini void → 200 (owner-check\'siz)', async () => {
      const { orderId, itemId } = await seedDineInWithItem(ctx.waiter2Token!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);

      await cleanupOrder(orderId);
    });

    it('cashier BAŞKA aktörün kaleminin note-edit → 200 (owner-check\'siz)', async () => {
      const { orderId, itemId } = await seedDineInWithItem(ctx.waiter2Token!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ note: 'servis notu' });
      expect(res.status).toBe(200);

      await cleanupOrder(orderId);
    });

    it('waiter POST /payments → ARTIK 403 DEĞİL (ADR-027 §7e; ödeme garsona açıldı)', async () => {
      const { orderId } = await seedDineInWithItem(ctx.waiter2Token!);

      // ADR-027 §7e: garson ödeme alır → authorize'ı GEÇER (403 yok). Eksik body
      // (gate testi) → validation'a takılır; kritik olan AUTH_FORBIDDEN dönmemesi.
      // Tam pozitif ödeme akışı (201) payments.test.ts'te kapsanır.
      const res = await request(ctx.app!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ orderId, type: 'cash', amountCents: 5000 });
      expect(res.status).not.toBe(403);
      expect(res.body.error?.code).not.toBe('AUTH_FORBIDDEN');

      await cleanupOrder(orderId);
    });

    it('waiter POST /orders/:id/print-bill → 202 + print_jobs kind=bill (ADR-027 §7e)', async () => {
      const { orderId } = await seedDineInWithItem(ctx.waiterToken!);

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/print-bill`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(202);
      expect(res.body.data.enqueued).toBe(true);

      // print_jobs'a kind='bill' job düştü (bu order için, meta.orderId eşleşir).
      const jobs = await ctx.db!
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      const billJob = jobs.find((j) => {
        const p = j.payload as { kind?: string; meta?: { orderId?: string } };
        return p.kind === 'bill' && p.meta?.orderId === orderId;
      });
      expect(billJob).toBeDefined();

      await cleanupOrder(orderId);
    });

    it('kitchen POST /orders/:id/print-bill → 403 AUTH_FORBIDDEN', async () => {
      const { orderId } = await seedDineInWithItem(ctx.waiterToken!);

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/print-bill`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');

      await cleanupOrder(orderId);
    });

    it('print-bill var olmayan order → 404 ORDER_NOT_FOUND', async () => {
      const res = await request(ctx.app!)
        .post(`/orders/${randomUUID()}/print-bill`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    // Cross-tenant izolasyon: tenant B waiter'ı tenant A adisyonunu göremez/
    // değiştiremez. Tenant-scope mutlak (tenant_id WHERE her sorguda).
    it('cross-tenant: tenant B waiter tenant A AÇIK adisyonunu GÖREMEZ/değiştiremez → 404', async () => {
      // Tenant B + waiter B seed (izole; afterAll ek cleanup ile siler).
      const tenantBId = randomUUID();
      const waiterBId = randomUUID();
      const waiterBEmail = `waiterB-${randomUUID()}@example.com`;
      const waiterBPassword = 'waiterBpass1234';
      await ctx.db!
        .insertInto('tenants')
        .values({ id: tenantBId, name: 'Tenant B', slug: `tenant-b-${tenantBId.slice(0, 8)}` })
        .execute();
      await ctx.db!
        .insertInto('tenant_settings')
        .values({ tenant_id: tenantBId })
        .execute();
      await ctx.db!
        .insertInto('users')
        .values({
          id: waiterBId,
          tenant_id: tenantBId,
          email: waiterBEmail,
          username: `waiterB-${randomUUID().slice(0, 8)}`,
          password_hash: await hashPassword(waiterBPassword),
          role: 'waiter',
        })
        .execute();
      // Login tenant-scoped'tur (auth.ts findByEmail(deps.tenantId, email)): waiter B
      // yalnız tenant-B app'inden login olabilir. İzole app kur, token al; token
      // tenant_id=B taşır → ctx.app'e (tenant A) karşı kullanıldığında tenant-scope
      // 404 verir (testin amacı). (Limiter bypass beforeAll'da aktif.)
      const appB = buildApp({
        pool: ctx.pool!,
        db: ctx.db!,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: tenantBId,
        webOrigin: 'http://localhost:5173',
      });
      const waiterBToken = await loginAndGetToken(appB, waiterBEmail, waiterBPassword);

      // Tenant A açık adisyon + kalem (waiter A).
      const { orderId, itemId } = await seedDineInWithItem(ctx.waiterToken!);

      // GET by-id → 404 (tenant-scope: findByIdWithItems tenant_id WHERE).
      const getRes = await request(ctx.app!)
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${waiterBToken}`);
      expect(getRes.status).toBe(404);

      // PATCH item → 404 (tenant-scope item pre-fetch null).
      const patchRes = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${waiterBToken}`)
        .send({ status: 'cancelled' });
      expect(patchRes.status).toBe(404);

      // GET list → tenant A adisyonu görünmez.
      const listRes = await request(ctx.app!)
        .get('/orders')
        .set('Authorization', `Bearer ${waiterBToken}`);
      expect(listRes.status).toBe(200);
      const ids = (listRes.body.data.orders as Array<{ id: string }>).map((o) => o.id);
      expect(ids).not.toContain(orderId);

      await cleanupOrder(orderId);
      await ctx.db!.deleteFrom('refresh_tokens').where('tenant_id', '=', tenantBId).execute();
      await ctx.db!.deleteFrom('users').where('tenant_id', '=', tenantBId).execute();
      await ctx.db!.deleteFrom('tenant_settings').where('tenant_id', '=', tenantBId).execute();
      await ctx.db!.deleteFrom('tenants').where('id', '=', tenantBId).execute();
    });
  },
);
