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
import { signAccessToken } from '../auth/jwt';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;
const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-${randomUUID()}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-${randomUUID().slice(0, 8)}`;
const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-${randomUUID()}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-${randomUUID().slice(0, 8)}`;
const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-${randomUUID()}@example.com`;
const KITCHEN_PASSWORD = 'kitchenpass1234';
const KITCHEN_USERNAME = `kitchen-${randomUUID().slice(0, 8)}`;

// Cross-tenant isolation testleri için ikinci tenant
const TENANT_B_ID = randomUUID();
const ADMIN_B_ID = randomUUID();
const ADMIN_B_EMAIL = `adminb-${randomUUID()}@example.com`;
const ADMIN_B_PASSWORD = 'adminbpass1234';
const ADMIN_B_USERNAME = `adminb-${randomUUID().slice(0, 8)}`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  waiterToken: string;
  kitchenToken: string;
  adminBToken: string;
}

const ctx: Partial<TestCtx> = {};

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
  'POST /tables integration',
  () => {
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
        .values([
          {
            id: TENANT_ID,
            name: 'Test Tenant Tables',
            slug: `test-tables-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'Test Tenant Tables B',
            slug: `test-tables-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      // ADR-003 §11 store_date trigger tenant_settings.business_day_cutoff_hour
      // okur; INSERT olmadan POST /orders → 'tenant_settings missing' RAISE.
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      const cashierHash = await hashPassword(CASHIER_PASSWORD);
      const waiterHash = await hashPassword(WAITER_PASSWORD);
      const kitchenHash = await hashPassword(KITCHEN_PASSWORD);
      const adminBHash = await hashPassword(ADMIN_B_PASSWORD);

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
            id: ADMIN_B_ID,
            tenant_id: TENANT_B_ID,
            email: ADMIN_B_EMAIL,
            username: ADMIN_B_USERNAME,
            password_hash: adminBHash,
            role: 'admin',
          },
        ])
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
      // Tenant B admin token — buildApp tek tenant'a (TENANT_ID) bağlı,
      // POST /auth/login tenant B kullanıcısını bulamaz. Cross-tenant
      // izolasyon testi için JWT'yi direkt imzalıyoruz (route handler
      // sadece JWT içindeki tenant_id'yi kullanır).
      ctx.adminBToken = signAccessToken(
        { sub: ADMIN_B_ID, tenant_id: TENANT_B_ID, role: 'admin' },
        ACCESS_SECRET,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        for (const tid of [TENANT_ID, TENANT_B_ID]) {
          await ctx.db
            .deleteFrom('refresh_tokens')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('audit_logs')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('orders')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('order_no_counters')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('tables')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('areas')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('users')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('tenant_settings')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('tenants')
            .where('id', '=', tid)
            .execute();
        }
        await ctx.db.destroy();
      }
    });

    it('admin → 201, body.data.table.code matches request', async () => {
      const code = `M-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code, capacity: 4 });
      expect(res.status).toBe(201);
      expect(res.body.data.table.code).toBe(code);
      expect(res.body.data.table.capacity).toBe(4);
      expect(res.body.data.table.tenant_id).toBe(TENANT_ID);
      expect(res.body.data.table.status).toBe('available');
    });

    it('cashier → 403 AUTH_FORBIDDEN', async () => {
      const code = `M-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ code });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('no auth → 401 AUTH_TOKEN_INVALID', async () => {
      const code = `M-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!).post('/tables').send({ code });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('duplicate code → 409 TABLE_ALREADY_EXISTS', async () => {
      const code = `M-DUP-${randomUUID().slice(0, 6)}`;
      const first = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code });
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('TABLE_ALREADY_EXISTS');
    });

    it('empty code → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET admin → 200, body.data.tables array', async () => {
      const res = await request(ctx.app!)
        .get('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.tables)).toBe(true);
    });

    it('GET waiter → 200 (4 rol erişebilir)', async () => {
      const res = await request(ctx.app!)
        .get('/tables')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.tables)).toBe(true);
    });

    it('GET no auth → 401 AUTH_TOKEN_INVALID', async () => {
      const res = await request(ctx.app!).get('/tables');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('GET ?status=available → 200, her item status === available', async () => {
      const res = await request(ctx.app!)
        .get('/tables?status=available')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.tables)).toBe(true);
      for (const t of res.body.data.tables) {
        expect(t.status).toBe('available');
      }
    });

    it('GET ?status=invalid → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.app!)
        .get('/tables?status=zombie')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    // ─────────────────────────────────────────────────────────────────
    // Sprint 4 Görev 19 — PATCH/DELETE /tables (admin-only)
    // ─────────────────────────────────────────────────────────────────

    /** Yardımcı: yeni masa yarat ve id döndür (her test izole çalışır). */
    async function createTable(
      capacity: number | null = 4,
    ): Promise<{ id: string; code: string }> {
      const code = `M-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code, capacity });
      expect(res.status).toBe(201);
      return { id: res.body.data.table.id as string, code };
    }

    it('PATCH admin → 200, code + capacity güncellendi', async () => {
      const { id } = await createTable();
      const newCode = `M-NEW-${randomUUID().slice(0, 6)}`;
      const res = await request(ctx.app!)
        .patch(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code: newCode, capacity: 6 });
      expect(res.status).toBe(200);
      expect(res.body.data.table.id).toBe(id);
      expect(res.body.data.table.code).toBe(newCode);
      expect(res.body.data.table.capacity).toBe(6);
      expect(res.body.data.table.status).toBe('available');
    });

    it('PATCH cashier → 403 AUTH_FORBIDDEN', async () => {
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .patch(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ capacity: 8 });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH waiter → 403 AUTH_FORBIDDEN', async () => {
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .patch(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ capacity: 8 });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH kitchen → 403 AUTH_FORBIDDEN', async () => {
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .patch(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ capacity: 8 });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH bilinmeyen id → 404 TABLE_NOT_FOUND', async () => {
      const ghostId = randomUUID();
      const res = await request(ctx.app!)
        .patch(`/tables/${ghostId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ capacity: 4 });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TABLE_NOT_FOUND');
    });

    it('PATCH cross-tenant id → 404 TABLE_NOT_FOUND (no enumeration)', async () => {
      // Tenant A'nın masasını yarat, sonra Tenant B admin token'ıyla PATCH'e
      // çalış → tenant_id filtre nedeniyle findById null → 404 (200/403 değil).
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .patch(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.adminBToken!}`)
        .send({ capacity: 999 });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TABLE_NOT_FOUND');
    });

    it('PATCH boş body → 400 VALIDATION_ERROR (refine: en az 1 alan)', async () => {
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .patch(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('DELETE admin → 204 + hard delete (row removed; Session 53b)', async () => {
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .delete(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);

      // Hard delete teyidi (Session 53b — ADR-003 + ADR-009 Amend.):
      // satır DB'den fiziksel olarak silinir. orders.table_id FK
      // ON DELETE SET NULL (Migration 030) + table_code_snapshot raporu korur.
      const row = await ctx.db!
        .selectFrom('tables')
        .select(['id'])
        .where('id', '=', id)
        .executeTakeFirst();
      expect(row).toBeUndefined();

      // Audit_logs entry teyidi: aynı transaction'da yazıldı (atomicity).
      const auditRow = await ctx.db!
        .selectFrom('audit_logs')
        .select(['id', 'event_type', 'entity_id'])
        .where('event_type', '=', 'table.deleted')
        .where('entity_id', '=', id)
        .executeTakeFirst();
      expect(auditRow).toBeDefined();
    });

    it('DELETE cashier → 403 AUTH_FORBIDDEN', async () => {
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .delete(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('DELETE waiter → 403 AUTH_FORBIDDEN', async () => {
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .delete(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('DELETE kitchen → 403 AUTH_FORBIDDEN', async () => {
      const { id } = await createTable();
      const res = await request(ctx.app!)
        .delete(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('DELETE bilinmeyen id → 404 TABLE_NOT_FOUND', async () => {
      const ghostId = randomUUID();
      const res = await request(ctx.app!)
        .delete(`/tables/${ghostId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TABLE_NOT_FOUND');
    });

    it('DELETE aktif sipariş varsa → 409 TABLE_ALREADY_OCCUPIED (Seçenek A guard)', async () => {
      const { id } = await createTable();
      // Açık sipariş yarat (status='open' default).
      const orderRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: id, orderType: 'dine_in' });
      expect(orderRes.status).toBe(201);

      const delRes = await request(ctx.app!)
        .delete(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(delRes.status).toBe(409);
      expect(delRes.body.error.code).toBe('TABLE_ALREADY_OCCUPIED');

      // Cleanup: order'ı kapat ki diğer test'ler etkilenmesin.
      await ctx.db!
        .deleteFrom('orders')
        .where('id', '=', orderRes.body.data.order.id)
        .execute();
    });

    it('DELETE terminal (paid) siparişli masa → 204; sipariş kalır, table_id NULL (Migration 043)', async () => {
      // task_91d007c7 regresyonu: composite ON DELETE SET NULL FK'si tenant_id'yi
      // de null'layıp 23502→500 veriyordu (terminal siparişli HİÇBİR masa
      // silinemiyordu). Migration 043 column-specific SET NULL (table_id) fix'i.
      const { id } = await createTable();
      const orderRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tableId: id, orderType: 'dine_in' });
      expect(orderRes.status).toBe(201);
      const orderId = orderRes.body.data.order.id as string;

      // Siparişi terminal duruma çek (guard'ı geçsin, FK cascade tetiklensin).
      await ctx.db!
        .updateTable('orders')
        .set({ status: 'paid' })
        .where('id', '=', orderId)
        .execute();

      const delRes = await request(ctx.app!)
        .delete(`/tables/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(delRes.status).toBe(204);

      // Sipariş satırı YAŞAR: table_id NULL'a düşer, tenant_id + snapshot korunur
      // (rapor bütünlüğü — ADR-003 §7 / Migration 030 niyeti).
      const orphaned = await ctx.db!
        .selectFrom('orders')
        .select(['table_id', 'tenant_id', 'table_code_snapshot'])
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(orphaned.table_id).toBeNull();
      expect(orphaned.tenant_id).toBe(TENANT_ID);
      expect(orphaned.table_code_snapshot).not.toBeNull();

      // Cleanup.
      await ctx.db!.deleteFrom('orders').where('id', '=', orderId).execute();
    });

    // ─────────────────────────────────────────────────────────────────
    // Sprint 5 Görev 23 — PATCH /tables/:id/area (admin-only, ADR-009)
    // ─────────────────────────────────────────────────────────────────

    /** Yardımcı: yeni bölge yarat ve id döndür (admin token). */
    async function createArea(name: string): Promise<string> {
      const res = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name });
      expect(res.status).toBe(201);
      return res.body.data.area.id as string;
    }

    it('PATCH /tables/:id/area admin → 200 + tables.area_id setlenir', async () => {
      const areaId = await createArea(`PA-${randomUUID().slice(0, 6)}`);
      const { id: tableId } = await createTable();
      const res = await request(ctx.app!)
        .patch(`/tables/${tableId}/area`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ area_id: areaId });
      expect(res.status).toBe(200);
      expect(res.body.data.table.id).toBe(tableId);
      // Sprint 8c PR #1: area_id artık projection'da.
      expect(res.body.data.table.area_id).toBe(areaId);

      // DB-level area_id teyidi (defansif).
      const row = await ctx.db!
        .selectFrom('tables')
        .select(['id', 'area_id'])
        .where('id', '=', tableId)
        .executeTakeFirst();
      expect(row).toBeDefined();
      expect(row!.area_id).toBe(areaId);
    });

    it('PATCH /tables/:id/area admin null → 200 (unassign)', async () => {
      const areaId = await createArea(`PB-${randomUUID().slice(0, 6)}`);
      const { id: tableId } = await createTable();
      // Önce ata
      await request(ctx.app!)
        .patch(`/tables/${tableId}/area`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ area_id: areaId });
      // Sonra unassign
      const res = await request(ctx.app!)
        .patch(`/tables/${tableId}/area`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ area_id: null });
      expect(res.status).toBe(200);

      const row = await ctx.db!
        .selectFrom('tables')
        .select(['id', 'area_id'])
        .where('id', '=', tableId)
        .executeTakeFirst();
      expect(row!.area_id).toBeNull();
    });

    it('PATCH /tables/:id/area cashier/waiter/kitchen → 403', async () => {
      const areaId = await createArea(`PC-${randomUUID().slice(0, 6)}`);
      const { id: tableId } = await createTable();
      for (const token of [ctx.cashierToken!, ctx.waiterToken!, ctx.kitchenToken!]) {
        const res = await request(ctx.app!)
          .patch(`/tables/${tableId}/area`)
          .set('Authorization', `Bearer ${token}`)
          .send({ area_id: areaId });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('PATCH /tables/:id/area bilinmeyen area_id → 404 AREA_NOT_FOUND', async () => {
      const { id: tableId } = await createTable();
      const ghostAreaId = randomUUID();
      const res = await request(ctx.app!)
        .patch(`/tables/${tableId}/area`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ area_id: ghostAreaId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('AREA_NOT_FOUND');
    });

    it('PATCH /tables/:id/area cross-tenant area_id → 404 AREA_NOT_FOUND', async () => {
      // Tenant B için ham INSERT — admin login imkansız (buildApp tek tenant'a
      // sabit). DB seviyesinde area yarat, sonra Tenant A admin token'ıyla
      // tenant B'nin area_id'sini setlemeyi dene → 404 AREA_NOT_FOUND.
      const tenantBAreaId = randomUUID();
      await ctx.db!
        .insertInto('areas')
        .values({
          id: tenantBAreaId,
          tenant_id: TENANT_B_ID,
          name: `XB-${randomUUID().slice(0, 6)}`,
        })
        .execute();
      const { id: tableId } = await createTable();
      const res = await request(ctx.app!)
        .patch(`/tables/${tableId}/area`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ area_id: tenantBAreaId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('AREA_NOT_FOUND');
    });

    it('PATCH /tables/:id/area bilinmeyen tableId → 404 TABLE_NOT_FOUND', async () => {
      const areaId = await createArea(`PD-${randomUUID().slice(0, 6)}`);
      const ghostTableId = randomUUID();
      const res = await request(ctx.app!)
        .patch(`/tables/${ghostTableId}/area`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ area_id: areaId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TABLE_NOT_FOUND');
    });
  },
);
