import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { Server as IoServer } from 'socket.io';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { ALLOWED_KEYS } from '@restoran-pos/shared-domain';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * ADR-035 — POST /orders/:orderId/items/:itemId/move ("Ürün-Bazlı Adisyon
 * Taşıma"): yanlış masaya girilen TEK ürünü doğru masanın adisyonuna aktarır.
 * `orders-merge.test.ts` fixture/harness'inin kalem-düzeyi ikizi.
 *
 * Test matrisi (ürün sahibi kararları S1-S12):
 *   1. happy dolu hedef → re-parent + snapshot AYNI + özellik satırları taşındı
 *      + iki taraf total doğru + 2× tables.changed + audit `order_item.moved`
 *   2. S3 boş hedef → otomatik yeni adisyon (garson = işlemi yapan) + masa doldu
 *   3. S8 kaynak boşalınca `merged` + merged_into + audit `source_closed:true`
 *      ve AYRI `order.merged` YAZILMAZ (S11)
 *   4. S4 hiçbir fiş kuyruğa girmez (print_jobs delta = 0)
 *   5. S5 ödenmiş kalem → 409 ORDER_ITEM_ALREADY_PAID
 *   6. ADR-014 Amd3 — kaynak toplamı tahsilatın altına düşerse 409
 *      ORDER_TOTAL_BELOW_PAID
 *   7. S6 iptal edilmiş kalem → 409 ORDER_ITEM_NOT_MOVABLE · S7 ikram taşınır
 *   8. S1 takeaway kaynak → 409 ORDER_NOT_DINE_IN
 *   9. S10 farklı store_date → 409 ORDER_MOVE_CROSS_DAY (dolu VE boş hedef)
 *  10. S9 RBAC waiter 200 / kitchen 403
 *  11. cross-tenant kaynak → 404 ORDER_NOT_FOUND · cross-tenant masa → 404
 *      TABLE_NOT_FOUND
 *  12. S12 aynı kalemin ikinci taşıması → 404 ORDER_ITEM_NOT_FOUND (yarış dahil)
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const FOREIGN_TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-im-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `admin-im-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-im-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_USERNAME = `waiter-im-${randomUUID().slice(0, 8)}`;
const WAITER_PASSWORD = 'waiterpass1234';

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-im-${randomUUID().slice(0, 8)}@example.com`;
const KITCHEN_USERNAME = `kitchen-im-${randomUUID().slice(0, 8)}`;
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
      code: `M-IM-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

/** Dine-in sipariş (`itemCount` ayrı kalem satırı, her biri 5000 kuruş). */
async function createDineInOrder(
  token: string,
  tableId: string,
  itemCount = 1,
): Promise<string> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: Array.from({ length: itemCount }, () => ({
        productId: PRODUCT_ID,
        quantity: 1,
      })),
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

async function itemIdsOf(orderId: string): Promise<string[]> {
  const rows = await ctx
    .db!.selectFrom('order_items')
    .select(['id'])
    .where('tenant_id', '=', TENANT_ID)
    .where('order_id', '=', orderId)
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map((r) => r.id);
}

/** Dağıtılmamış (payment_items'sız) ödeme — ORDER_TOTAL_BELOW_PAID fixture'ı. */
async function insertPayment(
  orderId: string,
  amountCents: number,
): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('payments')
    .values({
      id,
      tenant_id: TENANT_ID,
      order_id: orderId,
      payment_type: 'cash',
      payment_scope: 'full',
      amount_cents: amountCents,
      idempotency_key: randomUUID(),
      created_by_user_id: ADMIN_ID,
    })
    .execute();
  return id;
}

/** Kalemin KENDİSİNE tahsis edilmiş ödeme (S5 guard fixture'ı). */
async function allocatePaymentToItem(
  paymentId: string,
  itemId: string,
  amountCents: number,
): Promise<void> {
  await ctx.db!
    .insertInto('payment_items')
    .values({
      payment_id: paymentId,
      order_item_id: itemId,
      tenant_id: TENANT_ID,
      quantity: 1,
      unit_price_cents_snapshot: amountCents,
      line_total_cents: amountCents,
    })
    .execute();
}

/**
 * DÜNKÜ iş gününe ait açık adisyon (S10 fixture'ı). `store_date` UPDATE ile
 * değiştirilemez (`reject_temporal_update` append-only) ve INSERT'te
 * `orders_populate_store_date` trigger'ı onu `created_at`'ten türetir → geçmiş
 * `created_at` ile INSERT etmek TEK yoldur.
 */
let pastOrderNo = 9000;
async function insertYesterdayOrder(
  tableId: string,
): Promise<{ orderId: string; itemId: string }> {
  const orderId = randomUUID();
  const itemId = randomUUID();
  // `orders_tenant_store_date_order_no_uq`: aynı geçmiş güne ikinci fixture
  // eklenirken numara çakışmasın (sayaç tablosu bu yolda kullanılmıyor).
  pastOrderNo += 1;
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await ctx.db!
    .insertInto('orders')
    .values({
      id: orderId,
      tenant_id: TENANT_ID,
      table_id: tableId,
      order_type: 'dine_in',
      order_no: pastOrderNo,
      status: 'open',
      total_cents: 5000,
      created_at: twoDaysAgo,
      // store_date trigger tarafından created_at'ten hesaplanır (yazılan değer
      // yok sayılır) — kolon NOT NULL olduğu için yer tutucu veriyoruz.
      store_date: twoDaysAgo,
      waiter_user_id: ADMIN_ID,
      table_code_snapshot: 'M-PAST',
      area_name_snapshot: 'Salon',
    })
    .execute();
  await ctx.db!
    .insertInto('order_items')
    .values({
      id: itemId,
      tenant_id: TENANT_ID,
      order_id: orderId,
      product_id: PRODUCT_ID,
      product_name: 'Test Ürün',
      category_name_snapshot: 'Yemekler',
      unit_price_cents: 5000,
      quantity: 1,
      total_cents: 5000,
      created_by_user_id: ADMIN_ID,
      created_by_name: 'Admin',
    })
    .execute();
  return { orderId, itemId };
}

async function printJobCount(): Promise<number> {
  const row = await ctx
    .db!.selectFrom('print_jobs')
    .select(({ fn }) => fn.countAll<string>().as('cnt'))
    .where('tenant_id', '=', TENANT_ID)
    .executeTakeFirstOrThrow();
  return Number(row.cnt);
}

function moveUrl(orderId: string, itemId: string): string {
  return `/orders/${orderId}/items/${itemId}/move`;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'POST /orders/:orderId/items/:itemId/move (ADR-035 Ürün-Bazlı Taşıma)',
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
            name: `ItemMove Tenant ${tid.slice(0, 8)}`,
            slug: `t-im-${tid.slice(0, 8)}`,
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
          full_name: 'Taşıma Müşteri',
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
          await db.deleteFrom('print_jobs').where('tenant_id', '=', tid).execute();
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

    it('happy (dolu hedef) → 200 + re-parent + özellikler taşındı + iki total doğru + 2× emit + audit', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      // Kaynak 2 kalem (10000), hedef 1 kalem (5000). 1 kalem taşınır →
      // kaynak 5000, hedef 10000.
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
      const [movedItemId] = await itemIdsOf(sourceOrderId);

      // Kalem snapshot'ları + özellik satırı (re-parent bunlara DOKUNMAMALI).
      const before = await ctx
        .db!.selectFrom('order_items')
        .select([
          'product_name',
          'unit_price_cents',
          'total_cents',
          'created_by_name',
          'created_at',
          'status',
        ])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', movedItemId!)
        .executeTakeFirstOrThrow();
      const attrId = randomUUID();
      await ctx
        .db!.insertInto('order_item_attributes')
        .values({
          id: attrId,
          tenant_id: TENANT_ID,
          order_item_id: movedItemId!,
          attribute_group_id: randomUUID(),
          attribute_option_id: randomUUID(),
          group_name_snapshot: 'Pişirme',
          option_name_snapshot: 'Az pişmiş',
          extra_price_cents_snapshot: 0,
        })
        .execute();

      const jobsBefore = await printJobCount();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, movedItemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });

      expect(res.status).toBe(200);
      // Yanıt = KAYNAK projeksiyonu; kardeş PATCH ile aynı şekil {order, items}.
      expect(res.body.data.order.id).toBe(sourceOrderId);
      expect(res.body.data.order.total_cents).toBe(5000);
      expect(res.body.data.items.length).toBe(1);

      // Re-parent: order_id değişti, snapshot'lar AYNI (ADR-003 §7).
      const after = await ctx
        .db!.selectFrom('order_items')
        .select([
          'order_id',
          'product_name',
          'unit_price_cents',
          'total_cents',
          'created_by_name',
          'created_at',
          'status',
        ])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', movedItemId!)
        .executeTakeFirstOrThrow();
      expect(after.order_id).toBe(targetOrderId);
      expect(after.product_name).toBe(before.product_name);
      expect(after.unit_price_cents).toBe(before.unit_price_cents);
      expect(after.total_cents).toBe(before.total_cents);
      expect(after.created_by_name).toBe(before.created_by_name);
      expect(after.created_at.getTime()).toBe(before.created_at.getTime());
      expect(after.status).toBe(before.status);

      // Özellik snapshot'ı kalemle birlikte gitti (order_item_id'ye bağlı).
      const attrRow = await ctx
        .db!.selectFrom('order_item_attributes')
        .innerJoin('order_items', 'order_items.id', 'order_item_attributes.order_item_id')
        .select(['order_items.order_id as order_id'])
        .where('order_item_attributes.id', '=', attrId)
        .executeTakeFirstOrThrow();
      expect(attrRow.order_id).toBe(targetOrderId);

      // İki taraf total.
      const totals = await ctx
        .db!.selectFrom('orders')
        .select(['id', 'total_cents', 'status'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', 'in', [sourceOrderId, targetOrderId])
        .execute();
      expect(totals.find((o) => o.id === sourceOrderId)!.total_cents).toBe(5000);
      expect(totals.find((o) => o.id === sourceOrderId)!.status).not.toBe('merged');
      expect(totals.find((o) => o.id === targetOrderId)!.total_cents).toBe(10000);

      // S4 — HİÇBİR fiş kuyruğa girmez (bilgi fişi de yok).
      expect(await printJobCount()).toBe(jobsBefore);

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

      // Audit üçlü kontratı (c): tek `order_item.moved` olayı + TAM payload.
      // ALLOWED_KEYS'ten bir anahtar düşerse burada sessizce undefined olur →
      // test kırmızıya döner (S104 dersi).
      const audit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['event_type', 'entity_type', 'entity_id', 'actor_user_id', 'payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order_item.moved')
        .where('entity_id', '=', movedItemId!)
        .execute();
      expect(audit.length).toBe(1);
      expect(audit[0]!.entity_type).toBe('order_item');
      expect(audit[0]!.actor_user_id).toBe(ADMIN_ID);
      const payload = audit[0]!.payload as Record<string, unknown>;
      expect(payload['order_item_id']).toBe(movedItemId);
      expect(payload['product_id']).toBe(PRODUCT_ID);
      expect(payload['from_order_id']).toBe(sourceOrderId);
      expect(payload['to_order_id']).toBe(targetOrderId);
      expect(payload['from_table_id']).toBe(sourceTableId);
      expect(payload['to_table_id']).toBe(targetTableId);
      expect(payload['from_table_code']).not.toBeNull();
      expect(payload['to_table_code']).not.toBeNull();
      expect(payload['quantity']).toBe(1);
      expect(payload['amount_cents']).toBe(5000);
      expect(payload['source_closed']).toBe(false);
      expect(payload['target_created']).toBe(false);
      // Whitelist ile birebir: handler ALLOWED_KEYS dışında anahtar yazmamalı.
      for (const key of Object.keys(payload)) {
        expect(ALLOWED_KEYS['order_item.moved']).toContain(key);
      }
    });

    it('S3 boş hedef → otomatik yeni adisyon açılır (garson = işlemi yapan) + masa dolar', async () => {
      const sourceTableId = await insertTable();
      const emptyTargetId = await insertTable();
      const sourceOrderId = await createDineInOrder(
        ctx.waiterToken!,
        sourceTableId,
        2,
      );
      const [movedItemId] = await itemIdsOf(sourceOrderId);
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, movedItemId!))
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ targetTableId: emptyTargetId });
      expect(res.status).toBe(200);

      // Hedef masada YENİ adisyon: kalem orada, total 5000, garson = actor.
      const created = await ctx
        .db!.selectFrom('orders')
        .select(['id', 'total_cents', 'status', 'waiter_user_id', 'order_type', 'table_code_snapshot'])
        .where('tenant_id', '=', TENANT_ID)
        .where('table_id', '=', emptyTargetId)
        .executeTakeFirstOrThrow();
      expect(created.total_cents).toBe(5000);
      expect(created.status).toBe('open');
      expect(created.order_type).toBe('dine_in');
      expect(created.waiter_user_id).toBe(WAITER_ID);
      expect(created.table_code_snapshot).not.toBeNull();

      const movedRow = await ctx
        .db!.selectFrom('order_items')
        .select(['order_id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', movedItemId!)
        .executeTakeFirstOrThrow();
      expect(movedRow.order_id).toBe(created.id);

      // Masa tahtası: hedef masa artık DOLU.
      const board = await request(ctx.app!)
        .get('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      const tables = board.body.data.tables as Array<{ id: string; status: string }>;
      expect(tables.find((t) => t.id === emptyTargetId)?.status).toBe('occupied');

      // audit: target_created = true.
      const audit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order_item.moved')
        .where('entity_id', '=', movedItemId!)
        .executeTakeFirstOrThrow();
      expect((audit.payload as Record<string, unknown>)['target_created']).toBe(true);
      // 2× emit (kaynak + yeni açılan hedef).
      expect(findEmits(ctx.mockIo!, 'tables.changed').length).toBe(2);
    });

    it('S8 kaynağın SON kalemi taşınırsa → merged + merged_into + source_closed audit (order.merged YAZILMAZ)', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 1);
      const targetOrderId = await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const [movedItemId] = await itemIdsOf(sourceOrderId);

      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, movedItemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(200);

      const sourceRow = await ctx
        .db!.selectFrom('orders')
        .select(['status', 'merged_into_order_id', 'total_cents'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceOrderId)
        .executeTakeFirstOrThrow();
      // İPTAL DEĞİL — `merged` (iptal raporu kirlenmesin, S8).
      expect(sourceRow.status).toBe('merged');
      expect(sourceRow.merged_into_order_id).toBe(targetOrderId);
      expect(sourceRow.total_cents).toBe(0);

      // Kaynak masa board'da boşaldı.
      const board = await request(ctx.app!)
        .get('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      const tables = board.body.data.tables as Array<{ id: string; status: string }>;
      expect(tables.find((t) => t.id === sourceTableId)?.status).toBe('available');

      // S11 — tek olay: source_closed=true VE ayrıca order.merged YOK.
      const moved = await ctx
        .db!.selectFrom('audit_logs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order_item.moved')
        .where('entity_id', '=', movedItemId!)
        .executeTakeFirstOrThrow();
      expect((moved.payload as Record<string, unknown>)['source_closed']).toBe(true);
      const mergedEvents = await ctx
        .db!.selectFrom('audit_logs')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.merged')
        .where('entity_id', '=', targetOrderId)
        .execute();
      expect(mergedEvents.length).toBe(0);
    });

    it('S7 ikram kalemi taşınır (tutar 0, iki total da etkilenmez)', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 2);
      const targetOrderId = await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const [compedItemId] = await itemIdsOf(sourceOrderId);

      const comp = await request(ctx.app!)
        .patch(`/orders/${sourceOrderId}/items/${compedItemId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ isComped: true });
      expect(comp.status).toBe(200);

      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, compedItemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(200);

      const rows = await ctx
        .db!.selectFrom('orders')
        .select(['id', 'total_cents'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', 'in', [sourceOrderId, targetOrderId])
        .execute();
      // İkram tutarı hiçbir tarafta toplama girmez (ADR-013 recalc formülü).
      expect(rows.find((o) => o.id === sourceOrderId)!.total_cents).toBe(5000);
      expect(rows.find((o) => o.id === targetOrderId)!.total_cents).toBe(5000);
      const moved = await ctx
        .db!.selectFrom('order_items')
        .select(['order_id', 'is_comped'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', compedItemId!)
        .executeTakeFirstOrThrow();
      expect(moved.order_id).toBe(targetOrderId);
      expect(moved.is_comped).toBe(true);
    });

    it('S6 iptal edilmiş kalem → 409 ORDER_ITEM_NOT_MOVABLE', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 2);
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const [cancelledItemId] = await itemIdsOf(sourceOrderId);
      // Doğrudan DB — auto-cancel/fiş yan etkileri olmadan guard'ı izole eder.
      await ctx
        .db!.updateTable('order_items')
        .set({ status: 'cancelled' })
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', cancelledItemId!)
        .execute();

      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, cancelledItemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_ITEM_NOT_MOVABLE');
    });

    it('S5 kalemin KENDİSİ ödenmiş → 409 ORDER_ITEM_ALREADY_PAID', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 2);
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const [paidItemId, freeItemId] = await itemIdsOf(sourceOrderId);
      const paymentId = await insertPayment(sourceOrderId, 5000);
      await allocatePaymentToItem(paymentId, paidItemId!, 5000);

      const blocked = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, paidItemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('ORDER_ITEM_ALREADY_PAID');

      // S5'in diğer yüzü: ödenmemiş kalem, kısmi ödenmiş adisyondan taşınabilir
      // (kaynak toplamı 5000'e düşer = tahsil edilen 5000 → tavana çarpmaz).
      const allowed = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, freeItemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(allowed.status).toBe(200);
    });

    it('ADR-014 Amd3 — kaynak toplamı tahsilatın ALTINA düşerse 409 ORDER_TOTAL_BELOW_PAID', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 2);
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const [itemId] = await itemIdsOf(sourceOrderId);
      // Dağıtılmamış 8000 tahsilat: kalem taşınırsa toplam 5000 < 8000.
      await insertPayment(sourceOrderId, 8000);

      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, itemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_TOTAL_BELOW_PAID');

      // Rollback kanıtı: kalem kaynakta kaldı, toplam değişmedi.
      const row = await ctx
        .db!.selectFrom('order_items')
        .select(['order_id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', itemId!)
        .executeTakeFirstOrThrow();
      expect(row.order_id).toBe(sourceOrderId);
      const order = await ctx
        .db!.selectFrom('orders')
        .select(['total_cents'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceOrderId)
        .executeTakeFirstOrThrow();
      expect(order.total_cents).toBe(10000);
    });

    it('S1 takeaway kaynak → 409 ORDER_NOT_DINE_IN', async () => {
      const targetTableId = await insertTable();
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const takeawayId = await createTakeawayOrder(ctx.adminToken!);
      const [itemId] = await itemIdsOf(takeawayId);
      const res = await request(ctx.app!)
        .post(moveUrl(takeawayId, itemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_DINE_IN');
    });

    it('S10 farklı store_date (dolu hedef) → 409 ORDER_MOVE_CROSS_DAY', async () => {
      const pastTableId = await insertTable();
      const targetTableId = await insertTable();
      const past = await insertYesterdayOrder(pastTableId);
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);

      const res = await request(ctx.app!)
        .post(moveUrl(past.orderId, past.itemId))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_MOVE_CROSS_DAY');
    });

    it('S10 farklı store_date (BOŞ hedef) → 409 ORDER_MOVE_CROSS_DAY (yeni adisyon AÇILMAZ)', async () => {
      // Boş hedefte açılan adisyonun store_date\'i trigger tarafından BUGÜNE
      // sabitlenir → dünkü kalemi taşımak günü kaydırırdı; guard bunu keser.
      const pastTableId = await insertTable();
      const emptyTargetId = await insertTable();
      const past = await insertYesterdayOrder(pastTableId);

      const res = await request(ctx.app!)
        .post(moveUrl(past.orderId, past.itemId))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: emptyTargetId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_MOVE_CROSS_DAY');
      // Hayalet adisyon doğmamalı (tx rollback).
      const ghost = await ctx
        .db!.selectFrom('orders')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('table_id', '=', emptyTargetId)
        .execute();
      expect(ghost.length).toBe(0);
    });

    it('hedef masa = kalemin kendi masası → 409 ITEM_MOVE_SAME_ORDER', async () => {
      const sourceTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 1);
      const [itemId] = await itemIdsOf(sourceOrderId);
      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, itemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: sourceTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ITEM_MOVE_SAME_ORDER');
    });

    it('kaynak terminal (paid) → 409 ORDER_ALREADY_CLOSED', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 1);
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const [itemId] = await itemIdsOf(sourceOrderId);
      await ctx
        .db!.updateTable('orders')
        .set({ status: 'paid' })
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceOrderId)
        .execute();
      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, itemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_ALREADY_CLOSED');
    });

    it('cross-tenant: kaynak sipariş yok → 404 ORDER_NOT_FOUND', async () => {
      const targetTableId = await insertTable();
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const res = await request(ctx.app!)
        .post(moveUrl(randomUUID(), randomUUID()))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('cross-tenant hedef masa → 404 TABLE_NOT_FOUND (yabancı masaya adisyon açılmaz)', async () => {
      const foreignTableId = randomUUID();
      await ctx
        .db!.insertInto('tables')
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
      const [itemId] = await itemIdsOf(sourceOrderId);
      const res = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, itemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: foreignTableId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TABLE_NOT_FOUND');
      // Yabancı tenant'ta sipariş doğmamalı.
      const leaked = await ctx
        .db!.selectFrom('orders')
        .select(['id'])
        .where('tenant_id', '=', FOREIGN_TENANT_ID)
        .execute();
      expect(leaked.length).toBe(0);
    });

    it('geçersiz UUID path parametresi → 400 (22P02 değil)', async () => {
      const targetTableId = await insertTable();
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const res = await request(ctx.app!)
        .post('/orders/not-a-uuid/items/also-not-a-uuid/move')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(res.status).toBe(400);
    });

    it('S9 RBAC: waiter 200 · kitchen 403', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.waiterToken!, sourceTableId, 2);
      await createDineInOrder(ctx.waiterToken!, targetTableId, 1);
      const [firstItem, secondItem] = await itemIdsOf(sourceOrderId);

      const kitchenRes = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, firstItem!))
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ targetTableId });
      expect(kitchenRes.status).toBe(403);

      const waiterRes = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, secondItem!))
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ targetTableId });
      expect(waiterRes.status).toBe(200);
    });

    it('S12 aynı kalemi ikinci kez taşıma → 404 ORDER_ITEM_NOT_FOUND', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      // 2 kalem: ilk taşımadan sonra kaynak AÇIK kalır (merged olmaz) →
      // ikinci istek gerçekten "kalem bu adisyonda yok" yoluna düşer.
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 2);
      await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const [itemId] = await itemIdsOf(sourceOrderId);

      const first = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, itemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(first.status).toBe(200);

      const second = await request(ctx.app!)
        .post(moveUrl(sourceOrderId, itemId!))
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(second.status).toBe(404);
      expect(second.body.error.code).toBe('ORDER_ITEM_NOT_FOUND');
    });

    it('S12 iki terminal AYNI ANDA aynı kalemi taşırsa → biri 200, diğeri 404 (çift taşıma yok)', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 2);
      const targetOrderId = await createDineInOrder(ctx.adminToken!, targetTableId, 1);
      const [itemId] = await itemIdsOf(sourceOrderId);

      const send = (): Promise<{ status: number }> =>
        request(ctx.app!)
          .post(moveUrl(sourceOrderId, itemId!))
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ targetTableId }) as unknown as Promise<{ status: number }>;
      const [a, b] = await Promise.all([send(), send()]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([200, 404]);

      // Tutar bir kez taşındı (çift sayım yok) + tek audit olayı.
      const targetRow = await ctx
        .db!.selectFrom('orders')
        .select(['total_cents'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', targetOrderId)
        .executeTakeFirstOrThrow();
      expect(targetRow.total_cents).toBe(10000);
      const audits = await ctx
        .db!.selectFrom('audit_logs')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order_item.moved')
        .where('entity_id', '=', itemId!)
        .execute();
      expect(audits.length).toBe(1);
    });
  },
);
