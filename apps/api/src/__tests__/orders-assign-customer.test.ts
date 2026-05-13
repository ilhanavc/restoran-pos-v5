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
 * Session 53 — PATCH /orders/:id/customer (v3 paritesi)
 *
 * Senaryolar:
 *  1. admin assign (dine_in persisted) → 200
 *  2. waiter assign → 200 (RBAC: 4 rol içinde waiter da)
 *  3. cashier assign + null (dine_in unassign) → 200
 *  4. unauthenticated → 401
 *  5. takeaway + customerId=null → 400 TAKEAWAY_CUSTOMER_REQUIRED
 *  6. nonexistent customer → 404 CUSTOMER_NOT_FOUND
 *  7. blacklisted customer → 409 CUSTOMER_BLACKLISTED
 *  8. paid order → 409 ORDER_INVARIANT_VIOLATED
 *  9. cross-tenant customer → 404 CUSTOMER_NOT_FOUND
 * 10. cross-tenant order → 404 ORDER_NOT_FOUND
 * 11. audit log: order.customer_assigned event yazıldı + customer_id_after
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const FOREIGN_TENANT_ID = randomUUID();

const TABLE_ID = randomUUID();
const TABLE_CODE = `M-AC-${randomUUID().slice(0, 6)}`;

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-ac-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-ac-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-ac-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-ac-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-ac-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-ac-${randomUUID().slice(0, 8)}`;

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 5000;

const CUSTOMER_A_ID = randomUUID();
const CUSTOMER_B_ID = randomUUID();
const CUSTOMER_BL_ID = randomUUID();
const CUSTOMER_FOREIGN_ID = randomUUID();

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
  cashierToken?: string;
  waiterToken?: string;
}

async function login(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .send({ email, password });
  return res.body.accessToken as string;
}

async function createDineInOrder(
  app: Express,
  token: string,
): Promise<string> {
  const res = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId: TABLE_ID,
      orderType: 'dine_in',
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
    });
  return res.body.data.order.id as string;
}

async function createTakeawayOrder(
  app: Express,
  token: string,
  customerId: string,
): Promise<string> {
  // Takeaway POST → `data: toOrderResponseDto(...)` flat shape (data.id direkt).
  const res = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'takeaway',
      customerId,
      plannedPaymentType: 'cash',
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
    });
  return res.body.data.id as string;
}

describe.skipIf(DB_URL === undefined)(
  'PATCH /orders/:id/customer (Session 53)',
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

      // Two tenants — primary + foreign (cross-tenant test).
      for (const tid of [TENANT_ID, FOREIGN_TENANT_ID]) {
        await db
          .insertInto('tenants')
          .values({
            id: tid,
            name: `Test Tenant AC ${tid.slice(0, 8)}`,
            slug: `t-ac-${tid.slice(0, 8)}`,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
        await db
          .insertInto('tenant_settings')
          .values({ tenant_id: tid })
          .onConflict((oc) => oc.doNothing())
          .execute();
      }

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

      // 4 customers: 2 aktif (TENANT_ID), 1 blacklisted, 1 cross-tenant.
      await db
        .insertInto('customers')
        .values([
          {
            id: CUSTOMER_A_ID,
            tenant_id: TENANT_ID,
            full_name: 'Müşteri A',
            is_blacklisted: false,
          },
          {
            id: CUSTOMER_B_ID,
            tenant_id: TENANT_ID,
            full_name: 'Müşteri B',
            is_blacklisted: false,
          },
          {
            id: CUSTOMER_BL_ID,
            tenant_id: TENANT_ID,
            full_name: 'Müşteri Blacklist',
            is_blacklisted: true,
            blacklist_reason: 'kötü davranış',
          },
          {
            id: CUSTOMER_FOREIGN_ID,
            tenant_id: FOREIGN_TENANT_ID,
            full_name: 'Yabancı Tenant Müşteri',
            is_blacklisted: false,
          },
        ])
        .execute();

      ctx.adminToken = await login(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
      ctx.cashierToken = await login(ctx.app, CASHIER_EMAIL, CASHIER_PASSWORD);
      ctx.waiterToken = await login(ctx.app, WAITER_EMAIL, WAITER_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      for (const tid of [TENANT_ID, FOREIGN_TENANT_ID]) {
        await db
          .deleteFrom('payment_items')
          .where('tenant_id', '=', tid)
          .execute();
        await db
          .deleteFrom('payments')
          .where('tenant_id', '=', tid)
          .execute();
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
        await db
          .deleteFrom('products')
          .where('tenant_id', '=', tid)
          .execute();
        await db
          .deleteFrom('categories')
          .where('tenant_id', '=', tid)
          .execute();
        await db
          .deleteFrom('customer_phones')
          .where('tenant_id', '=', tid)
          .execute();
        await db
          .deleteFrom('customer_addresses')
          .where('tenant_id', '=', tid)
          .execute();
        await db
          .deleteFrom('customers')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
        await db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('users').where('tenant_id', '=', tid).execute();
        await db
          .deleteFrom('audit_logs')
          .where('tenant_id', '=', tid)
          .execute();
        await db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', tid)
          .execute();
        await db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await db.destroy();
    });

    async function freeTable(): Promise<void> {
      const db = ctx.db!;
      await db
        .deleteFrom('payment_items')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('payments')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('order_item_attributes')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('order_items')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('orders')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
    }

    it('admin → 200, customer_id güncellendi (dine_in)', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_A_ID });
      expect(res.status).toBe(200);
      // Response: toOrderResponseDto flat — `data.id, data.type, data.customerId`.
      expect(res.body.data.customerId).toBe(CUSTOMER_A_ID);
      expect(res.body.data.type).toBe('dine_in');
    });

    it('waiter → 200 (RBAC: 4 rol içinde waiter da)', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ customerId: CUSTOMER_A_ID });
      expect(res.status).toBe(200);
      expect(res.body.data.customerId).toBe(CUSTOMER_A_ID);
    });

    it('cashier customerId=null (dine_in unassign) → 200', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      // önce ata
      await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_A_ID });
      // sonra kaldır
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ customerId: null });
      expect(res.status).toBe(200);
      expect(res.body.data.customerId).toBeNull();
    });

    it('unauthenticated → 401', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .send({ customerId: CUSTOMER_A_ID });
      expect(res.status).toBe(401);
    });

    it('takeaway + customerId=null → 400 TAKEAWAY_CUSTOMER_REQUIRED', async () => {
      await freeTable();
      const orderId = await createTakeawayOrder(
        ctx.app!,
        ctx.adminToken!,
        CUSTOMER_A_ID,
      );
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: null });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TAKEAWAY_CUSTOMER_REQUIRED');
    });

    it('takeaway + farklı customer → 200 (order_type DEĞİŞMEZ)', async () => {
      await freeTable();
      const orderId = await createTakeawayOrder(
        ctx.app!,
        ctx.adminToken!,
        CUSTOMER_A_ID,
      );
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_B_ID });
      expect(res.status).toBe(200);
      expect(res.body.data.customerId).toBe(CUSTOMER_B_ID);
      expect(res.body.data.type).toBe('takeaway');
    });

    it('nonexistent customer → 404 CUSTOMER_NOT_FOUND', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: randomUUID() });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('blacklisted customer → 409 CUSTOMER_BLACKLISTED', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_BL_ID });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CUSTOMER_BLACKLISTED');
    });

    it('cross-tenant customer → 404 CUSTOMER_NOT_FOUND', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_FOREIGN_ID });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('cross-tenant order → 404 ORDER_NOT_FOUND', async () => {
      const res = await request(ctx.app!)
        .patch(`/orders/${randomUUID()}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_A_ID });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('cancelled order → 409 ORDER_INVARIANT_VIOLATED', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      // cancel order
      await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_A_ID });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_INVARIANT_VIOLATED');
    });

    it('audit log: order.customer_assigned event yazılır', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_A_ID });
      const auditRows = await ctx
        .db!.selectFrom('audit_logs')
        .select(['event_type', 'entity_id', 'payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.customer_assigned')
        .where('entity_id', '=', orderId)
        .execute();
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      const payload = auditRows[0]!.payload as {
        order_id: string;
        customer_id_after: string | null;
      };
      expect(payload.order_id).toBe(orderId);
      expect(payload.customer_id_after).toBe(CUSTOMER_A_ID);
    });

    it('aynı müşteri yeniden atanınca no-op (audit yazılmaz)', async () => {
      await freeTable();
      const orderId = await createDineInOrder(ctx.app!, ctx.adminToken!);
      // 1. atama
      await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_A_ID });
      // audit count snapshot
      const before = await ctx
        .db!.selectFrom('audit_logs')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.customer_assigned')
        .where('entity_id', '=', orderId)
        .executeTakeFirstOrThrow();
      // 2. aynı müşteri tekrar
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/customer`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ customerId: CUSTOMER_A_ID });
      expect(res.status).toBe(200);
      const after = await ctx
        .db!.selectFrom('audit_logs')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.customer_assigned')
        .where('entity_id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(Number(after.c)).toBe(Number(before.c));
    });
  },
);
