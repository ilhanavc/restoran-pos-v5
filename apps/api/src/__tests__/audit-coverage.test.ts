import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { ALLOWED_KEYS } from '@restoran-pos/shared-domain';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * ADR-024 — Audit Coverage Gap Closure (comp / void / dine-in close).
 *
 * ADR-003 §10.5/§12.6 MVP zorunluluğu: ikram (comp), kalem void ve masa
 * kapatma/tahsilat audit izi bırakır. Yöntem (K1): parasal repo metotlarına
 * tx-variant kardeş (updateItemTx/payOrderTx/payments.createTx); route tek
 * transaction'da repo-tx + writeAudit çağırır (ADR-002 §10.4).
 *
 * NOT: Lokalde DATABASE_URL yoksa describe.skipIf tüm bloğu SKIP eder; gerçek
 * PostgreSQL CI'da koşar. Audit doğrulama paterni `orders.takeaway.test.ts`
 * precedent'inden: ctx.db.selectFrom('audit_logs').where(...).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TABLE_ID = randomUUID();
const TABLE_CODE = `AUD-${randomUUID().slice(0, 6)}`;

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-aud-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-aud-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-aud-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-aud-${randomUUID().slice(0, 8)}`;

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 5000;
const ORDER_QTY = 2;
const ORDER_TOTAL = PRODUCT_PRICE * ORDER_QTY; // 10000 (1 item, qty 2)

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
  cashierToken?: string;
}

async function login(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

/** Yeni dine-in sipariş (tek kalem, qty=2). order_item id döner. */
async function createOrder(
  app: Express,
  token: string,
): Promise<{ orderId: string; itemId: string }> {
  const res = await request(app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId: TABLE_ID,
      orderType: 'dine_in',
      items: [{ productId: PRODUCT_ID, quantity: ORDER_QTY }],
    });
  const orderId = res.body.data.order.id as string;
  const itemId = res.body.data.items[0].id as string;
  return { orderId, itemId };
}

async function payAmount(
  app: Express,
  token: string,
  orderId: string,
  amountCents: number,
  operation: 'pay' | 'pay_and_close',
  idempotencyKey: string,
): Promise<request.Response> {
  return request(app)
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderId,
      paymentType: 'cash',
      paymentScope: 'full',
      amountCents,
      idempotencyKey,
      operation,
    });
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-024 audit coverage (comp / void / dine-in close)',
  () => {
    const ctx: Ctx = {};

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

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Audit Coverage Tenant',
          slug: `t-aud-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      const cashierHash = await hashPassword(CASHIER_PASSWORD);
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

      ctx.adminToken = await login(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
      ctx.cashierToken = await login(ctx.app, CASHIER_EMAIL, CASHIER_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payment_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await db.destroy();
    });

    /** Her test öncesi sipariş/ödeme/audit temizliği — izole sayım. */
    async function reset(): Promise<void> {
      const db = ctx.db!;
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payment_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
    }

    async function auditRows(
      eventType: string,
      entityId: string,
    ): Promise<Array<{ payload: unknown }>> {
      return ctx
        .db!.selectFrom('audit_logs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', eventType)
        .where('entity_id', '=', entityId)
        .execute();
    }

    // 1 — comp toggle → order_item.comped satırı + payload alanları
    it('comp toggle → order_item.comped audit + before/after/amount doğru', async () => {
      await reset();
      const { orderId, itemId } = await createOrder(ctx.app!, ctx.adminToken!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ isComped: true });
      expect(res.status).toBe(200);

      const rows = await auditRows('order_item.comped', itemId);
      expect(rows).toHaveLength(1);
      const payload = rows[0]!.payload as Record<string, unknown>;
      expect(payload['order_id']).toBe(orderId);
      expect(payload['order_item_id']).toBe(itemId);
      expect(payload['product_id']).toBe(PRODUCT_ID);
      expect(payload['is_comped_before']).toBe(false);
      expect(payload['is_comped_after']).toBe(true);
      expect(payload['amount_cents']).toBe(ORDER_TOTAL);
    });

    // 2 — comp no-op (zaten comped) → audit satırı YAZILMAZ
    it('comp no-op (zaten comped) → ikinci toggle audit artırmaz', async () => {
      await reset();
      const { orderId, itemId } = await createOrder(ctx.app!, ctx.adminToken!);

      await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ isComped: true });
      // İkinci kez aynı değer → no-op (before==after) → audit yok.
      await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ isComped: true });

      const rows = await auditRows('order_item.comped', itemId);
      expect(rows).toHaveLength(1);
    });

    // 3 — void kalem → order_item.voided satırı + status_before doğru
    it('void kalem → order_item.voided audit + status_before doğru', async () => {
      await reset();
      const { orderId, itemId } = await createOrder(ctx.app!, ctx.adminToken!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);

      const rows = await auditRows('order_item.voided', itemId);
      expect(rows).toHaveLength(1);
      const payload = rows[0]!.payload as Record<string, unknown>;
      expect(payload['order_id']).toBe(orderId);
      expect(payload['order_item_id']).toBe(itemId);
      expect(payload['product_id']).toBe(PRODUCT_ID);
      // Mutfak kalemi sipariş oluşturulurken otomatik 'sent'e geçer (PR-4b KDS
      // enqueue akışı); void anındaki gerçek status_before = 'sent'. Audit bunu
      // doğru kaydeder (önceki 'new' beklentisi implementer varsayımıydı).
      expect(payload['status_before']).toBe('sent');
      expect(payload['amount_cents']).toBe(ORDER_TOTAL);
    });

    // 4 — Mod B pay_and_close (PATCH /:id paid) → order.paid + amount=total
    it('Mod B PATCH /:id paid → order.paid audit + amount_cents=total', async () => {
      await reset();
      const { orderId } = await createOrder(ctx.app!, ctx.adminToken!);
      await payAmount(
        ctx.app!,
        ctx.cashierToken!,
        orderId,
        ORDER_TOTAL,
        'pay',
        randomUUID(),
      );

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'paid' });
      expect(res.status).toBe(200);

      const rows = await auditRows('order.paid', orderId);
      expect(rows).toHaveLength(1);
      const payload = rows[0]!.payload as Record<string, unknown>;
      expect(payload['order_id']).toBe(orderId);
      expect(payload['payment_type']).toBe('mixed');
      expect(payload['amount_cents']).toBe(ORDER_TOTAL);
    });

    // 5 — Mod A POST /payments pay_and_close → payment.created + order.paid
    it('Mod A pay_and_close → payment.created (order_closed) + order.paid', async () => {
      await reset();
      const { orderId } = await createOrder(ctx.app!, ctx.adminToken!);

      const res = await payAmount(
        ctx.app!,
        ctx.cashierToken!,
        orderId,
        ORDER_TOTAL,
        'pay_and_close',
        randomUUID(),
      );
      expect(res.status).toBe(201);
      const paymentId = res.body.data.payment.id as string;

      const createdRows = await auditRows('payment.created', paymentId);
      expect(createdRows).toHaveLength(1);
      const cp = createdRows[0]!.payload as Record<string, unknown>;
      expect(cp['order_id']).toBe(orderId);
      expect(cp['payment_id']).toBe(paymentId);
      expect(cp['payment_type']).toBe('cash');
      expect(cp['amount_cents']).toBe(ORDER_TOTAL);
      expect(cp['operation']).toBe('pay_and_close');
      expect(cp['order_closed']).toBe(true);

      const paidRows = await auditRows('order.paid', orderId);
      expect(paidRows).toHaveLength(1);
    });

    // 6 — Partial payment (operation=pay) → payment.created (order_closed=false),
    //     order.paid YAZILMAZ
    it('partial pay → payment.created order_closed=false, order.paid yok', async () => {
      await reset();
      const { orderId } = await createOrder(ctx.app!, ctx.adminToken!);

      const res = await payAmount(
        ctx.app!,
        ctx.cashierToken!,
        orderId,
        Math.floor(ORDER_TOTAL / 2),
        'pay',
        randomUUID(),
      );
      expect(res.status).toBe(201);
      const paymentId = res.body.data.payment.id as string;

      const createdRows = await auditRows('payment.created', paymentId);
      expect(createdRows).toHaveLength(1);
      const cp = createdRows[0]!.payload as Record<string, unknown>;
      expect(cp['order_closed']).toBe(false);
      expect(cp['operation']).toBe('pay');

      const paidRows = await auditRows('order.paid', orderId);
      expect(paidRows).toHaveLength(0);
    });

    // 7 — idempotency replay → ikinci POST audit artırmaz (#194 + audit no-op)
    it('idempotency replay → audit satırı artmaz', async () => {
      await reset();
      const { orderId } = await createOrder(ctx.app!, ctx.adminToken!);
      const key = randomUUID();

      const first = await payAmount(
        ctx.app!,
        ctx.cashierToken!,
        orderId,
        Math.floor(ORDER_TOTAL / 2),
        'pay',
        key,
      );
      expect(first.status).toBe(201);
      const paymentId = first.body.data.payment.id as string;

      // Aynı key → replay (200, body.replay=true). Yeni audit YAZILMAZ.
      const second = await payAmount(
        ctx.app!,
        ctx.cashierToken!,
        orderId,
        Math.floor(ORDER_TOTAL / 2),
        'pay',
        key,
      );
      expect(second.status).toBe(200);
      expect(second.body.data.replay).toBe(true);

      const createdRows = await auditRows('payment.created', paymentId);
      expect(createdRows).toHaveLength(1);
    });

    // 8 — payload PII-safe: yeni event'ler whitelist tam + deny-list miss yok.
    //     Pure unit-style check (DB gerektirmez ama suite içinde tutuldu).
    it('payload PII-safe — yeni event whitelist alanları tam', () => {
      expect(ALLOWED_KEYS['order_item.comped']).toEqual([
        'order_id',
        'order_item_id',
        'product_id',
        'is_comped_before',
        'is_comped_after',
        'amount_cents',
      ]);
      expect(ALLOWED_KEYS['order_item.voided']).toEqual([
        'order_id',
        'order_item_id',
        'product_id',
        'status_before',
        'amount_cents',
      ]);
      expect(ALLOWED_KEYS['payment.created']).toEqual([
        'order_id',
        'payment_id',
        'payment_type',
        'payment_scope',
        'amount_cents',
        'operation',
        'order_closed',
      ]);
      // refund v5.1 — BOŞ kalır.
      expect(ALLOWED_KEYS['payment.refunded']).toEqual([]);
    });

    // 9 — Mutation rollback → audit rollback (atomicity). Mod B underpaid close
    //     fail eder → order.paid audit YAZILMAZ (writeAudit aynı trx'te).
    it('rollback atomicity — underpaid close fail → order.paid audit yok', async () => {
      await reset();
      const { orderId } = await createOrder(ctx.app!, ctx.adminToken!);
      // Hiç ödeme yok → payOrderTx PAYMENT_INSUFFICIENT_FOR_CLOSE fırlatır,
      // tx rollback → order.paid audit INSERT'i de geri alınır.
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ status: 'paid' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_INSUFFICIENT_FOR_CLOSE');

      const rows = await auditRows('order.paid', orderId);
      expect(rows).toHaveLength(0);
    });
  },
);
