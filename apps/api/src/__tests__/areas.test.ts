import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
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

const TENANT_B_ID = randomUUID();
const ADMIN_B_ID = randomUUID();

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
  '/areas integration (Sprint 5 Görev 23)',
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
            name: 'Test Tenant Areas',
            slug: `test-areas-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'Test Tenant Areas B',
            slug: `test-areas-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      const cashierHash = await hashPassword(CASHIER_PASSWORD);
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
        ])
        .execute();

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
      // Tenant B admin token — direkt JWT imzala (cross-tenant izolasyon).
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
          // tables.area_id NULL'a indirgenmemiş satır kalmasın diye önce tables
          // FK'sını boşalt, sonra areas DELETE.
          await ctx.db
            .updateTable('tables')
            .set({ area_id: null })
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('areas').where('tenant_id', '=', tid).execute();
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

    /** Yardımcı: yeni bölge yarat ve id döndür. */
    async function createArea(
      name: string,
      sortOrder?: number,
    ): Promise<{ id: string; name: string }> {
      const body: Record<string, unknown> = { name };
      if (sortOrder !== undefined) body.sortOrder = sortOrder;
      const res = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send(body);
      expect(res.status).toBe(201);
      return { id: res.body.data.area.id as string, name };
    }

    // ─────────────────────────────────────────────────────────────────
    // POST /areas — RBAC + 409 + 400
    // ─────────────────────────────────────────────────────────────────

    it('POST admin → 201 + Area body', async () => {
      const name = `Bahçe-${randomUUID().slice(0, 6)}`;
      const res = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name, sortOrder: 5 });
      expect(res.status).toBe(201);
      expect(res.body.data.area.name).toBe(name);
      expect(res.body.data.area.sort_order).toBe(5);
      expect(res.body.data.area.tenant_id).toBe(TENANT_ID);
    });

    it('POST cashier → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ name: `X-${randomUUID().slice(0, 6)}` });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('POST waiter → 403', async () => {
      const res = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ name: `Y-${randomUUID().slice(0, 6)}` });
      expect(res.status).toBe(403);
    });

    it('POST kitchen → 403', async () => {
      const res = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ name: `Z-${randomUUID().slice(0, 6)}` });
      expect(res.status).toBe(403);
    });

    it('POST case-insensitive duplicate → 409 AREA_NAME_ALREADY_EXISTS', async () => {
      const baseName = `Salon-${randomUUID().slice(0, 6)}`;
      const first = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: baseName });
      expect(first.status).toBe(201);

      // Aynı isim, farklı casing — partial UNIQUE lower(trim(name)) ihlali
      const second = await request(ctx.app!)
        .post('/areas')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: baseName.toUpperCase() });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('AREA_NAME_ALREADY_EXISTS');
    });

    // ─────────────────────────────────────────────────────────────────
    // GET /areas — 4 rol erişebilir + sort
    // ─────────────────────────────────────────────────────────────────

    it('GET admin → 200, body.data.areas array', async () => {
      const res = await request(ctx.app!)
        .get('/areas')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.areas)).toBe(true);
    });

    it('GET cashier/waiter/kitchen → 200 (Karar 4: tables.read seviyesi)', async () => {
      for (const token of [ctx.cashierToken!, ctx.waiterToken!, ctx.kitchenToken!]) {
        const res = await request(ctx.app!)
          .get('/areas')
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.areas)).toBe(true);
      }
    });

    it('GET sort: sort_order ASC, name ASC tiebreaker', async () => {
      // 3 area: sort_order farklı + 2 area aynı sort_order
      const a = await createArea(`Z-Sort-${randomUUID().slice(0, 6)}`, 30);
      const b = await createArea(`A-Sort-${randomUUID().slice(0, 6)}`, 10);
      const c = await createArea(`B-Sort-${randomUUID().slice(0, 6)}`, 10);

      const res = await request(ctx.app!)
        .get('/areas')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      const areas: Array<{ id: string; sort_order: number; name: string }> =
        res.body.data.areas;
      const idx = (id: string): number => areas.findIndex((x) => x.id === id);
      // b (sort=10, "A-..." < "B-...") önce, c (sort=10) sonra, a (sort=30) en son.
      expect(idx(b.id)).toBeLessThan(idx(c.id));
      expect(idx(c.id)).toBeLessThan(idx(a.id));
    });

    // ─────────────────────────────────────────────────────────────────
    // PATCH /areas/:id — RBAC + 404 + 409 + 400
    // ─────────────────────────────────────────────────────────────────

    it('PATCH admin → 200, name güncellendi', async () => {
      const { id } = await createArea(`Eski-${randomUUID().slice(0, 6)}`);
      const newName = `Yeni-${randomUUID().slice(0, 6)}`;
      const res = await request(ctx.app!)
        .patch(`/areas/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: newName, sortOrder: 99 });
      expect(res.status).toBe(200);
      expect(res.body.data.area.name).toBe(newName);
      expect(res.body.data.area.sort_order).toBe(99);
    });

    it('PATCH cashier/waiter/kitchen → 403', async () => {
      const { id } = await createArea(`Patch403-${randomUUID().slice(0, 6)}`);
      for (const token of [ctx.cashierToken!, ctx.waiterToken!, ctx.kitchenToken!]) {
        const res = await request(ctx.app!)
          .patch(`/areas/${id}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ name: 'x' });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('PATCH boş body → 400 VALIDATION_ERROR', async () => {
      const { id } = await createArea(`Empty-${randomUUID().slice(0, 6)}`);
      const res = await request(ctx.app!)
        .patch(`/areas/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH cross-tenant id → 404 AREA_NOT_FOUND', async () => {
      const { id } = await createArea(`Xtenant-${randomUUID().slice(0, 6)}`);
      const res = await request(ctx.app!)
        .patch(`/areas/${id}`)
        .set('Authorization', `Bearer ${ctx.adminBToken!}`)
        .send({ name: 'hijack' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('AREA_NOT_FOUND');
    });

    it('PATCH duplicate name → 409 AREA_NAME_ALREADY_EXISTS', async () => {
      const occupied = `Taken-${randomUUID().slice(0, 6)}`;
      await createArea(occupied);
      const { id } = await createArea(`Free-${randomUUID().slice(0, 6)}`);
      const res = await request(ctx.app!)
        .patch(`/areas/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: occupied });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('AREA_NAME_ALREADY_EXISTS');
    });

    // ─────────────────────────────────────────────────────────────────
    // DELETE /areas/:id — RBAC + 404 + cascade NULL (kritik test)
    // ─────────────────────────────────────────────────────────────────

    it('DELETE admin → 204 + soft delete + cascade NULL + audit tables_unlinked_count', async () => {
      const { id: areaId } = await createArea(
        `Cascade-${randomUUID().slice(0, 6)}`,
      );
      // 2 masa yarat ve bu bölgeye ata
      const t1Code = `T-${randomUUID().slice(0, 8)}`;
      const t2Code = `T-${randomUUID().slice(0, 8)}`;
      const t1Res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code: t1Code });
      expect(t1Res.status).toBe(201);
      const t1Id = t1Res.body.data.table.id as string;

      const t2Res = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code: t2Code });
      expect(t2Res.status).toBe(201);
      const t2Id = t2Res.body.data.table.id as string;

      // PATCH /tables/:id/area ile her ikisini de bağla
      for (const tId of [t1Id, t2Id]) {
        const r = await request(ctx.app!)
          .patch(`/tables/${tId}/area`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ area_id: areaId });
        expect(r.status).toBe(200);
      }

      // DELETE öncesi tables.area_id doğrula
      const before = await ctx.db!
        .selectFrom('tables')
        .select(['id', 'area_id'])
        .where('id', 'in', [t1Id, t2Id])
        .execute();
      for (const row of before) {
        expect(row.area_id).toBe(areaId);
      }

      // DELETE
      const delRes = await request(ctx.app!)
        .delete(`/areas/${areaId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(delRes.status).toBe(204);

      // Hard delete teyidi (Session 53b — ADR-003 + ADR-009 Amend.):
      // areas satırı DB'den fiziksel olarak silinir; cascade NULL pattern
      // KORUNUR (aşağıdaki tables.area_id NULL teyidiyle birlikte).
      const areaRow = await ctx.db!
        .selectFrom('areas')
        .select(['id'])
        .where('id', '=', areaId)
        .executeTakeFirst();
      expect(areaRow).toBeUndefined();

      // Cascade NULL teyidi
      const after = await ctx.db!
        .selectFrom('tables')
        .select(['id', 'area_id'])
        .where('id', 'in', [t1Id, t2Id])
        .execute();
      for (const row of after) {
        expect(row.area_id).toBeNull();
      }

      // Audit teyidi: tables_unlinked_count = 2
      const auditRow = await ctx.db!
        .selectFrom('audit_logs')
        .select(['id', 'event_type', 'entity_id', 'payload'])
        .where('event_type', '=', 'area.deleted')
        .where('entity_id', '=', areaId)
        .executeTakeFirst();
      expect(auditRow).toBeDefined();
      const payload = auditRow!.payload as { tables_unlinked_count?: number };
      expect(payload.tables_unlinked_count).toBe(2);
    });

    it('DELETE cashier/waiter/kitchen → 403', async () => {
      const { id } = await createArea(`Del403-${randomUUID().slice(0, 6)}`);
      for (const token of [ctx.cashierToken!, ctx.waiterToken!, ctx.kitchenToken!]) {
        const res = await request(ctx.app!)
          .delete(`/areas/${id}`)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('DELETE bilinmeyen id → 404 AREA_NOT_FOUND', async () => {
      const ghostId = randomUUID();
      const res = await request(ctx.app!)
        .delete(`/areas/${ghostId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('AREA_NOT_FOUND');
    });

    // ─────────────────────────────────────────────────────────────────
    // DELETE guard — ADR-009 Amendment 2026-06-30 Karar C(a)
    // Aktif-siparişli masası olan bölge silinemez (409). Boş masalı bölge
    // silinebilir + tables.area_id NULL'a düşer ("Bölgesiz" grubu).
    // ─────────────────────────────────────────────────────────────────

    /** Yardımcı: masa yarat + bölgeye ata, table id döndür. */
    async function createTableInArea(areaId: string): Promise<string> {
      const code = `T-${randomUUID().slice(0, 8)}`;
      const tRes = await request(ctx.app!)
        .post('/tables')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ code });
      expect(tRes.status).toBe(201);
      const tableId = tRes.body.data.table.id as string;
      const aRes = await request(ctx.app!)
        .patch(`/tables/${tableId}/area`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ area_id: areaId });
      expect(aRes.status).toBe(200);
      return tableId;
    }

    /** Yardımcı: masaya aktif (non-terminal) sipariş bağla — direkt INSERT. */
    async function insertActiveOrder(tableId: string): Promise<string> {
      const orderId = randomUUID();
      await ctx.db!
        .insertInto('orders')
        .values({
          id: orderId,
          tenant_id: TENANT_ID,
          table_id: tableId,
          customer_id: null,
          order_type: 'dine_in',
          status: 'open',
          order_no: Math.floor(Math.random() * 1_000_000) + 1,
          total_cents: 0,
          store_date: new Date(),
        })
        .execute();
      return orderId;
    }

    it('DELETE bölgede aktif-siparişli masa → 409 AREA_HAS_ACTIVE_TABLES (guard)', async () => {
      const { id: areaId } = await createArea(
        `GuardActive-${randomUUID().slice(0, 6)}`,
      );
      const tableId = await createTableInArea(areaId);
      const orderId = await insertActiveOrder(tableId);

      const res = await request(ctx.app!)
        .delete(`/areas/${areaId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('AREA_HAS_ACTIVE_TABLES');

      // Guard rollback: bölge + masa + bağ DEĞİŞMEMELİ (silme atlandı).
      const areaRow = await ctx.db!
        .selectFrom('areas')
        .select(['id'])
        .where('id', '=', areaId)
        .executeTakeFirst();
      expect(areaRow).toBeDefined();
      const tableRow = await ctx.db!
        .selectFrom('tables')
        .select(['id', 'area_id'])
        .where('id', '=', tableId)
        .executeTakeFirst();
      expect(tableRow?.area_id).toBe(areaId);

      // Cleanup: sonraki testlerin cascade'ini bozmasın.
      await ctx.db!.deleteFrom('orders').where('id', '=', orderId).execute();
    });

    it('DELETE bölgede sadece boş masa → 204 + cascade NULL (Bölgesiz)', async () => {
      const { id: areaId } = await createArea(
        `GuardEmpty-${randomUUID().slice(0, 6)}`,
      );
      const tableId = await createTableInArea(areaId);

      const res = await request(ctx.app!)
        .delete(`/areas/${areaId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);

      // Bölge fiziksel silindi; masa korundu ama area_id NULL (orphan).
      const areaRow = await ctx.db!
        .selectFrom('areas')
        .select(['id'])
        .where('id', '=', areaId)
        .executeTakeFirst();
      expect(areaRow).toBeUndefined();
      const tableRow = await ctx.db!
        .selectFrom('tables')
        .select(['id', 'area_id'])
        .where('id', '=', tableId)
        .executeTakeFirst();
      expect(tableRow).toBeDefined();
      expect(tableRow?.area_id).toBeNull();
    });
  },
);
