import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import type { Server as IoServer } from 'socket.io';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Realtime emit-site integration tests (PR-5d/Session 74 follow-up — "P1-P5").
 *
 * PR-5d completed the masa-board realtime contract (emitTenant emit-sites +
 * add-items KDS hook) but it was only device-tested — no automated coverage of
 * *which event fires with which payload to which room* (feedback: a silently
 * broken emit is invisible; manual refresh masks it). These tests pin the
 * garson-facing emit paths against the real routes:
 *
 *   P1 dine-in POST /orders            → orders.created  {type:'dine_in', ...}
 *   P2 POST /orders/:id/items          → orders.statusChanged + kitchen.orderSent
 *   P2b add-items (bar-only)           → NO kitchen.orderSent (kitchen_print=false)
 *   P3 PATCH /orders/:id {cancelled}   → orders.cancelled
 *   P4 POST /payments pay_and_close    → orders.statusChanged {paid:true} (waiter — ADR-027)
 *   P5 takeaway POST /orders           → orders.created {type:'takeaway'} + kitchen.orderSent
 *
 * Harness mirrors kds.test.ts: buildApp opts.io = spy, assert the emit chain
 * `io.of('/realtime').to(room).emit(event, payload)`.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `rt-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `rt-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `rt-waiter-${randomUUID()}@example.com`;
const WAITER_USERNAME = `rt-waiter-${randomUUID().slice(0, 8)}`;
const WAITER_PASSWORD = 'waiterpass1234';

let KITCHEN_CATEGORY_ID: string; // kitchen_print=true
let BAR_CATEGORY_ID: string; // kitchen_print=false
let PIDE_PRODUCT_ID: string;
let DRINK_PRODUCT_ID: string;
let CUSTOMER_ID: string;

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
  mockIo: MockIo;
  adminToken: string;
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

/** Fresh unoccupied table (avoids TABLE_ALREADY_OCCUPIED 409 between tests). */
async function insertTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-${randomUUID().slice(0, 6)}`,
      capacity: 4,
    })
    .execute();
  return id;
}

/** Open a dine-in order on a fresh table; returns id + authoritative total. */
async function createDineInOrder(
  token: string,
  items: Array<{ productId: string; quantity: number }>,
): Promise<{ orderId: string; totalCents: number }> {
  const tableId = await insertTable();
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId, orderType: 'dine_in', items });
  if (res.status !== 201) {
    throw new Error(
      `dine-in POST failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return {
    orderId: res.body.data.order.id as string,
    totalCents: Number(res.body.data.order.total_cents),
  };
}

/** Find a single emit call by event name (or undefined). */
function findEmit(
  mockIo: MockIo,
  event: string,
): [string, unknown] | undefined {
  return mockIo.emitSpy.mock.calls.find((c) => c[0] === event) as
    | [string, unknown]
    | undefined;
}

/** True if any `.to(room)` was routed to the given room this action. */
function routedTo(mockIo: MockIo, room: string): boolean {
  return mockIo.toMock.mock.calls.some((c) => c[0] === room);
}

/** Reset the emit spy chain before an action so only its emits are asserted. */
function clearEmits(mockIo: MockIo): void {
  mockIo.emitSpy.mockClear();
  mockIo.toMock.mockClear();
  mockIo.ofMock.mockClear();
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'realtime emit-sites (PR-5d follow-up)',
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
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
        io: mockIo.io,
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Realtime Test Tenant',
          slug: `rt-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
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
            id: WAITER_ID,
            tenant_id: TENANT_ID,
            email: WAITER_EMAIL,
            username: WAITER_USERNAME,
            password_hash: waiterHash,
            role: 'waiter',
          },
        ])
        .execute();

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

      CUSTOMER_ID = randomUUID();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_ID,
          tenant_id: TENANT_ID,
          full_name: 'Realtime Test Müşteri',
        })
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
      ctx.waiterToken = await loginAndGetToken(
        ctx.app,
        WAITER_EMAIL,
        WAITER_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    // P1 — dine-in create → orders.created (tenant room), takeawayStage null.
    it('P1: POST /orders dine-in → orders.created (type dine_in, tenant room)', async () => {
      const tableId = await insertTable();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 2 }],
        });
      expect(res.status).toBe(201);
      const orderId = res.body.data.order.id as string;

      const created = findEmit(ctx.mockIo!, 'orders.created');
      expect(created).toBeDefined();
      expect(created![1]).toMatchObject({
        orderId,
        type: 'dine_in',
        takeawayStage: null,
        total_cents: 28000,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    // P2 — add-items to an open dine-in order → statusChanged + kitchen.orderSent.
    it('P2: POST /orders/:id/items (kitchen item) → orders.statusChanged + kitchen.orderSent', async () => {
      const { orderId } = await createDineInOrder(ctx.waiterToken!, [
        { productId: DRINK_PRODUCT_ID, quantity: 1 },
      ]);
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }] });
      expect(res.status).toBe(200);

      const changed = findEmit(ctx.mockIo!, 'orders.statusChanged');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({ orderId, paid: false });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);

      // KDS hook: the newly-added pide (kitchen_print=true) is sent to kitchen.
      const kitchen = findEmit(ctx.mockIo!, 'kitchen.orderSent');
      expect(kitchen).toBeDefined();
      expect(kitchen![1]).toMatchObject({ orderId });
      const items = (kitchen![1] as { items: Array<{ productName: string }> })
        .items;
      expect(items.some((i) => i.productName === 'Kuşbaşılı Pide')).toBe(true);
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}:role:kitchen`)).toBe(true);
    });

    // P2b — add-items that are bar-only (kitchen_print=false) → NO kitchen.orderSent.
    it('P2b: POST /orders/:id/items (bar-only) → statusChanged but NO kitchen.orderSent', async () => {
      const { orderId } = await createDineInOrder(ctx.waiterToken!, [
        { productId: PIDE_PRODUCT_ID, quantity: 1 },
      ]);
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ items: [{ productId: DRINK_PRODUCT_ID, quantity: 2 }] });
      expect(res.status).toBe(200);

      expect(findEmit(ctx.mockIo!, 'orders.statusChanged')).toBeDefined();
      expect(findEmit(ctx.mockIo!, 'kitchen.orderSent')).toBeUndefined();
    });

    // P3 — cancel via PATCH /orders/:id {status:'cancelled'} → orders.cancelled.
    it('P3: PATCH /orders/:id {cancelled} → orders.cancelled (tenant room)', async () => {
      const { orderId } = await createDineInOrder(ctx.adminToken!, [
        { productId: PIDE_PRODUCT_ID, quantity: 1 },
      ]);
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);

      const cancelled = findEmit(ctx.mockIo!, 'orders.cancelled');
      expect(cancelled).toBeDefined();
      expect(cancelled![1]).toMatchObject({ orderId });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    // P4 — waiter Quick Pay (ADR-027): POST /payments full+close → statusChanged paid.
    it('P4: POST /payments pay_and_close (waiter) → orders.statusChanged paid:true', async () => {
      const { orderId, totalCents } = await createDineInOrder(ctx.waiterToken!, [
        { productId: PIDE_PRODUCT_ID, quantity: 1 },
      ]);
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: totalCents,
          idempotencyKey: randomUUID(),
          operation: 'pay_and_close',
          cashReceivedCents: totalCents,
        });
      expect(res.status).toBe(201);

      const changed = findEmit(ctx.mockIo!, 'orders.statusChanged');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({
        orderId,
        takeawayStage: null,
        paid: true,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    // P5 — takeaway create → orders.created (takeaway) + kitchen.orderSent.
    it('P5: POST /orders takeaway → orders.created (type takeaway) + kitchen.orderSent', async () => {
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      const orderId = res.body.data.id as string;

      const created = findEmit(ctx.mockIo!, 'orders.created');
      expect(created).toBeDefined();
      expect(created![1]).toMatchObject({
        orderId,
        type: 'takeaway',
        takeawayStage: 'preparing',
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);

      const kitchen = findEmit(ctx.mockIo!, 'kitchen.orderSent');
      expect(kitchen).toBeDefined();
      expect(kitchen![1]).toMatchObject({ orderId, orderType: 'takeaway' });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}:role:kitchen`)).toBe(true);
    });

    // ── ADR-010 §11.6 Amendment 3 — menü admin-CRUD katalog realtime ──────────
    // products.changed (create/update/delete) + categories.changed (create/
    // update/delete/products_reordered), all invalidate-only to the tenant room.

    /** Create a product under KITCHEN_CATEGORY_ID; returns its id. */
    async function createProduct(): Promise<string> {
      const res = await request(ctx.app!)
        .post('/products')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          categoryId: KITCHEN_CATEGORY_ID,
          name: `RT Ürün ${randomUUID().slice(0, 6)}`,
          priceCents: 5000,
        });
      if (res.status !== 201) {
        throw new Error(
          `product POST failed: ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
      return res.body.data.product.id as string;
    }

    /** Create a category (no products); returns its id. */
    async function createCategory(): Promise<string> {
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: `RT Kategori ${randomUUID().slice(0, 6)}` });
      if (res.status !== 201) {
        throw new Error(
          `category POST failed: ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
      return res.body.data.category.id as string;
    }

    it('M1: POST /products → products.changed created (tenant room)', async () => {
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .post('/products')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          categoryId: KITCHEN_CATEGORY_ID,
          name: `RT Ürün ${randomUUID().slice(0, 6)}`,
          priceCents: 5000,
        });
      expect(res.status).toBe(201);
      const productId = res.body.data.product.id as string;

      const changed = findEmit(ctx.mockIo!, 'products.changed');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({ action: 'created', productId });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('M2: PATCH /products/:id → products.changed updated (tenant room)', async () => {
      const productId = await createProduct();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .patch(`/products/${productId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ priceCents: 7500 });
      expect(res.status).toBe(200);

      const changed = findEmit(ctx.mockIo!, 'products.changed');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({ action: 'updated', productId });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('M3: DELETE /products/:id → products.changed deleted (tenant room)', async () => {
      const productId = await createProduct();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);

      const changed = findEmit(ctx.mockIo!, 'products.changed');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({ action: 'deleted', productId });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('M4: POST /menu/categories → categories.changed created (tenant room)', async () => {
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: `RT Kategori ${randomUUID().slice(0, 6)}` });
      expect(res.status).toBe(201);
      const categoryId = res.body.data.category.id as string;

      const changed = findEmit(ctx.mockIo!, 'categories.changed');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({ action: 'created', categoryId });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('M5: PATCH /menu/categories/:id → categories.changed updated (tenant room)', async () => {
      const categoryId = await createCategory();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .patch(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: `RT Kategori güncel ${randomUUID().slice(0, 6)}` });
      expect(res.status).toBe(200);

      const changed = findEmit(ctx.mockIo!, 'categories.changed');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({ action: 'updated', categoryId });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('M6: DELETE /menu/categories/:id → categories.changed deleted (tenant room)', async () => {
      // Empty category (no active products) — DELETE guard allows soft delete.
      const categoryId = await createCategory();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);

      const changed = findEmit(ctx.mockIo!, 'categories.changed');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({ action: 'deleted', categoryId });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('M7: POST /menu/categories/:id/products/reorder → categories.changed products_reordered', async () => {
      const categoryId = await createCategory();
      // Two products in this category, then reorder them.
      const p1 = await request(ctx.app!)
        .post('/products')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ categoryId, name: `RT R1 ${randomUUID().slice(0, 6)}`, priceCents: 1000 });
      const p2 = await request(ctx.app!)
        .post('/products')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ categoryId, name: `RT R2 ${randomUUID().slice(0, 6)}`, priceCents: 2000 });
      const id1 = p1.body.data.product.id as string;
      const id2 = p2.body.data.product.id as string;
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post(`/menu/categories/${categoryId}/products/reorder`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ productIds: [id2, id1] });
      expect(res.status).toBe(204);

      const changed = findEmit(ctx.mockIo!, 'categories.changed');
      expect(changed).toBeDefined();
      expect(changed![1]).toMatchObject({
        action: 'products_reordered',
        categoryId,
      });
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
      // Reorder yalnız categories.changed yayar — products.changed sızmamalı.
      expect(findEmit(ctx.mockIo!, 'products.changed')).toBeUndefined();
    });
  },
);
