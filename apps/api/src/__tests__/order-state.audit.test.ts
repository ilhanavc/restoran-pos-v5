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
 * Derin Denetim Blok 5 (Hat B) — durum makinesi YEŞİL invariant/regresyon
 * kilidi. Bu dosyadaki testler BUGÜN GEÇER (temiz alanları kanıtlar).
 * Kırmızı (bug) bulgular `order-state.findings.test.ts` içinde. Prod kod
 * DEĞİŞTİRİLMEDİ.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-oa-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRICE = 5000;

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
}

const ctx: Ctx = {};

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app!).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function insertTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-OA-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

async function createDineInOrder(tableId: string, qty = 1): Promise<string> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${ctx.adminToken!}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: [{ productId: PRODUCT_ID, quantity: qty }],
    });
  if (res.status !== 201) {
    throw new Error(`create order failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.order.id as string;
}

async function orderRow(orderId: string): Promise<{ status: string; total_cents: number }> {
  const o = await ctx
    .db!.selectFrom('orders')
    .select(['status', 'total_cents'])
    .where('tenant_id', '=', TENANT_ID)
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  return o;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Durum makinesi temiz alanlar — order-state.audit (YEŞİL — regresyon kilidi)',
  () => {
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

      await db
        .insertInto('tenants')
        .values({ id: TENANT_ID, name: 'Order State Audit Tenant', slug: `t-oa-${TENANT_ID.slice(0, 8)}` })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      await db
        .insertInto('users')
        .values([
          { id: ADMIN_ID, tenant_id: TENANT_ID, email: ADMIN_EMAIL, username: `admin-oa-${randomUUID().slice(0, 6)}`, password_hash: adminHash, role: 'admin' },
        ])
        .execute();

      await db.insertInto('areas').values({ id: AREA_ID, tenant_id: TENANT_ID, name: 'Salon' }).execute();
      await db.insertInto('categories').values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Yemekler' }).execute();
      await db
        .insertInto('products')
        .values({ id: PRODUCT_ID, tenant_id: TENANT_ID, category_id: CATEGORY_ID, name: 'Test Ürün', price_cents: PRICE, is_active: true })
        .execute();

      ctx.adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payment_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('areas').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await db.destroy();
    });

    // ─── G: çift-iptal reddi ────────────────────────────────────────────────
    it('G: cancelled order tekrar cancel → 409 ORDER_CANCEL_NOT_ALLOWED', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1);
      const first = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(first.status).toBe(200);

      const second = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe('ORDER_CANCEL_NOT_ALLOWED');
    });

    // ─── H: paid order cancel reddi ─────────────────────────────────────────
    it('H: paid order → cancel → 409 ORDER_CANCEL_NOT_ALLOWED (Mod B sonrası terminal)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1);
      const pay = await request(ctx.app!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: PRICE,
          idempotencyKey: randomUUID(),
          operation: 'pay_and_close',
        });
      expect(pay.status).toBe(201);

      const cancelRes = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(cancelRes.status).toBe(409);
      expect(cancelRes.body.error?.code).toBe('ORDER_CANCEL_NOT_ALLOWED');
    });

    // ─── I: cancelled order addItems reddi (ORD-STATE-01'in kontrastı) ─────
    it('I: cancelled order\'a POST /orders/:id/items → 409 ORDER_INVARIANT_VIOLATED (terminal-check DOĞRU çalışıyor — merged HARİÇ)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1);
      const cancelRes = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(cancelRes.status).toBe(200);

      const addRes = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }] });
      expect(addRes.status).toBe(409);
      expect(addRes.body.error?.code).toBe('ORDER_INVARIANT_VIOLATED');

      const order = await orderRow(orderId);
      expect(order.total_cents).toBe(0); // reddedilen istek total'i değiştirmez
    });

    // ─── J: void order addItems reddi ──────────────────────────────────────
    it('J: void order\'a POST /orders/:id/items → 409 ORDER_INVARIANT_VIOLATED', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1);
      // Uygulamada 'void' statüsüne geçiren canlı bir HTTP yolu YOK (payments-
      // void.test.ts'teki "terminal order (void)" senaryosuyla aynı desen) —
      // doğrudan DB'de set edilir.
      await ctx
        .db!.updateTable('orders')
        .set({ status: 'void' })
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', orderId)
        .execute();

      const addRes = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }] });
      expect(addRes.status).toBe(409);
      expect(addRes.body.error?.code).toBe('ORDER_INVARIANT_VIOLATED');
    });
  },
);
