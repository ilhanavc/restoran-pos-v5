import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Blok 6 Hat C — cross-tenant IDOR sweep (R6-KDS-*, R6-IDOR-*).
 *
 * `/auth/login` `deps.tenantId`'ye tenant-scoped (auth.ts:119 `findByEmail
 * (deps.tenantId, email)`) — bu yüzden API tek-deployment/tek-tenant
 * modelinde çalışır (CLAUDE.md: "Başta 1 tenant"). Cross-tenant senaryosunu
 * test etmek için 2 ayrı `buildApp()` (appA/appB) örneği gerekir — aynı
 * desen kds.test.ts'te de kullanılıyor (ctx.app + ctx.appB).
 *
 * Hedef: Hat A/B (customers/tables/products, read-only denetlenen route'lar)
 * ekseninden 1-2 kritik canlı IDOR + KDS'in kendi cross-tenant PATCH boşluğu.
 * Tüm route'lar zaten `findById(tenantId, id)` deseni kullanıyor (kod
 * okumasıyla doğrulandı) — bu testler YEŞİL beklenir (savunma canlı kanıtı).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_A_ID = randomUUID();
const TENANT_B_ID = randomUUID();

const ADMIN_A_ID = randomUUID();
const ADMIN_A_EMAIL = `idor-admin-a-${randomUUID()}@example.com`;
const ADMIN_A_USERNAME = `idor-admin-a-${randomUUID().slice(0, 8)}`;
const ADMIN_A_PASSWORD = 'adminApass1234';

const KITCHEN_A_ID = randomUUID();
const KITCHEN_A_EMAIL = `idor-kitchen-a-${randomUUID()}@example.com`;
const KITCHEN_A_USERNAME = `idor-kitchen-a-${randomUUID().slice(0, 8)}`;
const KITCHEN_A_PASSWORD = 'kitchenApass1234';

const ADMIN_B_ID = randomUUID();
const ADMIN_B_EMAIL = `idor-admin-b-${randomUUID()}@example.com`;
const ADMIN_B_USERNAME = `idor-admin-b-${randomUUID().slice(0, 8)}`;
const ADMIN_B_PASSWORD = 'adminBpass1234';

const KITCHEN_B_ID = randomUUID();
const KITCHEN_B_EMAIL = `idor-kitchen-b-${randomUUID()}@example.com`;
const KITCHEN_B_USERNAME = `idor-kitchen-b-${randomUUID().slice(0, 8)}`;
const KITCHEN_B_PASSWORD = 'kitchenBpass1234';

// Tenant A seed entities.
let CATEGORY_A_ID: string;
let PRODUCT_A_ID: string;
let TABLE_A_ID: string;
const TABLE_A_CODE = `M-IDOR-${randomUUID().slice(0, 6)}`;
let CUSTOMER_A_ID: string;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  appA: Express;
  appB: Express;
  adminAToken: string;
  kitchenAToken: string;
  adminBToken: string;
  kitchenBToken: string;
}

const ctx: Partial<TestCtx> = {};

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 254) + 1}`;
}

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(
      `login failed: ${res.status} ${JSON.stringify(res.body)} [email=${email}]`,
    );
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Cross-tenant IDOR sweep (Blok 6 Hat C, R6-KDS-*/R6-IDOR-*)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.appA = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_A_ID,
        webOrigin: 'http://localhost:5173',
      });
      ctx.appB = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_B_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_A_ID,
            name: 'R6-IDOR Tenant A',
            slug: `r6-idor-a-${TENANT_A_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'R6-IDOR Tenant B',
            slug: `r6-idor-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_A_ID }, { tenant_id: TENANT_B_ID }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminAHash = await hashPassword(ADMIN_A_PASSWORD);
      const kitchenAHash = await hashPassword(KITCHEN_A_PASSWORD);
      const adminBHash = await hashPassword(ADMIN_B_PASSWORD);
      const kitchenBHash = await hashPassword(KITCHEN_B_PASSWORD);

      await db
        .insertInto('users')
        .values([
          {
            id: ADMIN_A_ID,
            tenant_id: TENANT_A_ID,
            email: ADMIN_A_EMAIL,
            username: ADMIN_A_USERNAME,
            password_hash: adminAHash,
            role: 'admin',
          },
          {
            id: KITCHEN_A_ID,
            tenant_id: TENANT_A_ID,
            email: KITCHEN_A_EMAIL,
            username: KITCHEN_A_USERNAME,
            password_hash: kitchenAHash,
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
          {
            id: KITCHEN_B_ID,
            tenant_id: TENANT_B_ID,
            email: KITCHEN_B_EMAIL,
            username: KITCHEN_B_USERNAME,
            password_hash: kitchenBHash,
            role: 'kitchen',
          },
        ])
        .execute();

      CATEGORY_A_ID = randomUUID();
      await db
        .insertInto('categories')
        .values({
          id: CATEGORY_A_ID,
          tenant_id: TENANT_A_ID,
          name: 'IDOR Test Pideler',
          sort_order: 1,
          kitchen_print: true,
        })
        .execute();

      PRODUCT_A_ID = randomUUID();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_A_ID,
          tenant_id: TENANT_A_ID,
          category_id: CATEGORY_A_ID,
          name: 'IDOR Test Kaşarlı Pide',
          price_cents: 12000,
          is_active: true,
        })
        .execute();

      TABLE_A_ID = randomUUID();
      await db
        .insertInto('tables')
        .values({
          id: TABLE_A_ID,
          tenant_id: TENANT_A_ID,
          code: TABLE_A_CODE,
          capacity: 4,
        })
        .execute();

      CUSTOMER_A_ID = randomUUID();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_A_ID,
          tenant_id: TENANT_A_ID,
          full_name: 'IDOR Test Müşteri Ayşe Yılmaz',
        })
        .execute();

      ctx.adminAToken = await loginAndGetToken(ctx.appA, ADMIN_A_EMAIL, ADMIN_A_PASSWORD);
      ctx.kitchenAToken = await loginAndGetToken(
        ctx.appA,
        KITCHEN_A_EMAIL,
        KITCHEN_A_PASSWORD,
      );
      ctx.adminBToken = await loginAndGetToken(ctx.appB, ADMIN_B_EMAIL, ADMIN_B_PASSWORD);
      ctx.kitchenBToken = await loginAndGetToken(
        ctx.appB,
        KITCHEN_B_EMAIL,
        KITCHEN_B_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        for (const tid of [TENANT_A_ID, TENANT_B_ID]) {
          await ctx.db.deleteFrom('payments').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('audit_logs').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
          await ctx.db
            .deleteFrom('order_no_counters')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('customers').where('tenant_id', '=', tid).execute();
          await ctx.db
            .deleteFrom('product_attribute_groups')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db.deleteFrom('products').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('categories').where('tenant_id', '=', tid).execute();
          await ctx.db.deleteFrom('tables').where('tenant_id', '=', tid).execute();
          await ctx.db
            .deleteFrom('refresh_tokens')
            .where('tenant_id', '=', tid)
            .execute();
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

    // ── R6-KDS-01 — SEC: cross-tenant PATCH order-item status ───────────────
    it('R6-KDS-01: Tenant B kitchen token Tenant A sipariş kalemine PATCH .../status → 404 ORDER_NOT_FOUND, DB durum değişmez', async () => {
      const orderRes = await request(ctx.appA!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminAToken!}`)
        .send({
          tableId: TABLE_A_ID,
          orderType: 'dine_in',
          items: [{ productId: PRODUCT_A_ID, quantity: 1 }],
        });
      expect(orderRes.status).toBe(201);
      const orderId = orderRes.body.data.order.id as string;
      const itemId = orderRes.body.data.items[0].id as string;

      const before = await ctx.db!
        .selectFrom('order_items')
        .select('status')
        .where('id', '=', itemId)
        .executeTakeFirst();
      expect(before?.status).toBe('sent'); // kitchen_print=true → dine_in POST hook

      const crossRes = await request(ctx.appB!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.kitchenBToken!}`)
        .send({ status: 'preparing' });

      expect(crossRes.status).toBe(404);
      expect(crossRes.body.error.code).toBe('ORDER_NOT_FOUND');

      const after = await ctx.db!
        .selectFrom('order_items')
        .select('status')
        .where('id', '=', itemId)
        .executeTakeFirst();
      expect(after?.status).toBe('sent'); // mutasyon yok

      // Temizlik — tabloyu boşalt (diğer testler etkilenmesin).
      await ctx.db!
        .updateTable('orders')
        .set({ status: 'cancelled' })
        .where('id', '=', orderId)
        .execute();
    });

    // ── R6-IDOR-01 — SEC: cross-tenant customerId GET ────────────────────────
    it('R6-IDOR-01: Tenant B admin token Tenant A müşterisine GET /customers/:id → 404 CUSTOMER_NOT_FOUND', async () => {
      const res = await request(ctx.appB!)
        .get(`/customers/${CUSTOMER_A_ID}`)
        .set('Authorization', `Bearer ${ctx.adminBToken!}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
      // Response body Tenant A müşterisinin hiçbir alanını (full_name) sızdırmamalı.
      expect(JSON.stringify(res.body)).not.toContain('Ayşe Yılmaz');
    });

    // ── R6-IDOR-02 — SEC: cross-tenant tableId PATCH ─────────────────────────
    it('R6-IDOR-02: Tenant B admin token Tenant A masasına PATCH /tables/:id → 404 TABLE_NOT_FOUND, DB masa değişmez', async () => {
      const res = await request(ctx.appB!)
        .patch(`/tables/${TABLE_A_ID}`)
        .set('Authorization', `Bearer ${ctx.adminBToken!}`)
        .send({ code: 'HACKED-CODE', capacity: 99 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TABLE_NOT_FOUND');

      const row = await ctx.db!
        .selectFrom('tables')
        .select(['code', 'capacity'])
        .where('id', '=', TABLE_A_ID)
        .executeTakeFirst();
      expect(row?.code).toBe(TABLE_A_CODE);
      expect(row?.capacity).toBe(4);
    });

    // ── R6-IDOR-03 — SEC: cross-tenant productId DELETE ──────────────────────
    it('R6-IDOR-03: Tenant B admin token Tenant A ürününe DELETE /products/:id → 404 MENU_PRODUCT_NOT_FOUND, DB ürün silinmez', async () => {
      const res = await request(ctx.appB!)
        .delete(`/products/${PRODUCT_A_ID}`)
        .set('Authorization', `Bearer ${ctx.adminBToken!}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('MENU_PRODUCT_NOT_FOUND');

      const row = await ctx.db!
        .selectFrom('products')
        .select(['deleted_at', 'is_active'])
        .where('id', '=', PRODUCT_A_ID)
        .executeTakeFirst();
      expect(row?.deleted_at).toBeNull();
      expect(row?.is_active).toBe(true);
    });
  },
);
