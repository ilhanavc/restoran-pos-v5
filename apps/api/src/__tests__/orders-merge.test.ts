import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { Server as IoServer } from 'socket.io';
import {
  createPool,
  createKysely,
  createTablesRepository,
  TERMINAL_ORDER_STATUSES,
  type DB,
} from '@restoran-pos/db';
import { OrderStatusSchema } from '@restoran-pos/shared-types';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * ADR-029 — POST /orders/:sourceOrderId/merge ("Adisyon Birleştir").
 *
 * Kaynak dolu masanın adisyonunu, seçilen BAŞKA bir DOLU masanın adisyonuna
 * aktarır: kaynak order_items hedefe re-parent, kaynak terminal (`merged`).
 * `orders-move-table.test.ts` fixture/harness'inin ikizi.
 *
 * Test matrisi (ADR-029 K9):
 *   1. happy → 200 + re-parent (order_id değişti, snapshot AYNI) + hedef
 *      total_cents birleşik + kaynak status='merged'+merged_into + 2× tables.changed
 *      (kaynak+hedef, tenant room) + audit order.merged (PII-safe payload)
 *   2. same order (hedef masa = kaynağın masası) → 409 MERGE_SAME_ORDER
 *   3. hedef masa boş → 409 MERGE_TARGET_NOT_OCCUPIED
 *   4. ödeme var (kaynak veya hedef) → 409 ORDER_HAS_PAYMENTS
 *   5. kaynak/hedef takeaway → 409 ORDER_NOT_DINE_IN
 *   6. kaynak/hedef terminal (paid) → 409 ORDER_ALREADY_CLOSED
 *   7. kaynak yok / cross-tenant → 404 ORDER_NOT_FOUND
 *   8. RBAC waiter → 200; kitchen → 403
 *   9. idempotency: merged kaynağı tekrar merge → 409 ORDER_ALREADY_CLOSED
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const FOREIGN_TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-mg-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `admin-mg-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-mg-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_USERNAME = `waiter-mg-${randomUUID().slice(0, 8)}`;
const WAITER_PASSWORD = 'waiterpass1234';

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-mg-${randomUUID().slice(0, 8)}@example.com`;
const KITCHEN_USERNAME = `kitchen-mg-${randomUUID().slice(0, 8)}`;
const KITCHEN_PASSWORD = 'kitchenpass1234';

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const CUSTOMER_ID = randomUUID();
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
  return {
    io: { of: ofMock } as unknown as IoServer,
    emitSpy,
    toMock,
    ofMock,
  };
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
  waiterToken?: string;
  kitchenToken?: string;
  prevBypass?: string | undefined;
}

const ctx: Ctx = {};

async function login(
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

/** Fresh empty table with a real area (snapshot area_name non-null). */
async function insertTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-MG-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

/** Dine-in sipariş oluşturur; `qty` kalem miktarı (total = qty * 5000). */
async function createDineInOrder(
  token: string,
  tableId: string,
  qty = 1,
): Promise<string> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: [{ productId: PRODUCT_ID, quantity: qty }],
    });
  if (res.status !== 201) {
    throw new Error(
      `dine-in POST failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.order.id as string;
}

async function createTakeawayOrder(token: string): Promise<string> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'takeaway',
      customerId: CUSTOMER_ID,
      plannedPaymentType: 'cash',
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
    });
  if (res.status !== 201) {
    throw new Error(
      `takeaway POST failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.id as string;
}

/** Minimal ödeme kaydı — ORDER_HAS_PAYMENTS guard fixture'ı. */
async function insertPayment(orderId: string, amountCents: number): Promise<void> {
  await ctx.db!
    .insertInto('payments')
    .values({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      order_id: orderId,
      payment_type: 'cash',
      payment_scope: 'full',
      amount_cents: amountCents,
      idempotency_key: randomUUID(),
      created_by_user_id: ADMIN_ID,
    })
    .execute();
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'POST /orders/:sourceOrderId/merge (ADR-029 Adisyon Birleştir)',
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

      for (const tid of [TENANT_ID, FOREIGN_TENANT_ID]) {
        await db
          .insertInto('tenants')
          .values({
            id: tid,
            name: `Merge Tenant ${tid.slice(0, 8)}`,
            slug: `t-mg-${tid.slice(0, 8)}`,
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
      const waiterHash = await hashPassword(WAITER_PASSWORD);
      const kitchenHash = await hashPassword(KITCHEN_PASSWORD);
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
          {
            id: KITCHEN_ID,
            tenant_id: TENANT_ID,
            email: KITCHEN_EMAIL,
            username: KITCHEN_USERNAME,
            password_hash: kitchenHash,
            role: 'kitchen',
          },
        ])
        .execute();

      await db
        .insertInto('areas')
        .values({ id: AREA_ID, tenant_id: TENANT_ID, name: 'Salon' })
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
          price_cents: 5000,
          is_active: true,
        })
        .execute();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_ID,
          tenant_id: TENANT_ID,
          full_name: 'Merge Müşteri',
        })
        .execute();

      ctx.adminToken = await login(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
      ctx.waiterToken = await login(ctx.app, WAITER_EMAIL, WAITER_PASSWORD);
      ctx.kitchenToken = await login(ctx.app, KITCHEN_EMAIL, KITCHEN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db !== undefined) {
        for (const tid of [TENANT_ID, FOREIGN_TENANT_ID]) {
          await db.deleteFrom('payment_items').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('order_item_attributes').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('order_no_counters').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('audit_logs').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('products').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('customers').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('areas').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('refresh_tokens').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('users').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('tenant_settings').where('tenant_id', '=', tid).execute();
          await db.deleteFrom('tenants').where('id', '=', tid).execute();
        }
        await db.destroy();
      }
      if (ctx.prevBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = ctx.prevBypass;
      }
    });

    it('happy → 200, re-parent + hedef total birleşik + kaynak merged + 2× tables.changed + audit', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      // Kaynak: 2 adet (10000), hedef: 1 adet (5000) → birleşik 15000.
      const sourceOrderId = await createDineInOrder(
        ctx.adminToken!,
        sourceTableId,
        2,
      );
      const targetOrderId = await createDineInOrder(
        ctx.adminToken!,
        targetTableId,
        1,
      );

      // Kaynak kalem satırının snapshot değerlerini birleştirmeden ÖNCE yakala.
      const sourceItemBefore = await ctx
        .db!.selectFrom('order_items')
        .select(['id', 'product_name', 'unit_price_cents', 'total_cents'])
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', sourceOrderId)
        .executeTakeFirstOrThrow();

      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });

      expect(res.status).toBe(200);
      // 200 = HEDEF sipariş projeksiyonu (hayatta kalan).
      expect(res.body.data.id).toBe(targetOrderId);
      expect(res.body.data.totalCents).toBe(15000);

      // Kaynak kalem hedefe re-parent — order_id değişti, snapshot AYNI.
      const movedItem = await ctx
        .db!.selectFrom('order_items')
        .select(['order_id', 'product_name', 'unit_price_cents', 'total_cents'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceItemBefore.id)
        .executeTakeFirstOrThrow();
      expect(movedItem.order_id).toBe(targetOrderId);
      expect(movedItem.product_name).toBe(sourceItemBefore.product_name);
      expect(movedItem.unit_price_cents).toBe(sourceItemBefore.unit_price_cents);
      expect(movedItem.total_cents).toBe(sourceItemBefore.total_cents);

      // Hedef total_cents = birleşik toplam.
      const targetRow = await ctx
        .db!.selectFrom('orders')
        .select(['total_cents', 'status'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', targetOrderId)
        .executeTakeFirstOrThrow();
      expect(targetRow.total_cents).toBe(15000);
      expect(targetRow.status).not.toBe('merged');

      // Kaynak terminal: status='merged' + merged_into_order_id=hedef + total_cents=0.
      const sourceRow = await ctx
        .db!.selectFrom('orders')
        .select(['status', 'merged_into_order_id', 'total_cents', 'table_code_snapshot'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceOrderId)
        .executeTakeFirstOrThrow();
      expect(sourceRow.status).toBe('merged');
      expect(sourceRow.merged_into_order_id).toBe(targetOrderId);
      // R3: kalemler taşındı → kaynakta hayalet tutar kalmamalı.
      expect(sourceRow.total_cents).toBe(0);

      // Kaynakta hiç kalem kalmamalı (hepsi taşındı).
      const remaining = await ctx
        .db!.selectFrom('order_items')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', sourceOrderId)
        .execute();
      expect(remaining.length).toBe(0);

      // 2× tables.changed {updated} — kaynak + hedef, tenant room.
      const emits = findEmits(ctx.mockIo!, 'tables.changed');
      expect(emits.length).toBe(2);
      const tableIds = emits.map((e) => (e[1] as { tableId: string }).tableId);
      expect(tableIds).toContain(sourceTableId);
      expect(tableIds).toContain(targetTableId);
      for (const e of emits) {
        expect((e[1] as { action: string }).action).toBe('updated');
      }
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);

      // Audit order.merged + PII-safe payload + actor.
      const audit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['event_type', 'entity_id', 'actor_user_id', 'payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.merged')
        .where('entity_id', '=', targetOrderId)
        .execute();
      expect(audit.length).toBe(1);
      expect(audit[0]!.actor_user_id).toBe(ADMIN_ID);
      const payload = audit[0]!.payload as {
        source_order_id: string;
        target_order_id: string;
        source_table_id: string;
        target_table_id: string;
        source_table_code: string | null;
        moved_item_count: number;
        old_total_cents: number;
        new_total_cents: number;
      };
      expect(payload.source_order_id).toBe(sourceOrderId);
      expect(payload.target_order_id).toBe(targetOrderId);
      expect(payload.source_table_id).toBe(sourceTableId);
      expect(payload.target_table_id).toBe(targetTableId);
      // ADR-029 Karar E adım 6: snapshot masa kodu (forensic). Boş/yanlış field
      // regresyonunu yakalar — kaynak siparişin table_code_snapshot'ı ile hizalı.
      expect(payload.source_table_code).not.toBeNull();
      expect(payload.source_table_code).toBe(sourceRow.table_code_snapshot);
      expect(payload.moved_item_count).toBe(1);
      expect(payload.old_total_cents).toBe(5000);
      expect(payload.new_total_cents).toBe(15000);
    });

    it('happy sonrası → kaynak masa board\'da AVAILABLE + silinebilir (R3 blocker regresyonu)', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 1);
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);

      const merge = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(merge.status).toBe(200);

      // Board: kaynak masa artık BOŞ (merged terminal → aktif-sipariş türetiminde
      // yok), hedef masa DOLU. Blocker: merged eski blacklist'te olmadığı için
      // kaynak DOLU kalıyordu → tables.ts baseQuery TERMINAL_ORDER_STATUSES'a hizalandı.
      const board = await request(ctx.app!)
        .get('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(board.status).toBe(200);
      const tables = board.body.data.tables as Array<{ id: string; status: string }>;
      expect(tables.find((t) => t.id === sourceTableId)?.status).toBe('available');
      expect(tables.find((t) => t.id === targetTableId)?.status).toBe('occupied');

      // Silme-guard: hasActiveOrders artık merged'i AKTİF saymaz → kaynak masa
      // silme-guard'ı geçer (409 TABLE_ALREADY_OCCUPIED yok). Repo'yu DOĞRUDAN
      // çağırıyoruz; DELETE endpoint'i ADR-029-DIŞI pre-existing bir FK bug'ına
      // takılır (orders_table_id_tenant_id_fkey composite ON DELETE SET NULL,
      // tenant_id'yi de null'lar → 500; herhangi bir terminal siparişi olan
      // masayı da etkiler, ayrı task ile takip ediliyor). Blocker fix = guard.
      const tablesRepo = createTablesRepository(ctx.db!);
      const stillActive = await tablesRepo.hasActiveOrders(TENANT_ID, sourceTableId);
      expect(stillActive).toBe(false);
    });

    it('cross-tenant hedef masa → 409 MERGE_TARGET_NOT_OCCUPIED (isolation, 404 değil)', async () => {
      // Başka tenant'a ait masa: istekçinin tenant'ında aktif-sipariş sorgusu hiç
      // eşleşmez → 409 (varlık ifşası yok; kaynak-404'ten AYRI kod yolu). qa-lens.
      const foreignTableId = randomUUID();
      await ctx.db!
        .insertInto('tables')
        .values({
          id: foreignTableId,
          tenant_id: FOREIGN_TENANT_ID,
          code: `M-FG-${randomUUID().slice(0, 6)}`,
          capacity: 4,
          area_id: null,
        })
        .execute();
      const sourceTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 1);
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: foreignTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MERGE_TARGET_NOT_OCCUPIED');
    });

    it('kaynak terminal (cancelled) → 409 ORDER_ALREADY_CLOSED', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      await createDineInOrder(ctx.adminToken!, targetTableId);
      await ctx
        .db!.updateTable('orders')
        .set({ status: 'cancelled' })
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceOrderId)
        .execute();
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_ALREADY_CLOSED');
    });

    it('kaynak terminal (void) → 409 ORDER_ALREADY_CLOSED', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      await createDineInOrder(ctx.adminToken!, targetTableId);
      await ctx
        .db!.updateTable('orders')
        .set({ status: 'void' })
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceOrderId)
        .execute();
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_ALREADY_CLOSED');
    });

    it('same order (hedef masa = kaynağın masası) → 409 MERGE_SAME_ORDER', async () => {
      const sourceTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: sourceTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MERGE_SAME_ORDER');
    });

    it('hedef masa boş → 409 MERGE_TARGET_NOT_OCCUPIED', async () => {
      const sourceTableId = await insertTable();
      const emptyTargetId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: emptyTargetId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MERGE_TARGET_NOT_OCCUPIED');
      // Reddedilen yol emit üretmemeli.
      expect(findEmits(ctx.mockIo!, 'tables.changed').length).toBe(0);
    });

    it('kaynakta ödeme var → 409 ORDER_HAS_PAYMENTS', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      await createDineInOrder(ctx.adminToken!, targetTableId);
      await insertPayment(sourceOrderId, 5000);
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_HAS_PAYMENTS');
    });

    it('hedefte ödeme var → 409 ORDER_HAS_PAYMENTS', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      const targetOrderId = await createDineInOrder(ctx.adminToken!, targetTableId);
      await insertPayment(targetOrderId, 5000);
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_HAS_PAYMENTS');
    });

    it('kaynak takeaway → 409 ORDER_NOT_DINE_IN', async () => {
      // Takeaway siparişin masası yok; hedef dolu bir dine_in masa seç.
      const targetTableId = await insertTable();
      await createDineInOrder(ctx.adminToken!, targetTableId);
      const takeawayId = await createTakeawayOrder(ctx.adminToken!);
      const res = await request(ctx.app!)
        .post(`/orders/${takeawayId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_DINE_IN');
    });

    it('kaynak terminal (paid) → 409 ORDER_ALREADY_CLOSED', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      await createDineInOrder(ctx.adminToken!, targetTableId);
      // Kaynağı doğrudan terminal duruma çek (guard'ı izole test eder).
      await ctx
        .db!.updateTable('orders')
        .set({ status: 'paid' })
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceOrderId)
        .execute();
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_ALREADY_CLOSED');
    });

    it('kaynak yok / cross-tenant → 404 ORDER_NOT_FOUND (varlık sızıntısı yok)', async () => {
      const targetTableId = await insertTable();
      await createDineInOrder(ctx.adminToken!, targetTableId);
      const res = await request(ctx.app!)
        .post(`/orders/${randomUUID()}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('RBAC waiter → 200', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.waiterToken!, sourceTableId);
      await createDineInOrder(ctx.waiterToken!, targetTableId);
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(200);
    });

    it('RBAC kitchen → 403', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      await createDineInOrder(ctx.adminToken!, targetTableId);
      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(403);
    });

    it('idempotency: merged kaynağı tekrar merge → 409 ORDER_ALREADY_CLOSED', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      await createDineInOrder(ctx.adminToken!, targetTableId);

      const first = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(first.status).toBe(200);

      // Kaynak artık 'merged' (terminal) — tekrar merge terminal guard'a takılır.
      // Hedef masa artık boş (kaynak masası) → yeni bir dolu hedef gerekir; ama
      // kaynak zaten terminal olduğundan guard önce ORDER_ALREADY_CLOSED verir.
      const newTargetTableId = await insertTable();
      await createDineInOrder(ctx.adminToken!, newTargetTableId);
      const second = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: newTargetTableId });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ORDER_ALREADY_CLOSED');
    });
  },
);

/**
 * ADR-029 R3 drift-guard — DB gerektirmez (saf birim). Yeni bir `order_status`
 * enum değeri eklenip aktif/terminal olarak sınıflandırılmazsa CI'ı kırar; bu,
 * blocker'ın kök nedenini (yeni terminal statü tüm aktif-sipariş türetimlerine
 * yayılmadı) yakalar. Yeni statü eklenince GÜNCELLE: (1) Migration index
 * whitelist, (2) TERMINAL_ORDER_STATUSES, (3) aşağıdaki ACTIVE_WHITELIST.
 */
describe('ADR-029 terminal-statü drift guard (order_status sınıflandırması)', () => {
  // Migration 042 partial index whitelist ile BİREBİR aynı olmalı.
  const ACTIVE_WHITELIST = [
    'open',
    'sent_to_kitchen',
    'partially_served',
    'served',
    'billed',
  ] as const;

  it('her OrderStatus tam olarak aktif VEYA terminal (exhaustive + disjoint) + merged terminal', () => {
    const all = new Set<string>(OrderStatusSchema.options);
    const active = new Set<string>(ACTIVE_WHITELIST);
    const terminal = new Set<string>(TERMINAL_ORDER_STATUSES);

    // merged terminal olmalı (R3 blocker'ın kök nedeni).
    expect(terminal.has('merged')).toBe(true);

    // disjoint: hiçbir statü hem aktif hem terminal olamaz.
    for (const s of active) expect(terminal.has(s)).toBe(false);

    // exhaustive: aktif ∪ terminal == tüm OrderStatus (sınıflandırılmamış statü yok).
    expect(active.size + terminal.size).toBe(all.size);
    for (const s of all) expect(active.has(s) || terminal.has(s)).toBe(true);
  });
});
