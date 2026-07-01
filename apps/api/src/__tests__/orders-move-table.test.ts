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
 * ADR-028 — PATCH /orders/:orderId/table ("Masayı Değiştir").
 *
 * Aktif dine_in siparişi aynı tenant içinde BAŞKA bir BOŞ masaya taşır.
 * Test matrisi (ADR-028 Sonuç):
 *   1. happy → 200 + table_id + snapshot güncellendi + audit order.table_changed
 *      + 2× tables.changed (kaynak+hedef, tenant room)
 *   2. hedef dolu → 409 TABLE_ALREADY_OCCUPIED
 *   3. hedef yok → 404 TABLE_NOT_FOUND
 *   4. cross-tenant hedef → 404 TABLE_NOT_FOUND
 *   5. sipariş yok / cross-tenant → 404 ORDER_NOT_FOUND
 *   6. takeaway sipariş → 409 ORDER_NOT_DINE_IN
 *   7. paid sipariş → 409 ORDER_ALREADY_CLOSED
 *   8. aynı masa → 409 TABLE_MOVE_SAME_TABLE
 *   9. RBAC waiter → 200
 *  10. RBAC kitchen → 403
 *  11. snapshot NULL — bölgesiz hedef masa → area_name_snapshot NULL
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const FOREIGN_TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-mt-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `admin-mt-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-mt-${randomUUID().slice(0, 8)}@example.com`;
const WAITER_USERNAME = `waiter-mt-${randomUUID().slice(0, 8)}`;
const WAITER_PASSWORD = 'waiterpass1234';

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-mt-${randomUUID().slice(0, 8)}@example.com`;
const KITCHEN_USERNAME = `kitchen-mt-${randomUUID().slice(0, 8)}`;
const KITCHEN_PASSWORD = 'kitchenpass1234';

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const CUSTOMER_ID = randomUUID();

const FOREIGN_TABLE_ID = randomUUID();
const AREA_ID = randomUUID();
// Kanonik "Masa N" etiket türetimini gerçekten çalıştırmak için display_no'lu
// hedef masanın bağlandığı ayrı bölge (ADR-028 VERIFY #3, qa MAJOR).
const CANON_AREA_ID = randomUUID();
const CANON_AREA_NAME = 'Bahçe';

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

/** Find every emit call for an event name. */
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

/** Fresh empty table with a real area (so snapshot area_name is non-null). */
async function insertTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-MT-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

/**
 * Fresh empty table WITH a canonical area + explicit display_no → forces the
 * `tableLabel()` "Masa <N>" branch (not the raw-code fallback). Returns both
 * the id and the expected canonical label for literal assertions.
 */
async function insertCanonTable(
  displayNo: number,
): Promise<{ id: string; label: string }> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-CAN-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: CANON_AREA_ID,
      display_no: displayNo,
    })
    .execute();
  return { id, label: `Masa ${displayNo}` };
}

/** Fresh empty table with NO area (orphan) → area_name_snapshot must be NULL. */
async function insertOrphanTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-ORPH-${randomUUID().slice(0, 6)}`,
      capacity: 2,
      area_id: null,
    })
    .execute();
  return id;
}

async function createDineInOrder(token: string, tableId: string): Promise<string> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: [{ productId: PRODUCT_ID, quantity: 1 }],
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

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'PATCH /orders/:orderId/table (ADR-028 Masayı Değiştir)',
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
            name: `Move Table Tenant ${tid.slice(0, 8)}`,
            slug: `t-mt-${tid.slice(0, 8)}`,
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
        .values([
          { id: AREA_ID, tenant_id: TENANT_ID, name: 'Salon' },
          { id: CANON_AREA_ID, tenant_id: TENANT_ID, name: CANON_AREA_NAME },
        ])
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
          full_name: 'Move Table Müşteri',
        })
        .execute();

      // Foreign-tenant table for cross-tenant target test.
      await db
        .insertInto('tables')
        .values({
          id: FOREIGN_TABLE_ID,
          tenant_id: FOREIGN_TENANT_ID,
          code: `M-FGN-${randomUUID().slice(0, 6)}`,
          capacity: 4,
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

    it('happy → 200, table_id + snapshot güncellendi + audit + 2× tables.changed', async () => {
      const sourceTableId = await insertTable();
      // Hedef masa area_id + display_no=7 dolu → tableLabel() KANONİK "Masa 7"
      // dalını gerçekten çalıştırır (raw-code fallback DEĞİL; qa MAJOR + VERIFY #3).
      const target = await insertCanonTable(7);
      const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);

      // Kaynak masanın create-path'te türetilen etiketini yakala (audit
      // from_table_code doğrulaması için).
      const sourceRow = await ctx
        .db!.selectFrom('orders')
        .select(['table_code_snapshot', 'created_at', 'store_date'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      const fromLabel = sourceRow.table_code_snapshot;
      const createdAtBefore = sourceRow.created_at;
      const storeDateBefore = sourceRow.store_date;

      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: target.id });

      expect(res.status).toBe(200);
      expect(res.body.data.tableId).toBe(target.id);

      // Snapshot kolonları hedef masaya güncellendi (tableLabel + areas.name).
      const row = await ctx
        .db!.selectFrom('orders')
        .select([
          'table_id',
          'table_code_snapshot',
          'area_name_snapshot',
          'created_at',
          'store_date',
        ])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(row.table_id).toBe(target.id);
      // Kanonik dal LİTERAL doğrulaması — display_no'lu bölgeli masa "Masa 7".
      expect(row.table_code_snapshot).toBe('Masa 7');
      expect(row.area_name_snapshot).toBe(CANON_AREA_NAME);

      // Temporal invariant: reject_temporal_update trigger tetiklenmemeli —
      // created_at + store_date DEĞİŞMEZ (yalnız table_id + snapshot + updated_at).
      expect(row.created_at).toStrictEqual(createdAtBefore);
      expect(row.store_date).toStrictEqual(storeDateBefore);

      // Audit: order.table_changed + doğru payload + actor.
      const audit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['event_type', 'entity_id', 'actor_user_id', 'payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.table_changed')
        .where('entity_id', '=', orderId)
        .execute();
      expect(audit.length).toBe(1);
      expect(audit[0]!.actor_user_id).toBe(ADMIN_ID);
      const payload = audit[0]!.payload as {
        from_table_id: string;
        to_table_id: string;
        from_table_code: string;
        to_table_code: string;
      };
      expect(payload.from_table_id).toBe(sourceTableId);
      expect(payload.to_table_id).toBe(target.id);
      // Audit code alanları da beklenen etiketler (yalnız id değil).
      expect(payload.from_table_code).toBe(fromLabel);
      expect(payload.to_table_code).toBe('Masa 7');

      // 2× tables.changed {action:'updated'} — kaynak + hedef, tenant room.
      const emits = findEmits(ctx.mockIo!, 'tables.changed');
      expect(emits.length).toBe(2);
      const tableIds = emits.map((e) => (e[1] as { tableId: string }).tableId);
      expect(tableIds).toContain(sourceTableId);
      expect(tableIds).toContain(target.id);
      for (const e of emits) {
        expect((e[1] as { action: string }).action).toBe('updated');
      }
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}`)).toBe(true);
    });

    it('snapshot NULL — bölgesiz hedef masa → area_name_snapshot NULL', async () => {
      const sourceTableId = await insertTable();
      const orphanTableId = await insertOrphanTable();
      const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: orphanTableId });
      expect(res.status).toBe(200);

      const row = await ctx
        .db!.selectFrom('orders')
        .select(['area_name_snapshot', 'table_code_snapshot'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(row.area_name_snapshot).toBeNull();
      // Orphan → tableLabel raw code (display_no NULL için "Masa" değil).
      expect(row.table_code_snapshot).not.toBeNull();
    });

    it('hedef dolu → 409 TABLE_ALREADY_OCCUPIED (kaynak masa değişmez + emit yok)', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      // Hedef masayı başka bir siparişle doldur.
      await createDineInOrder(ctx.adminToken!, targetTableId);
      // Reddedilen yol HİÇBİR realtime emit üretmemeli (FIX 5e).
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TABLE_ALREADY_OCCUPIED');

      // 409 sonrası hiç tables.changed yayılmamalı (rollback + no-op).
      expect(findEmits(ctx.mockIo!, 'tables.changed').length).toBe(0);

      // Kaynak sipariş DEĞİŞMEDEN kalmalı — hâlâ kaynak masada (immutability).
      const row = await ctx
        .db!.selectFrom('orders')
        .select(['table_id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(row.table_id).toBe(sourceTableId);
    });

    it('hedef yok → 404 TABLE_NOT_FOUND', async () => {
      const sourceTableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: randomUUID() });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TABLE_NOT_FOUND');
    });

    it('cross-tenant hedef → 404 TABLE_NOT_FOUND', async () => {
      const sourceTableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: FOREIGN_TABLE_ID });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TABLE_NOT_FOUND');
    });

    it('sipariş yok / cross-tenant → 404 ORDER_NOT_FOUND', async () => {
      const targetTableId = await insertTable();
      const res = await request(ctx.app!)
        .patch(`/orders/${randomUUID()}/table`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: targetTableId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('takeaway sipariş → 409 ORDER_NOT_DINE_IN', async () => {
      const targetTableId = await insertTable();
      const orderId = await createTakeawayOrder(ctx.adminToken!);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: targetTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_NOT_DINE_IN');
    });

    // Terminal status guard: paid | cancelled | void → hepsi 409 (FIX 5c).
    it.each(['paid', 'cancelled', 'void'] as const)(
      'terminal sipariş (%s) → 409 ORDER_ALREADY_CLOSED',
      async (status) => {
        const sourceTableId = await insertTable();
        const targetTableId = await insertTable();
        const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
        // Siparişi doğrudan terminal duruma çek (payment/cancel akışını atlayan
        // minimal fixture — guard'ı izole test eder).
        await ctx
          .db!.updateTable('orders')
          .set({ status })
          .where('tenant_id', '=', TENANT_ID)
          .where('id', '=', orderId)
          .execute();

        const res = await request(ctx.app!)
          .patch(`/orders/${orderId}/table`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ tableId: targetTableId });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ORDER_ALREADY_CLOSED');
      },
    );

    it('aynı masa → 409 TABLE_MOVE_SAME_TABLE', async () => {
      const sourceTableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: sourceTableId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('TABLE_MOVE_SAME_TABLE');
    });

    it('RBAC waiter → 200', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const orderId = await createDineInOrder(ctx.waiterToken!, sourceTableId);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ tableId: targetTableId });
      expect(res.status).toBe(200);
      expect(res.body.data.tableId).toBe(targetTableId);
    });

    it('RBAC kitchen → 403', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ tableId: targetTableId });
      expect(res.status).toBe(403);
    });

    it('rol-only authz — ADMIN siparişini WAITER taşır → 200 (own-order check YOK)', async () => {
      // ADR-028 Karar E: aksiyon salt rol-gate'li; garson için sahiplik (ABAC)
      // kontrolü BİLİNÇLİ olarak yok. Admin'in açtığı siparişi garson taşıyabilir.
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const orderId = await createDineInOrder(ctx.adminToken!, sourceTableId);
      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/table`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ tableId: targetTableId });
      expect(res.status).toBe(200);
      expect(res.body.data.tableId).toBe(targetTableId);
    });

    it('geçersiz UUID orderId path param → 400 (DB\'ye ulaşmadan)', async () => {
      // FIX 1: validateParams non-UUID orderId'yi 22P02→500 yerine 400 yapar.
      const targetTableId = await insertTable();
      const res = await request(ctx.app!)
        .patch('/orders/not-a-uuid/table')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: targetTableId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  },
);
