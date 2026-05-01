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

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  waiterToken: string;
  kitchenToken: string;
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
  'POST /menu/categories integration',
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
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant Menu',
          slug: `test-menu-${TENANT_ID.slice(0, 8)}`,
        })
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
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        // Görev 20 cleanup: products → categories sırası (FK ON DELETE RESTRICT
        // değil, ama hard-delete sırası önemli — products.category_id FK'si).
        await ctx.db
          .deleteFrom('products')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('categories')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('audit_logs')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('users')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', '=', TENANT_ID)
          .execute();
        await ctx.db.destroy();
      }
    });

    it('admin → 201, body.data.category.name matches request', async () => {
      const name = `Cat-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name, sortOrder: 5 });
      expect(res.status).toBe(201);
      expect(res.body.data.category.name).toBe(name);
      expect(res.body.data.category.sort_order).toBe(5);
      expect(res.body.data.category.tenant_id).toBe(TENANT_ID);
    });

    it('cashier → 403 AUTH_FORBIDDEN', async () => {
      const name = `Cat-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ name });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('no auth → 401 AUTH_TOKEN_INVALID', async () => {
      const name = `Cat-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .send({ name });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('duplicate name (exact) → 409 MENU_CATEGORY_ALREADY_EXISTS', async () => {
      const name = `Cat-DUP-${randomUUID().slice(0, 6)}`;
      const first = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name });
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('MENU_CATEGORY_ALREADY_EXISTS');
    });

    it('duplicate name (case-insensitive) → 409 MENU_CATEGORY_ALREADY_EXISTS', async () => {
      const base = `Test-${randomUUID().slice(0, 6)}`;
      const upper = base.toUpperCase();
      const lower = base.toLowerCase();

      const first = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: upper });
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: lower });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('MENU_CATEGORY_ALREADY_EXISTS');
    });

    it('sortOrder omitted → 201 with default 0', async () => {
      const name = `Cat-NoSort-${randomUUID().slice(0, 6)}`;
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name });
      expect(res.status).toBe(201);
      expect(res.body.data.category.name).toBe(name);
      expect(res.body.data.category.sort_order).toBe(0);
    });

    // ─── Sprint 8c PR-D-mig — icon + color (Migration 012) ───
    // ADR-011 Amendment 2026-05-01 Karar 2 + Karar 3.

    it('icon + color provided → 201, response contains both', async () => {
      const name = `Cat-IconColor-${randomUUID().slice(0, 6)}`;
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name, icon: 'Pizza', color: '#dc2626' });
      expect(res.status).toBe(201);
      expect(res.body.data.category.icon).toBe('Pizza');
      expect(res.body.data.category.color).toBe('#dc2626');
    });

    it('icon omitted → 201 with default UtensilsCrossed', async () => {
      const name = `Cat-NoIcon-${randomUUID().slice(0, 6)}`;
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name });
      expect(res.status).toBe(201);
      expect(res.body.data.category.icon).toBe('UtensilsCrossed');
      // Default color: Migration 014 brand alignment (orange-600). Önceki
      // green-600 (#16a34a) → #ea580c, login amber→orange-500 family.
      expect(res.body.data.category.color).toBe('#ea580c');
    });

    it('icon outside whitelist → 400 VALIDATION_ERROR', async () => {
      const name = `Cat-BadIcon-${randomUUID().slice(0, 6)}`;
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name, icon: 'SkullCrossbones' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('color outside palette → 400 VALIDATION_ERROR', async () => {
      const name = `Cat-BadColor-${randomUUID().slice(0, 6)}`;
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name, color: '#ff00ff' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH icon + color → 200, fields updated', async () => {
      const created = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: `Cat-PatchIcon-${randomUUID().slice(0, 6)}` });
      expect(created.status).toBe(201);
      const id = created.body.data.category.id as string;

      const patched = await request(ctx.app!)
        .patch(`/menu/categories/${id}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ icon: 'Wine', color: '#7c3aed' });
      expect(patched.status).toBe(200);
      expect(patched.body.data.category.icon).toBe('Wine');
      expect(patched.body.data.category.color).toBe('#7c3aed');
    });

    it('GET admin → 200, body.data.categories array', async () => {
      const res = await request(ctx.app!)
        .get('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.categories)).toBe(true);
      expect(res.body.data.categories.length).toBeGreaterThan(0);
    });

    it('GET waiter → 200 (4 rol erişebilir)', async () => {
      const res = await request(ctx.app!)
        .get('/menu/categories')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.categories)).toBe(true);
    });

    it('GET no auth → 401 AUTH_TOKEN_INVALID', async () => {
      const res = await request(ctx.app!).get('/menu/categories');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('GET other tenant → 200, boş array (cross-tenant izolasyon)', async () => {
      const otherTenantId = randomUUID();
      const otherAdminId = randomUUID();
      const otherEmail = `other-${randomUUID()}@example.com`;
      const otherPass = 'otherpass1234';
      const otherUsername = `other-${randomUUID().slice(0, 8)}`;

      await ctx.db!
        .insertInto('tenants')
        .values({
          id: otherTenantId,
          name: 'Other Tenant',
          slug: `other-${otherTenantId.slice(0, 8)}`,
        })
        .execute();
      await ctx.db!
        .insertInto('users')
        .values({
          id: otherAdminId,
          tenant_id: otherTenantId,
          email: otherEmail,
          username: otherUsername,
          password_hash: await hashPassword(otherPass),
          role: 'admin',
        })
        .execute();

      const otherApp = buildApp({
        pool: ctx.pool!,
        db: ctx.db!,
        accessSecret: ACCESS_SECRET,
        tenantId: otherTenantId,
        webOrigin: 'http://localhost:5173',
      });
      const otherToken = await loginAndGetToken(otherApp, otherEmail, otherPass);

      const res = await request(otherApp)
        .get('/menu/categories')
        .set('Authorization', `Bearer ${otherToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.categories).toEqual([]);

      // Inline cleanup — bu test kendi seed'ini kendi temizler
      await ctx.db!
        .deleteFrom('refresh_tokens')
        .where('tenant_id', '=', otherTenantId)
        .execute();
      await ctx.db!
        .deleteFrom('users')
        .where('id', '=', otherAdminId)
        .execute();
      await ctx.db!
        .deleteFrom('tenants')
        .where('id', '=', otherTenantId)
        .execute();
    });

    // ─────────────────────────────────────────────────────────────────────
    // Sprint 4 Görev 20 — PATCH/DELETE /menu/categories admin-only
    // ─────────────────────────────────────────────────────────────────────

    /** Helper: yeni kategori seed eder, id döner. */
    async function seedCategory(name?: string): Promise<string> {
      const res = await request(ctx.app!)
        .post('/menu/categories')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: name ?? `Cat-${randomUUID().slice(0, 8)}` });
      expect(res.status).toBe(201);
      return res.body.data.category.id as string;
    }

    /** Helper: kategori altına aktif product seed eder (DELETE 409 testi için). */
    async function seedProduct(categoryId: string): Promise<string> {
      const productId = randomUUID();
      await ctx.db!
        .insertInto('products')
        .values({
          id: productId,
          tenant_id: TENANT_ID,
          category_id: categoryId,
          name: `Prod-${productId.slice(0, 8)}`,
          price_cents: 1000,
        })
        .execute();
      return productId;
    }

    it('PATCH admin → 200, name değişti, body.data.category güncel', async () => {
      const categoryId = await seedCategory();
      const newName = `Renamed-${randomUUID().slice(0, 8)}`;
      const res = await request(ctx.app!)
        .patch(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: newName, sortOrder: 9 });
      expect(res.status).toBe(200);
      expect(res.body.data.category.id).toBe(categoryId);
      expect(res.body.data.category.name).toBe(newName);
      expect(res.body.data.category.sort_order).toBe(9);
    });

    it('PATCH cashier → 403 AUTH_FORBIDDEN', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .patch(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ name: 'X' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH waiter → 403 AUTH_FORBIDDEN', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .patch(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ name: 'X' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH kitchen → 403 AUTH_FORBIDDEN', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .patch(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ name: 'X' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH bilinmeyen id → 404 MENU_CATEGORY_NOT_FOUND', async () => {
      const res = await request(ctx.app!)
        .patch(`/menu/categories/${randomUUID()}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: 'X' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MENU_CATEGORY_NOT_FOUND');
    });

    it('PATCH cross-tenant id → 404 MENU_CATEGORY_NOT_FOUND (no enumeration)', async () => {
      // Diğer tenant + admin + kategori seed et; ana tenant adminiyle id'sine PATCH
      const otherTenantId = randomUUID();
      const otherCategoryId = randomUUID();
      await ctx.db!
        .insertInto('tenants')
        .values({
          id: otherTenantId,
          name: 'Other Tenant Patch',
          slug: `other-patch-${otherTenantId.slice(0, 8)}`,
        })
        .execute();
      await ctx.db!
        .insertInto('categories')
        .values({
          id: otherCategoryId,
          tenant_id: otherTenantId,
          name: `Other-Cat-${randomUUID().slice(0, 8)}`,
        })
        .execute();

      const res = await request(ctx.app!)
        .patch(`/menu/categories/${otherCategoryId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: 'Hijack' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MENU_CATEGORY_NOT_FOUND');

      // cleanup
      await ctx.db!
        .deleteFrom('categories')
        .where('id', '=', otherCategoryId)
        .execute();
      await ctx.db!
        .deleteFrom('tenants')
        .where('id', '=', otherTenantId)
        .execute();
    });

    it('PATCH boş body → 400 VALIDATION_ERROR', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .patch(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('DELETE admin → 204, soft delete teyidi (deleted_at not null)', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);

      const row = await ctx.db!
        .selectFrom('categories')
        .select(['id', 'deleted_at'])
        .where('id', '=', categoryId)
        .executeTakeFirst();
      expect(row).toBeDefined();
      expect(row!.deleted_at).not.toBeNull();
    });

    it('DELETE cashier → 403 AUTH_FORBIDDEN', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.cashierToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('DELETE waiter → 403 AUTH_FORBIDDEN', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('DELETE kitchen → 403 AUTH_FORBIDDEN', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('DELETE bilinmeyen id → 404 MENU_CATEGORY_NOT_FOUND', async () => {
      const res = await request(ctx.app!)
        .delete(`/menu/categories/${randomUUID()}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MENU_CATEGORY_NOT_FOUND');
    });

    it('DELETE aktif products varsa → 409 MENU_CATEGORY_HAS_PRODUCTS (kararA cascade YOK)', async () => {
      const categoryId = await seedCategory();
      const productId = await seedProduct(categoryId);

      const res = await request(ctx.app!)
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MENU_CATEGORY_HAS_PRODUCTS');

      // Kategori SILINMEMIS olmalı (cascade yok)
      const row = await ctx.db!
        .selectFrom('categories')
        .select(['id', 'deleted_at'])
        .where('id', '=', categoryId)
        .executeTakeFirst();
      expect(row).toBeDefined();
      expect(row!.deleted_at).toBeNull();

      // cleanup
      await ctx.db!.deleteFrom('products').where('id', '=', productId).execute();
    });

    it('DELETE atomicity — audit_logs entry aynı transaction içinde yazılır', async () => {
      const categoryId = await seedCategory();
      const res = await request(ctx.app!)
        .delete(`/menu/categories/${categoryId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(204);

      const auditRow = await ctx.db!
        .selectFrom('audit_logs')
        .select(['id', 'event_type', 'entity_id', 'entity_type'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'menu_category.deleted')
        .where('entity_id', '=', categoryId)
        .executeTakeFirst();
      expect(auditRow).toBeDefined();
      expect(auditRow!.entity_type).toBe('menu_category');
    });
  },
);
