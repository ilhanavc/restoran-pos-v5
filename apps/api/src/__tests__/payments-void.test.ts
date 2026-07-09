import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { Server as IoServer } from 'socket.io';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * ADR-033 — POST /payments/:paymentId/void ("Ödeme Düzeltme: aynı-gün void +
 * masa/adisyon reopen"). Faz 1 backend finansal çekirdek testleri.
 *
 * Test matrisi (ADR-033 DoD 9 senaryo):
 *   1. paid dine_in void → auto-reopen (status open, masa dolu, emit, audit×2)
 *   2. reopen'da masa dolu → TABLE_ALREADY_OCCUPIED + TAM rollback (void geri)
 *   3. açık order kısmi void → reopen YOK, remaining artar
 *   4. cross-day (order.store_date < bugün) → PAYMENT_VOID_CROSS_DAY
 *   5. çift void → PAYMENT_ALREADY_VOIDED
 *   6. terminal order (cancelled/void) → PAYMENT_VOID_ORDER_TERMINAL
 *   7. split payer void → o payer'ın remaining_quantity geri döner
 *   8. RBAC: waiter/kitchen 403; cashier 200 (K6 admin+cashier)
 *   9. regresyon: voided ödeme close-invariant + rapor SUM'ından DÜŞÜLÜR
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-vd-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-vd-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-vd-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-vd-${randomUUID().slice(0, 8)}@example.com`;
const KITCHEN_PASSWORD = 'kitchenpass1234';

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const AREA_ID = randomUUID();

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
  return { io: { of: ofMock } as unknown as IoServer, emitSpy, toMock, ofMock };
}

function findEmits(mockIo: MockIo, event: string): Array<[string, unknown]> {
  return mockIo.emitSpy.mock.calls.filter((c) => c[0] === event) as Array<
    [string, unknown]
  >;
}

function routedTo(mockIo: MockIo, room: string): boolean {
  return mockIo.toMock.mock.calls.some((c) => c[0] === room);
}

function clearEmits(mockIo: MockIo): void {
  mockIo.emitSpy.mockClear();
  mockIo.toMock.mockClear();
  mockIo.ofMock.mockClear();
}

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  mockIo?: MockIo;
  adminToken?: string;
  cashierToken?: string;
  waiterToken?: string;
  kitchenToken?: string;
  prevBypass?: string | undefined;
}

const ctx: Ctx = {};

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app!).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

/** Fresh empty table (real area → snapshot area_name non-null). */
async function insertTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-VD-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

/** Dine-in sipariş (total = qty * 5000). */
async function createDineInOrder(
  token: string,
  tableId: string,
  qty = 1,
): Promise<string> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId, orderType: 'dine_in', items: [{ productId: PRODUCT_ID, quantity: qty }] });
  if (res.status !== 201) {
    throw new Error(`dine-in POST failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.order.id as string;
}

/** pay_and_close (scope=full) → order paid; returns payment id. */
async function payAndClose(
  token: string,
  orderId: string,
  amountCents: number,
  paymentType: 'cash' | 'card' = 'cash',
): Promise<string> {
  const res = await request(ctx.app!)
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderId,
      paymentType,
      paymentScope: 'full',
      amountCents,
      idempotencyKey: randomUUID(),
      operation: 'pay_and_close',
    });
  if (res.status !== 201) {
    throw new Error(`payAndClose failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.payment.id as string;
}

/** partial payment (order stays open); returns payment id. */
async function payPartial(
  token: string,
  orderId: string,
  amountCents: number,
): Promise<string> {
  const res = await request(ctx.app!)
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderId,
      paymentType: 'cash',
      paymentScope: 'partial',
      amountCents,
      idempotencyKey: randomUUID(),
      operation: 'pay',
    });
  if (res.status !== 201) {
    throw new Error(`payPartial failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.payment.id as string;
}

function voidPayment(token: string, paymentId: string, reasonCode = 'wrong_payment_type') {
  return request(ctx.app!)
    .post(`/payments/${paymentId}/void`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reasonCode });
}

async function firstItemId(orderId: string): Promise<string> {
  const item = await ctx
    .db!.selectFrom('order_items')
    .select(['id'])
    .where('tenant_id', '=', TENANT_ID)
    .where('order_id', '=', orderId)
    .executeTakeFirstOrThrow();
  return item.id;
}

async function orderStatus(orderId: string): Promise<string> {
  const o = await ctx
    .db!.selectFrom('orders')
    .select(['status'])
    .where('tenant_id', '=', TENANT_ID)
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  return o.status;
}

async function paymentVoidedAt(paymentId: string): Promise<Date | null> {
  const p = await ctx
    .db!.selectFrom('payments')
    .select(['voided_at'])
    .where('tenant_id', '=', TENANT_ID)
    .where('id', '=', paymentId)
    .executeTakeFirstOrThrow();
  return (p.voided_at as Date | null) ?? null;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'POST /payments/:paymentId/void (ADR-033 ödeme void + reopen)',
  () => {
    beforeAll(async () => {
      ctx.prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';

      const pool = createPool({ connectionString: DB_URL! });
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
        .values({ id: TENANT_ID, name: 'Void Tenant', slug: `t-vd-${TENANT_ID.slice(0, 8)}` })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const [adminHash, cashierHash, waiterHash, kitchenHash] = await Promise.all([
        hashPassword(ADMIN_PASSWORD),
        hashPassword(CASHIER_PASSWORD),
        hashPassword(WAITER_PASSWORD),
        hashPassword(KITCHEN_PASSWORD),
      ]);
      await db
        .insertInto('users')
        .values([
          { id: ADMIN_ID, tenant_id: TENANT_ID, email: ADMIN_EMAIL, username: `admin-vd-${randomUUID().slice(0, 6)}`, password_hash: adminHash, role: 'admin' },
          { id: CASHIER_ID, tenant_id: TENANT_ID, email: CASHIER_EMAIL, username: `cashier-vd-${randomUUID().slice(0, 6)}`, password_hash: cashierHash, role: 'cashier' },
          { id: WAITER_ID, tenant_id: TENANT_ID, email: WAITER_EMAIL, username: `waiter-vd-${randomUUID().slice(0, 6)}`, password_hash: waiterHash, role: 'waiter' },
          { id: KITCHEN_ID, tenant_id: TENANT_ID, email: KITCHEN_EMAIL, username: `kitchen-vd-${randomUUID().slice(0, 6)}`, password_hash: kitchenHash, role: 'kitchen' },
        ])
        .execute();

      await db.insertInto('areas').values({ id: AREA_ID, tenant_id: TENANT_ID, name: 'Salon' }).execute();
      await db.insertInto('categories').values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Yemekler' }).execute();
      await db
        .insertInto('products')
        .values({ id: PRODUCT_ID, tenant_id: TENANT_ID, category_id: CATEGORY_ID, name: 'Test Ürün', price_cents: 5000, is_active: true })
        .execute();

      ctx.adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      ctx.cashierToken = await login(CASHIER_EMAIL, CASHIER_PASSWORD);
      ctx.waiterToken = await login(WAITER_EMAIL, WAITER_PASSWORD);
      ctx.kitchenToken = await login(KITCHEN_EMAIL, KITCHEN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db !== undefined) {
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
      }
      if (ctx.prevBypass === undefined) delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      else process.env['E2E_BYPASS_LOGIN_LIMIT'] = ctx.prevBypass;
    });

    // ─── 1 ────────────────────────────────────────────────────────────────
    it('paid dine_in void → auto-reopen (open) + masa dolu + emit paid:false + audit×2', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 1);
      const paymentId = await payAndClose(ctx.adminToken!, orderId, 5000);
      expect(await orderStatus(orderId)).toBe('paid');

      clearEmits(ctx.mockIo!);
      const res = await voidPayment(ctx.adminToken!, paymentId, 'wrong_payment_type');
      expect(res.status).toBe(200);
      expect(res.body.data.reopened).toBe(true);

      // Payment voided; order reopened.
      expect(await paymentVoidedAt(paymentId)).not.toBeNull();
      expect(await orderStatus(orderId)).toBe('open');

      // Masa dolu (reopened order aktif → board occupied).
      const board = await request(ctx.app!).get('/tables').set('Authorization', `Bearer ${ctx.adminToken!}`);
      const tables = board.body.data.tables as Array<{ id: string; status: string }>;
      expect(tables.find((t) => t.id === tableId)?.status).toBe('occupied');

      // Emit orders.statusChanged {paid:false} tenant room.
      const emits = findEmits(ctx.mockIo!, 'orders.statusChanged');
      expect(emits.length).toBe(1);
      expect((emits[0]![1] as { paid: boolean; takeawayStage: unknown }).paid).toBe(false);
      expect((emits[0]![1] as { takeawayStage: unknown }).takeawayStage).toBeNull();
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);

      // Audit payment.voided + order.reopened, PII-safe.
      const voidedAudit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['payload', 'actor_user_id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'payment.voided')
        .where('entity_id', '=', paymentId)
        .executeTakeFirstOrThrow();
      expect(voidedAudit.actor_user_id).toBe(ADMIN_ID);
      const vp = voidedAudit.payload as { void_reason_code: string; order_reopened: boolean; amount_cents: number };
      expect(vp.void_reason_code).toBe('wrong_payment_type');
      expect(vp.order_reopened).toBe(true);
      expect(vp.amount_cents).toBe(5000);

      const reopenAudit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.reopened')
        .where('entity_id', '=', orderId)
        .executeTakeFirstOrThrow();
      const rp = reopenAudit.payload as { previous_status: string; table_id: string; payable_cents: number };
      expect(rp.previous_status).toBe('paid');
      expect(rp.table_id).toBe(tableId);
      expect(rp.payable_cents).toBe(5000);
    });

    // ─── 2 ────────────────────────────────────────────────────────────────
    it('reopen\'da masa dolu → TABLE_ALREADY_OCCUPIED + TAM rollback (void geri)', async () => {
      const tableId = await insertTable();
      const orderA = await createDineInOrder(ctx.adminToken!, tableId, 1);
      const paymentA = await payAndClose(ctx.adminToken!, orderA, 5000); // A paid → masa boş
      // Aynı masaya yeni aktif sipariş B (A paid olduğu için index izin verir).
      const orderB = await createDineInOrder(ctx.adminToken!, tableId, 1);
      expect(await orderStatus(orderB)).toBe('open');

      clearEmits(ctx.mockIo!);
      const res = await voidPayment(ctx.adminToken!, paymentA, 'wrong_table');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TABLE_ALREADY_OCCUPIED');

      // TAM rollback: A hâlâ paid, ödeme void DEĞİL, B hâlâ open.
      expect(await orderStatus(orderA)).toBe('paid');
      expect(await paymentVoidedAt(paymentA)).toBeNull();
      expect(await orderStatus(orderB)).toBe('open');
      // Reddedilen yol emit üretmemeli.
      expect(findEmits(ctx.mockIo!, 'orders.statusChanged').length).toBe(0);
      // payment.voided audit yazılmamalı (tx rollback).
      const audit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'payment.voided')
        .where('entity_id', '=', paymentA)
        .execute();
      expect(audit.length).toBe(0);
    });

    // ─── 3 ────────────────────────────────────────────────────────────────
    it('açık order kısmi void → reopen YOK, remaining_total geri artar', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 2); // total 10000
      const paymentId = await payPartial(ctx.adminToken!, orderId, 4000); // open
      expect(await orderStatus(orderId)).toBe('open');

      clearEmits(ctx.mockIo!);
      const res = await voidPayment(ctx.adminToken!, paymentId, 'wrong_amount');
      expect(res.status).toBe(200);
      expect(res.body.data.reopened).toBe(false);
      expect(await orderStatus(orderId)).toBe('open'); // reopen YOK — açıktı, açık kalır

      // split-state: paidTotal 0, remaining full (void'lenmiş ödeme düşer).
      const ss = await request(ctx.app!)
        .get(`/payments/orders/${orderId}/split-state`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(ss.body.data.totals.paid_total_cents).toBe(0);
      expect(ss.body.data.totals.remaining_total_cents).toBe(10000);

      // reopened false → emit YOK + order.reopened audit YOK.
      expect(findEmits(ctx.mockIo!, 'orders.statusChanged').length).toBe(0);
      const reopenAudit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.reopened')
        .where('entity_id', '=', orderId)
        .execute();
      expect(reopenAudit.length).toBe(0);
    });

    // ─── 4 ────────────────────────────────────────────────────────────────
    it('cross-day (order.store_date < bugün) → PAYMENT_VOID_CROSS_DAY', async () => {
      // store_date append-only trigger (UPDATE reddeder) → dünkü gün için order+
      // payment'ı DOĞRUDAN geçmiş created_at ile INSERT et; populate trigger
      // store_date'i created_at'ten hesaplar (2020) → cross-day guard tetiklenir.
      const tableId = await insertTable();
      const orderId = randomUUID();
      const paymentId = randomUUID();
      const pastTs = new Date('2020-01-01T10:00:00Z');
      await ctx.db!
        .insertInto('orders')
        .values({
          id: orderId,
          tenant_id: TENANT_ID,
          table_id: tableId,
          order_type: 'dine_in',
          status: 'paid',
          order_no: 90000 + Math.floor(Math.random() * 9999),
          store_date: pastTs,
          created_at: pastTs,
          total_cents: 5000,
        })
        .execute();
      await ctx.db!
        .insertInto('payments')
        .values({
          id: paymentId,
          tenant_id: TENANT_ID,
          order_id: orderId,
          payment_type: 'cash',
          payment_scope: 'full',
          amount_cents: 5000,
          idempotency_key: randomUUID(),
          created_by_user_id: ADMIN_ID,
        })
        .execute();

      const res = await voidPayment(ctx.adminToken!, paymentId, 'wrong_payment_type');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_VOID_CROSS_DAY');
      // Guard update ÖNCESİ → ödeme void DEĞİL, order hâlâ paid.
      expect(await paymentVoidedAt(paymentId)).toBeNull();
      expect(await orderStatus(orderId)).toBe('paid');
    });

    // ─── 5 ────────────────────────────────────────────────────────────────
    it('çift void → PAYMENT_ALREADY_VOIDED', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 1);
      const paymentId = await payAndClose(ctx.adminToken!, orderId, 5000);

      const first = await voidPayment(ctx.adminToken!, paymentId, 'duplicate');
      expect(first.status).toBe(200);
      const second = await voidPayment(ctx.adminToken!, paymentId, 'duplicate');
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('PAYMENT_ALREADY_VOIDED');
    });

    // ─── 6 ────────────────────────────────────────────────────────────────
    it('terminal order (cancelled) → PAYMENT_VOID_ORDER_TERMINAL', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 1);
      const paymentId = await payPartial(ctx.adminToken!, orderId, 3000); // open + payment
      await ctx
        .db!.updateTable('orders')
        .set({ status: 'cancelled' })
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', orderId)
        .execute();

      const res = await voidPayment(ctx.adminToken!, paymentId, 'other');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_VOID_ORDER_TERMINAL');
      expect(await paymentVoidedAt(paymentId)).toBeNull();
    });

    it('terminal order (void) → PAYMENT_VOID_ORDER_TERMINAL', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 1);
      const paymentId = await payPartial(ctx.adminToken!, orderId, 3000);
      await ctx
        .db!.updateTable('orders')
        .set({ status: 'void' })
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', orderId)
        .execute();

      const res = await voidPayment(ctx.adminToken!, paymentId, 'other');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_VOID_ORDER_TERMINAL');
    });

    // ─── 7 ────────────────────────────────────────────────────────────────
    it('split payer void → o payer\'ın remaining_quantity geri döner', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 2); // 1 kalem qty 2
      const itemId = await firstItemId(orderId);

      // Payer 1: item-scope, qty 1 (5000). Order açık kalır.
      const payRes = await request(ctx.app!)
        .post('/payments')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'item',
          amountCents: 5000,
          idempotencyKey: randomUUID(),
          operation: 'pay',
          payerNo: 1,
          itemAllocations: [{ orderItemId: itemId, quantity: 1 }],
        });
      expect(payRes.status).toBe(201);
      const paymentId = payRes.body.data.payment.id as string;

      // Void ÖNCESİ remaining_quantity = 1 (2 - 1 allocated).
      const before = await request(ctx.app!)
        .get(`/payments/orders/${orderId}/split-state`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(before.body.data.items.find((i: { id: string }) => i.id === itemId).remaining_quantity).toBe(1);

      const res = await voidPayment(ctx.adminToken!, paymentId, 'wrong_table');
      expect(res.status).toBe(200);
      expect(res.body.data.reopened).toBe(false);

      // Void SONRASI remaining_quantity = 2 (allocation geri döndü).
      const after = await request(ctx.app!)
        .get(`/payments/orders/${orderId}/split-state`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(after.body.data.items.find((i: { id: string }) => i.id === itemId).remaining_quantity).toBe(2);
      expect(after.body.data.totals.paid_total_cents).toBe(0);
      expect(after.body.data.allocations.length).toBe(0);
    });

    // ─── 8 ────────────────────────────────────────────────────────────────
    it('RBAC: waiter 403, kitchen 403, cashier 200 (K6 admin+cashier)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 1);
      const paymentId = await payAndClose(ctx.adminToken!, orderId, 5000);

      const waiterRes = await voidPayment(ctx.waiterToken!, paymentId, 'other');
      expect(waiterRes.status).toBe(403);
      const kitchenRes = await voidPayment(ctx.kitchenToken!, paymentId, 'other');
      expect(kitchenRes.status).toBe(403);
      // 403 sonrası ödeme hâlâ aktif.
      expect(await paymentVoidedAt(paymentId)).toBeNull();

      // Cashier void EDEBİLİR (200) — K6 admin+cashier.
      const cashierRes = await voidPayment(ctx.cashierToken!, paymentId, 'wrong_payment_type');
      expect(cashierRes.status).toBe(200);
      expect(cashierRes.body.data.reopened).toBe(true);
    });

    // ─── 9a — close-invariant regresyonu ───────────────────────────────────
    it('regresyon: voided ödeme close-invariant SUM\'ından düşülür (yeniden kapatılabilir)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 1); // total 5000
      const partialId = await payPartial(ctx.adminToken!, orderId, 5000); // open, paidTotal 5000
      const voidRes = await voidPayment(ctx.adminToken!, partialId, 'wrong_payment_type');
      expect(voidRes.status).toBe(200);
      expect(voidRes.body.data.reopened).toBe(false); // order açıktı

      // Void'lenmiş 5000 close-check'e SAYILMAZ → yeni 5000 full ile kapatılabilir.
      // (Yoksa SUM=10000 > 5000 → PAYMENT_EXCEEDS_TOTAL veriyordu.)
      const closeId = await payAndClose(ctx.adminToken!, orderId, 5000);
      expect(closeId).toBeTruthy();
      expect(await orderStatus(orderId)).toBe('paid');
    });

    // ─── 9b — rapor SUM regresyonu (kardeş-testlerden bağımsız DELTA) ────────
    it('regresyon: void→reopen→reclose sonrası paid order\'da voided ödeme rapor cirosuna SAYILMAZ', async () => {
      // payment-distribution TÜM paid order'ları toplar (kardeş testler kirletir)
      // → mutlak assertion kırılgan. Bu order'ın NET katkısını DELTA ile ölç.
      const segmentsNow = async (): Promise<Record<string, number>> => {
        const dist = await request(ctx.app!)
          .get('/reports/payment-distribution?range=today')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(dist.status).toBe(200);
        const map: Record<string, number> = {};
        for (const s of dist.body.data.segments as Array<{ paymentType: string; totalCents: number }>) {
          map[s.paymentType] = s.totalCents;
        }
        return map;
      };

      const before = await segmentsNow();
      const tableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, tableId, 1); // total 5000
      const cashId = await payAndClose(ctx.adminToken!, orderId, 5000, 'cash'); // paid (cash)
      await voidPayment(ctx.adminToken!, cashId, 'wrong_payment_type'); // reopen
      await payAndClose(ctx.adminToken!, orderId, 5000, 'card'); // reclose (card)
      // Order şimdi paid: cash(voided) + card(aktif) satırları var.
      const after = await segmentsNow();

      // NET katkı: card +5000 (aktif), cash +0 (voided cash SAYILMAZ). Filtre
      // olmasaydı cash da +5000 çıkardı (paid order'da voided satır kalıyor).
      expect((after['card'] ?? 0) - (before['card'] ?? 0)).toBe(5000);
      expect((after['cash'] ?? 0) - (before['cash'] ?? 0)).toBe(0);
    });
  },
);
