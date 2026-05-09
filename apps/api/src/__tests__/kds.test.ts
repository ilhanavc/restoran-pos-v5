import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  createPool,
  createKysely,
  type DB,
} from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import type { Server as IoServer } from 'socket.io';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * KDS integration tests — Sprint 12 PR-2d (ADR-020).
 *
 * Covers:
 *   - GET /kds/orders happy path + kitchen_print=false filter
 *   - GET RBAC (cashier/waiter 403) + multi-tenant isolation
 *   - PATCH /orders/:o/items/:i/status state machine (sent → preparing → ready)
 *   - PATCH idempotent (same status → no audit, no emit)
 *   - PATCH invalid transition → 422 ORDER_ITEM_INVALID_STATUS_TRANSITION
 *   - PATCH audit log + realtime emit (kitchen.itemStatusChanged)
 *   - PATCH RBAC (cashier/waiter 403)
 *   - dine_in POST hook: kitchen_print=true items → status='sent'
 *
 * io stub: buildApp opts.io ile spy verilir; emit chain
 * `io.of('/realtime').to(room).emit(event, payload)` mock ile assert edilir.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TENANT_B_ID = randomUUID();

// --- Tenant A users ---
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `kds-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `kds-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `kds-cashier-${randomUUID()}@example.com`;
const CASHIER_USERNAME = `kds-cashier-${randomUUID().slice(0, 8)}`;
const CASHIER_PASSWORD = 'cashierpass1234';

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `kds-waiter-${randomUUID()}@example.com`;
const WAITER_USERNAME = `kds-waiter-${randomUUID().slice(0, 8)}`;
const WAITER_PASSWORD = 'waiterpass1234';

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kds-kitchen-${randomUUID()}@example.com`;
const KITCHEN_USERNAME = `kds-kitchen-${randomUUID().slice(0, 8)}`;
const KITCHEN_PASSWORD = 'kitchenpass1234';

// --- Tenant B kitchen user (multi-tenant isolation test) ---
const KITCHEN_B_ID = randomUUID();
const KITCHEN_B_EMAIL = `kds-kb-${randomUUID()}@example.com`;
const KITCHEN_B_USERNAME = `kds-kb-${randomUUID().slice(0, 8)}`;
const KITCHEN_B_PASSWORD = 'kitchenbpass1234';

// --- Seed entities (tenant A) ---
let KITCHEN_CATEGORY_ID: string; // kitchen_print=true
let BAR_CATEGORY_ID: string; // kitchen_print=false
let PIDE_PRODUCT_ID: string;
let DRINK_PRODUCT_ID: string;
let TABLE_A1_ID: string;
const TABLE_A1_CODE = `M-${randomUUID().slice(0, 6)}`;
let CUSTOMER_A_ID: string;

interface MockIo {
  io: IoServer;
  emitSpy: ReturnType<typeof vi.fn>;
  toMock: ReturnType<typeof vi.fn>;
  ofMock: ReturnType<typeof vi.fn>;
}

function createMockIo(): MockIo {
  const emitSpy = vi.fn();
  const toMock = vi.fn().mockReturnValue({ emit: emitSpy });
  const ofMock = vi.fn().mockReturnValue({ to: toMock });
  return {
    io: { of: ofMock } as unknown as IoServer,
    emitSpy,
    toMock,
    ofMock,
  };
}

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  appB: Express;
  mockIo: MockIo;
  adminToken: string;
  cashierToken: string;
  waiterToken: string;
  kitchenToken: string;
  kitchenBToken: string;
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

/**
 * Tek kitchen-routed kalemli takeaway sipariş oluşturur. PATCH testleri
 * her biri kendi siparişini yaratır → state izolasyonu (idempotent vs.
 * invalid transition vs. audit). Pide kitchen_print=true → POST hook ile
 * item status 'sent' set edilir.
 */
async function createTakeawayKitchenOrder(
  adminToken: string,
): Promise<{ orderId: string; itemId: string }> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      type: 'takeaway',
      customerId: CUSTOMER_A_ID,
      plannedPaymentType: 'cash',
      items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }],
    });
  if (res.status !== 201) {
    throw new Error(
      `takeaway POST failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return {
    orderId: res.body.data.id as string,
    itemId: res.body.data.items[0].id as string,
  };
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  '/kds integration (Sprint 12 PR-2d)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      const mockIo = createMockIo();
      ctx.pool = pool;
      ctx.db = db;
      ctx.mockIo = mockIo;
      ctx.app = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
        io: mockIo.io,
      });
      // Tenant B app — kitchen B login için (auth /auth/login opts.tenantId
      // ile kullanıcı tenant'ı eşleştirir; multi-tenant testi için 2. app).
      // Aynı db + io paylaşılır; JWT'deki tenantId istek bazlı filtreyi belirler.
      ctx.appB = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        tenantId: TENANT_B_ID,
        webOrigin: 'http://localhost:5173',
        io: mockIo.io,
      });

      // --- Tenants ---
      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_ID,
            name: 'KDS Test Tenant A',
            slug: `kds-a-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'KDS Test Tenant B',
            slug: `kds-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_ID }, { tenant_id: TENANT_B_ID }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      // --- Users ---
      const adminHash = await hashPassword(ADMIN_PASSWORD);
      const cashierHash = await hashPassword(CASHIER_PASSWORD);
      const waiterHash = await hashPassword(WAITER_PASSWORD);
      const kitchenHash = await hashPassword(KITCHEN_PASSWORD);
      const kitchenBHash = await hashPassword(KITCHEN_B_PASSWORD);

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
          {
            id: KITCHEN_ID,
            tenant_id: TENANT_ID,
            email: KITCHEN_EMAIL,
            username: KITCHEN_USERNAME,
            password_hash: kitchenHash,
            role: 'kitchen',
          },
          {
            id: KITCHEN_B_ID,
            tenant_id: TENANT_B_ID,
            email: KITCHEN_B_EMAIL,
            username: KITCHEN_B_USERNAME,
            password_hash: kitchenBHash,
            role: 'kitchen',
          },
        ])
        .execute();

      // --- Categories: Pideler (kitchen_print=true), İçecek (kitchen_print=false) ---
      KITCHEN_CATEGORY_ID = randomUUID();
      BAR_CATEGORY_ID = randomUUID();
      await db
        .insertInto('categories')
        .values([
          {
            id: KITCHEN_CATEGORY_ID,
            tenant_id: TENANT_ID,
            name: 'Pideler',
            sort_order: 1,
            kitchen_print: true,
          },
          {
            id: BAR_CATEGORY_ID,
            tenant_id: TENANT_ID,
            name: 'İçecek',
            sort_order: 2,
            kitchen_print: false,
          },
        ])
        .execute();

      // --- Products ---
      PIDE_PRODUCT_ID = randomUUID();
      DRINK_PRODUCT_ID = randomUUID();
      await db
        .insertInto('products')
        .values([
          {
            id: PIDE_PRODUCT_ID,
            tenant_id: TENANT_ID,
            category_id: KITCHEN_CATEGORY_ID,
            name: 'Kuşbaşılı Pide',
            price_cents: 14000,
            is_active: true,
          },
          {
            id: DRINK_PRODUCT_ID,
            tenant_id: TENANT_ID,
            category_id: BAR_CATEGORY_ID,
            name: 'Kola',
            price_cents: 3000,
            is_active: true,
          },
        ])
        .execute();

      // --- Table for dine_in test (test 1) ---
      TABLE_A1_ID = randomUUID();
      await db
        .insertInto('tables')
        .values({
          id: TABLE_A1_ID,
          tenant_id: TENANT_ID,
          code: TABLE_A1_CODE,
          capacity: 4,
        })
        .execute();

      // --- Customer for takeaway tests ---
      CUSTOMER_A_ID = randomUUID();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_A_ID,
          tenant_id: TENANT_ID,
          full_name: 'KDS Test Müşteri',
        })
        .execute();

      // --- Tokens ---
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
      ctx.kitchenToken = await loginAndGetToken(
        ctx.app,
        KITCHEN_EMAIL,
        KITCHEN_PASSWORD,
      );
      ctx.kitchenBToken = await loginAndGetToken(
        ctx.appB,
        KITCHEN_B_EMAIL,
        KITCHEN_B_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        for (const tid of [TENANT_ID, TENANT_B_ID]) {
          await ctx.db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('audit_logs').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
          await ctx.db
            .deleteFrom('order_no_counters')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('customers').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('products').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
          await ctx.db
            .deleteFrom('refresh_tokens')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('users').where('tenant_id', '=', tid).execute();
          await ctx.db
            .deleteFrom('tenant_settings')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('tenants').where('id', '=', tid).execute();
        }
        await ctx.db.destroy();
      }
    });

    // ----------------------------------------------------------------
    // 1. GET /kds/orders dine_in mixed items → only kitchen items + status='sent'
    //    (validates dine_in POST hook + GET shape + kitchen_print filter)
    // ----------------------------------------------------------------
    it('1. GET /kds/orders dine_in mixed items → kitchen_print=true only, status=sent (POST hook)', async () => {
      const postRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId: TABLE_A1_ID,
          orderType: 'dine_in',
          items: [
            { productId: PIDE_PRODUCT_ID, quantity: 2 },
            { productId: DRINK_PRODUCT_ID, quantity: 1 },
          ],
        });
      expect(postRes.status).toBe(201);
      const orderId = postRes.body.data.order.id as string;

      // dine_in POST hook: pide → 'sent', drink → 'new'
      const itemRows = await ctx.db!
        .selectFrom('order_items')
        .select(['id', 'product_id', 'status'])
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      const pide = itemRows.find((i) => i.product_id === PIDE_PRODUCT_ID);
      const drink = itemRows.find((i) => i.product_id === DRINK_PRODUCT_ID);
      expect(pide).toBeDefined();
      expect(drink).toBeDefined();
      expect(pide!.status).toBe('sent');
      expect(drink!.status).toBe('new');

      // GET as kitchen
      const getRes = await request(ctx.app!)
        .get('/kds/orders')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
      expect(getRes.status).toBe(200);
      expect(Array.isArray(getRes.body.data.orders)).toBe(true);
      const order = getRes.body.data.orders.find(
        (o: { id: string }) => o.id === orderId,
      );
      expect(order).toBeDefined();
      expect(order.orderType).toBe('dine_in');
      expect(order.items.length).toBe(1); // drink filtered (kitchen_print=false)
      expect(order.items[0].productId).toBe(PIDE_PRODUCT_ID);
      expect(order.items[0].status).toBe('sent');

      // Cleanup: cancel order so TABLE_A1 is freed (subsequent tests don't need it,
      // but defensive).
      await ctx.db!
        .updateTable('orders')
        .set({ status: 'cancelled' })
        .where('id', '=', orderId)
        .execute();
    });

    // ----------------------------------------------------------------
    // 2. GET /kds/orders drink-only (kitchen_print=false) → order excluded
    // ----------------------------------------------------------------
    it('2. GET /kds/orders drink-only order → response\'tan filtrelenir', async () => {
      const postRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_A_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: DRINK_PRODUCT_ID, quantity: 3 }],
        });
      expect(postRes.status).toBe(201);
      const orderId = postRes.body.data.id as string;

      const getRes = await request(ctx.app!)
        .get('/kds/orders')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
      expect(getRes.status).toBe(200);
      const found = getRes.body.data.orders.find(
        (o: { id: string }) => o.id === orderId,
      );
      expect(found).toBeUndefined();
    });

    // ----------------------------------------------------------------
    // 3. GET /kds/orders RBAC — cashier 403, waiter 403
    // ----------------------------------------------------------------
    it('3. GET /kds/orders cashier 403, waiter 403 (kds.read kitchen+admin only)', async () => {
      const cashierRes = await request(ctx.app!)
        .get('/kds/orders')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`);
      expect(cashierRes.status).toBe(403);

      const waiterRes = await request(ctx.app!)
        .get('/kds/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(waiterRes.status).toBe(403);
    });

    // ----------------------------------------------------------------
    // 4. GET /kds/orders multi-tenant — tenant B kitchen → 0 (tenant A leak yok)
    // ----------------------------------------------------------------
    it('4. GET /kds/orders multi-tenant — tenant B kitchen 0 sipariş, tenant A leak yok', async () => {
      const res = await request(ctx.app!)
        .get('/kds/orders')
        .set('Authorization', `Bearer ${ctx.kitchenBToken!}`);
      expect(res.status).toBe(200);
      // Tenant B has no products → no kitchen-routed orders possible.
      expect(res.body.data.orders.length).toBe(0);
    });

    // ----------------------------------------------------------------
    // 5. PATCH .../status sent → preparing → 200, response shape, DB updated
    // ----------------------------------------------------------------
    it('5. PATCH .../status sent → preparing → 200, DB updated, response shape', async () => {
      const { orderId, itemId } = await createTakeawayKitchenOrder(
        ctx.adminToken!,
      );

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ status: 'preparing' });
      expect(res.status).toBe(200);
      expect(res.body.data.item.id).toBe(itemId);
      expect(res.body.data.item.status).toBe('preparing');

      const row = await ctx.db!
        .selectFrom('order_items')
        .select('status')
        .where('id', '=', itemId)
        .executeTakeFirst();
      expect(row!.status).toBe('preparing');
    });

    // ----------------------------------------------------------------
    // 6. PATCH idempotent — same status → 200 no-op (no audit, no emit)
    // ----------------------------------------------------------------
    it('6. PATCH .../status idempotent — aynı status → 200 no-op (audit yok, emit yok)', async () => {
      const { orderId, itemId } = await createTakeawayKitchenOrder(
        ctx.adminToken!,
      );

      // First: sent → preparing (transition).
      const r1 = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ status: 'preparing' });
      expect(r1.status).toBe(200);

      // Audit count after first = 1.
      const auditBefore = await ctx.db!
        .selectFrom('audit_logs')
        .select((eb) => eb.fn.countAll<string>().as('cnt'))
        .where('entity_id', '=', itemId)
        .where('event_type', '=', 'order_item.status_changed')
        .executeTakeFirst();
      expect(Number(auditBefore!.cnt)).toBe(1);

      const emitCallsBefore = ctx.mockIo!.emitSpy.mock.calls.length;

      // Second: preparing → preparing (idempotent — status değişmez).
      const r2 = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ status: 'preparing' });
      expect(r2.status).toBe(200);
      expect(r2.body.data.item.status).toBe('preparing');

      // Audit count unchanged (idempotent → audit yazılmaz).
      const auditAfter = await ctx.db!
        .selectFrom('audit_logs')
        .select((eb) => eb.fn.countAll<string>().as('cnt'))
        .where('entity_id', '=', itemId)
        .where('event_type', '=', 'order_item.status_changed')
        .executeTakeFirst();
      expect(Number(auditAfter!.cnt)).toBe(1);

      // Emit count unchanged (idempotent → emit yapılmaz).
      expect(ctx.mockIo!.emitSpy.mock.calls.length).toBe(emitCallsBefore);
    });

    // ----------------------------------------------------------------
    // 7. PATCH invalid transition → 422 ORDER_ITEM_INVALID_STATUS_TRANSITION
    //    (ready → preparing geri yön yasak; ADR-020 K3)
    // ----------------------------------------------------------------
    it('7. PATCH .../status invalid transition (ready → preparing) → 422', async () => {
      const { orderId, itemId } = await createTakeawayKitchenOrder(
        ctx.adminToken!,
      );

      // sent → ready (K3 izin verir — preparing skip).
      const r1 = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ status: 'ready' });
      expect(r1.status).toBe(200);

      // ready → preparing (geri yön — invalid).
      const r2 = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ status: 'preparing' });
      expect(r2.status).toBe(422);
      expect(r2.body.error.code).toBe('ORDER_ITEM_INVALID_STATUS_TRANSITION');
    });

    // ----------------------------------------------------------------
    // 8. PATCH audit + realtime emit smoke
    //    (event_type, payload status_before/after, kitchen.itemStatusChanged)
    // ----------------------------------------------------------------
    it('8. PATCH .../status audit + emit (order_item.status_changed + kitchen.itemStatusChanged)', async () => {
      const { orderId, itemId } = await createTakeawayKitchenOrder(
        ctx.adminToken!,
      );
      ctx.mockIo!.emitSpy.mockClear();
      ctx.mockIo!.toMock.mockClear();

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ status: 'preparing' });
      expect(res.status).toBe(200);

      // Audit log row.
      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .selectAll()
        .where('entity_id', '=', itemId)
        .where('event_type', '=', 'order_item.status_changed')
        .executeTakeFirst();
      expect(audit).toBeDefined();
      expect(audit!.entity_type).toBe('order_item');
      expect(audit!.actor_user_id).toBe(KITCHEN_ID);
      const payload = audit!.payload as {
        status_before: string;
        status_after: string;
        order_id: string;
      };
      expect(payload.status_before).toBe('sent');
      expect(payload.status_after).toBe('preparing');
      expect(payload.order_id).toBe(orderId);

      // Realtime emit smoke (mock io chain).
      const emitCalls = ctx.mockIo!.emitSpy.mock.calls;
      const kitchenEmit = emitCalls.find(
        (c) => c[0] === 'kitchen.itemStatusChanged',
      );
      expect(kitchenEmit).toBeDefined();
      expect(kitchenEmit![1]).toMatchObject({
        orderId,
        itemId,
        status: 'preparing',
      });
      // Room: tenant:N:role:kitchen
      const toCalls = ctx.mockIo!.toMock.mock.calls;
      expect(
        toCalls.some((c) => c[0] === `tenant:${TENANT_ID}:role:kitchen`),
      ).toBe(true);
    });

    // ----------------------------------------------------------------
    // 9. PATCH RBAC — cashier 403, waiter 403
    // ----------------------------------------------------------------
    it('9. PATCH .../status cashier 403, waiter 403 (kds.itemStatusUpdate kitchen+admin only)', async () => {
      const { orderId, itemId } = await createTakeawayKitchenOrder(
        ctx.adminToken!,
      );

      const cashierRes = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'preparing' });
      expect(cashierRes.status).toBe(403);

      const waiterRes = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ status: 'preparing' });
      expect(waiterRes.status).toBe(403);
    });
  },
);
