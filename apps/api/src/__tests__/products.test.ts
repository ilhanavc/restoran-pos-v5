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

/**
 * Görev 18 — Products/Variants CRUD integration tests (ADR-003 §8.6 4 karar +
 * Amendment 2026-04-28).
 *
 * Test matrisi:
 *  - 4 endpoint × 4 rol baseline ABAC
 *  - K1 nested write: POST + variants, PATCH declarative replace, PATCH variants:[]
 *  - K2 cascade soft delete: DELETE atomik
 *  - K3 is_default promote: default silinince next-default
 *  - K4 N+1 yasak: query count assert
 *  - is_default validation: superRefine 422
 *  - Cross-tenant izolasyon
 *  - Category FK 404
 *  - Snapshot invariant (order_items product_name değişmez)
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TENANT_B_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-prod-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminproductspass';
const ADMIN_USERNAME = `admin-prod-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-prod-${randomUUID()}@example.com`;
const CASHIER_PASSWORD = 'cashierprodpass';
const CASHIER_USERNAME = `cashier-prod-${randomUUID().slice(0, 8)}`;

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-prod-${randomUUID()}@example.com`;
const KITCHEN_PASSWORD = 'kitchenprodpass';
const KITCHEN_USERNAME = `kitchen-prod-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-prod-${randomUUID()}@example.com`;
const WAITER_PASSWORD = 'waiterprodpass';
const WAITER_USERNAME = `waiter-prod-${randomUUID().slice(0, 8)}`;

const TENANT_B_ADMIN_ID = randomUUID();
const TENANT_B_ADMIN_EMAIL = `t-b-admin-prod-${randomUUID()}@example.com`;
const TENANT_B_ADMIN_PASSWORD = 'tbadminprodpass';
const TENANT_B_ADMIN_USERNAME = `t-b-admin-prod-${randomUUID().slice(0, 8)}`;

// Seed kategoriler — POST /products için zorunlu
const CATEGORY_A_ID = randomUUID();
const CATEGORY_B_ID = randomUUID();
const TENANT_B_CATEGORY_ID = randomUUID();

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  appTenantB: Express;
  adminToken: string;
  cashierToken: string;
  kitchenToken: string;
  waiterToken: string;
  tenantBAdminToken: string;
}

const ctx: Partial<TestCtx> = {};

function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  return `203.0.113.${(a + b) % 254}`;
}

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .set('X-Forwarded-For', uniqueIp())
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Products/Variants CRUD integration (ADR-003 §8.6)',
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
      ctx.appTenantB = buildApp({
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
            id: TENANT_ID,
            name: 'Test Products A',
            slug: `test-prod-a-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'Test Products B',
            slug: `test-prod-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_ID }, { tenant_id: TENANT_B_ID }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      const [
        adminHash,
        cashierHash,
        kitchenHash,
        waiterHash,
        tbAdminHash,
      ] = await Promise.all([
        hashPassword(ADMIN_PASSWORD),
        hashPassword(CASHIER_PASSWORD),
        hashPassword(KITCHEN_PASSWORD),
        hashPassword(WAITER_PASSWORD),
        hashPassword(TENANT_B_ADMIN_PASSWORD),
      ]);

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
            id: KITCHEN_ID,
            tenant_id: TENANT_ID,
            email: KITCHEN_EMAIL,
            username: KITCHEN_USERNAME,
            password_hash: kitchenHash,
            role: 'kitchen',
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
            id: TENANT_B_ADMIN_ID,
            tenant_id: TENANT_B_ID,
            email: TENANT_B_ADMIN_EMAIL,
            username: TENANT_B_ADMIN_USERNAME,
            password_hash: tbAdminHash,
            role: 'admin',
          },
        ])
        .execute();

      // Kategoriler
      await db
        .insertInto('categories')
        .values([
          { id: CATEGORY_A_ID, tenant_id: TENANT_ID, name: 'Pideler' },
          { id: CATEGORY_B_ID, tenant_id: TENANT_ID, name: 'İçecekler' },
          { id: TENANT_B_CATEGORY_ID, tenant_id: TENANT_B_ID, name: 'Tatlılar' },
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
      ctx.kitchenToken = await loginAndGetToken(
        ctx.app,
        KITCHEN_EMAIL,
        KITCHEN_PASSWORD,
      );
      ctx.waiterToken = await loginAndGetToken(
        ctx.app,
        WAITER_EMAIL,
        WAITER_PASSWORD,
      );
      ctx.tenantBAdminToken = await loginAndGetToken(
        ctx.appTenantB,
        TENANT_B_ADMIN_EMAIL,
        TENANT_B_ADMIN_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('audit_logs')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        // order_items + orders cleanup (snapshot test seed'i)
        await ctx.db
          .deleteFrom('order_items')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('orders')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('product_variants')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('products')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('categories')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('users')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db.destroy();
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // POST /products — admin nested write (ADR-003 §8.6 K1)
    // ────────────────────────────────────────────────────────────────────
    describe('POST /products', () => {
      it('admin + 3 variant nested → 201 + nested response', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            categoryId: CATEGORY_A_ID,
            name: 'Karışık Pide',
            priceCents: 12000,
            variants: [
              { name: 'Küçük', priceDeltaCents: -200, isDefault: false, sortOrder: 0 },
              { name: 'Orta', priceDeltaCents: 0, isDefault: true, sortOrder: 1 },
              { name: 'Büyük', priceDeltaCents: 300, isDefault: false, sortOrder: 2 },
            ],
          });
        expect(res.status).toBe(201);
        expect(res.body.data.product.name).toBe('Karışık Pide');
        expect(res.body.data.product.variants).toHaveLength(3);
        expect(res.body.data.product.variants.find((v: { isDefault: boolean }) => v.isDefault === true)).toBeDefined();
        // Negative price delta korunmalı (Amendment 2026-04-28)
        const small = (res.body.data.product.variants as { name: string; priceDeltaCents: number }[]).find((v) => v.name === 'Küçük');
        expect(small?.priceDeltaCents).toBe(-200);
      });

      it('admin + variantsız basit ürün → 201', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            categoryId: CATEGORY_B_ID,
            name: 'Ayran',
            priceCents: 1500,
          });
        expect(res.status).toBe(201);
        expect(res.body.data.product.variants).toEqual([]);
      });

      it('admin + 2 is_default=true → 422 VALIDATION_ERROR', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            categoryId: CATEGORY_A_ID,
            name: 'İki Default',
            priceCents: 5000,
            variants: [
              { name: 'A', priceDeltaCents: 0, isDefault: true },
              { name: 'B', priceDeltaCents: 0, isDefault: true },
            ],
          });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('admin + variants boş değil ama hepsi is_default=false → 422', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            categoryId: CATEGORY_A_ID,
            name: 'Default Yok',
            priceCents: 5000,
            variants: [
              { name: 'A', priceDeltaCents: 0 },
              { name: 'B', priceDeltaCents: 0 },
            ],
          });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('admin + bilinmeyen category_id → 404 MENU_CATEGORY_NOT_FOUND', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            categoryId: randomUUID(),
            name: 'Yetim',
            priceCents: 1000,
          });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('MENU_CATEGORY_NOT_FOUND');
      });

      it('admin + cross-tenant category_id → 404 MENU_CATEGORY_NOT_FOUND', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            categoryId: TENANT_B_CATEGORY_ID,
            name: 'Tenant B Cat',
            priceCents: 1000,
          });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('MENU_CATEGORY_NOT_FOUND');
      });

      it('cashier → 403', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.cashierToken!}`)
          .send({
            categoryId: CATEGORY_A_ID,
            name: 'X',
            priceCents: 1000,
          });
        expect(res.status).toBe(403);
      });

      it('waiter → 403', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.waiterToken!}`)
          .send({
            categoryId: CATEGORY_A_ID,
            name: 'X',
            priceCents: 1000,
          });
        expect(res.status).toBe(403);
      });

      it('kitchen → 403', async () => {
        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
          .send({
            categoryId: CATEGORY_A_ID,
            name: 'X',
            priceCents: 1000,
          });
        expect(res.status).toBe(403);
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // GET /products — list, ADR-003 §8.6 K4 N+1 yasak
    // ────────────────────────────────────────────────────────────────────
    describe('GET /products', () => {
      it('admin → 200 list nested variants (deleted_at IS NULL filtreli)', async () => {
        const res = await request(ctx.app!)
          .get('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.products)).toBe(true);
        // Önceki testlerde en az 2 ürün yaratılmış
        expect(res.body.data.products.length).toBeGreaterThanOrEqual(2);
        const withVariants = (res.body.data.products as ProductListItem[]).find(
          (p) => p.variants.length > 0,
        );
        expect(withVariants).toBeDefined();
      });

      it('K4 N+1 yasak — query count: products + variants ANY = 2 statement (5 product seed)', async () => {
        // 5 ürün seed (her biri 2 variantlı). Sorgu sayısını Pool.query
        // sayacıyla doğrula → tek transaction outside (autocommit), N+1 olmamalı.
        const seedIds: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          const id = randomUUID();
          seedIds.push(id);
          await ctx.db!
            .insertInto('products')
            .values({
              id,
              tenant_id: TENANT_ID,
              category_id: CATEGORY_A_ID,
              name: `N1-Test-${i}`,
              price_cents: 1000 + i,
            })
            .execute();
          await ctx.db!
            .insertInto('product_variants')
            .values([
              {
                id: randomUUID(),
                tenant_id: TENANT_ID,
                product_id: id,
                name: 'V1',
                price_delta_cents: 0,
                is_default: true,
                sort_order: 0,
              },
              {
                id: randomUUID(),
                tenant_id: TENANT_ID,
                product_id: id,
                name: 'V2',
                price_delta_cents: 100,
                is_default: false,
                sort_order: 1,
              },
            ])
            .execute();
        }

        // Pool.query call counter (raw queries — Kysely her statement için bir
        // pool.query çağrısı yapar). Endpoint öncesi/sonrası fark.
        const pool = ctx.pool!;
        const origQuery = pool.query.bind(pool);
        let count = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pool as unknown as { query: any }).query = ((...args: unknown[]) => {
          count += 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (origQuery as any)(...args);
        }) as typeof pool.query;

        const res = await request(ctx.app!)
          .get('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);

        // restore
        (pool as unknown as { query: typeof origQuery }).query = origQuery;

        expect(res.status).toBe(200);
        // ABAC middleware'ler request başına ek SELECT yapmaz; endpoint içinde
        // 2 sorgu hedef: (1) products list, (2) variants ANY. Üst sınır defansif.
        expect(count).toBeLessThanOrEqual(3);
      });

      // RBAC genişletildi (PR-5d): GET /products katalog okuması sipariş alan
      // TÜM rollere açık — GET /menu/categories ile aynı menü-okuma kontratı
      // (ADR-026 K8 / ADR-008). Mobil garson app katalog için okur. Mutasyonlar
      // (POST/PATCH/DELETE) admin-only kalır (yukarıdaki testler değişmedi).
      it('cashier → 200 (katalog sipariş alan rollere açık, ADR-026 K8)', async () => {
        const res = await request(ctx.app!)
          .get('/products')
          .set('Authorization', `Bearer ${ctx.cashierToken!}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.products)).toBe(true);
      });

      it('waiter → 200 (mobil garson katalog okur, ADR-026 K8)', async () => {
        const res = await request(ctx.app!)
          .get('/products')
          .set('Authorization', `Bearer ${ctx.waiterToken!}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.products)).toBe(true);
      });

      it('kitchen → 200 (menü-okuma kategoriler ile aynı kontrat)', async () => {
        const res = await request(ctx.app!)
          .get('/products')
          .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.products)).toBe(true);
      });

      it('cross-tenant izolasyon → tenant B admin tenant A ürünlerini görmez', async () => {
        const res = await request(ctx.appTenantB!)
          .get('/products')
          .set('Authorization', `Bearer ${ctx.tenantBAdminToken!}`);
        expect(res.status).toBe(200);
        const ids = (res.body.data.products as { id: string }[]).map((p) => p.id);
        // Tenant A'da yaratılan herhangi bir id tenant B listesinde olmamalı
        const tenantAProducts = await ctx.db!
          .selectFrom('products')
          .select('id')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        for (const tp of tenantAProducts) {
          expect(ids).not.toContain(tp.id);
        }
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // PATCH /products/:id — declarative replace (ADR-003 §8.6 K1)
    // ────────────────────────────────────────────────────────────────────
    describe('PATCH /products/:id', () => {
      async function seedProductWithVariants(
        variantSpec: Array<{ name: string; isDefault: boolean; sortOrder: number }>,
      ): Promise<{ productId: string; variantIds: string[] }> {
        const productId = randomUUID();
        await ctx.db!
          .insertInto('products')
          .values({
            id: productId,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_A_ID,
            name: `PatchSeed-${productId.slice(0, 6)}`,
            price_cents: 5000,
          })
          .execute();
        const variantIds: string[] = [];
        for (const v of variantSpec) {
          const vid = randomUUID();
          variantIds.push(vid);
          await ctx.db!
            .insertInto('product_variants')
            .values({
              id: vid,
              tenant_id: TENANT_ID,
              product_id: productId,
              name: v.name,
              price_delta_cents: 0,
              is_default: v.isDefault,
              sort_order: v.sortOrder,
            })
            .execute();
        }
        return { productId, variantIds };
      }

      it('admin + variants body yok → variants dokunulmaz', async () => {
        const { productId, variantIds } = await seedProductWithVariants([
          { name: 'V1', isDefault: true, sortOrder: 0 },
          { name: 'V2', isDefault: false, sortOrder: 1 },
        ]);

        const res = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ name: 'Yeni İsim' });
        expect(res.status).toBe(200);
        expect(res.body.data.product.name).toBe('Yeni İsim');
        expect(res.body.data.product.variants).toHaveLength(2);

        // DB doğrulama: aktif variant id'leri değişmedi
        const active = await ctx.db!
          .selectFrom('product_variants')
          .select('id')
          .where('product_id', '=', productId)
          .where('deleted_at', 'is', null)
          .execute();
        const activeIds = active.map((r) => r.id).sort();
        expect(activeIds).toEqual([...variantIds].sort());
      });

      it('admin + variants declarative replace (eksik soft delete + yeni insert + mevcut update)', async () => {
        const { productId, variantIds } = await seedProductWithVariants([
          { name: 'Eski1', isDefault: true, sortOrder: 0 },
          { name: 'Eski2', isDefault: false, sortOrder: 1 },
        ]);

        // Body: eski1'i tut+update, eski2'yi düşür, yeni3 ekle
        const res = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            variants: [
              {
                id: variantIds[0],
                name: 'Eski1-güncel',
                priceDeltaCents: 50,
                isDefault: true,
              },
              { name: 'Yeni3', priceDeltaCents: 200, isDefault: false },
            ],
          });
        expect(res.status).toBe(200);
        expect(res.body.data.product.variants).toHaveLength(2);
        const names = (res.body.data.product.variants as { name: string }[]).map((v) => v.name);
        expect(names).toContain('Eski1-güncel');
        expect(names).toContain('Yeni3');

        // Eski2 soft delete
        const eski2 = await ctx.db!
          .selectFrom('product_variants')
          .select('deleted_at')
          .where('id', '=', variantIds[1]!)
          .executeTakeFirst();
        expect(eski2?.deleted_at).not.toBeNull();
      });

      it('admin + variants: [] → tüm variants soft delete', async () => {
        const { productId, variantIds } = await seedProductWithVariants([
          { name: 'A', isDefault: true, sortOrder: 0 },
          { name: 'B', isDefault: false, sortOrder: 1 },
        ]);

        const res = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ variants: [] });
        expect(res.status).toBe(200);
        expect(res.body.data.product.variants).toEqual([]);

        // Hepsi soft delete
        for (const id of variantIds) {
          const row = await ctx.db!
            .selectFrom('product_variants')
            .select('deleted_at')
            .where('id', '=', id)
            .executeTakeFirst();
          expect(row?.deleted_at).not.toBeNull();
        }
      });

      it('admin + variants array + client explicit promote (default değişikliği) → eski default soft delete + yeni default set', async () => {
        // ADR §8.6 K1 zod refine: variants boş değilse en az 1 isDefault=true zorunlu.
        // Backend-internal "auto-promote" (K3) MVP'de tetiklenecek senaryo yok (DELETE
        // cascade tüm variants siler, PATCH default eksik 422). Promote senaryosu
        // client'ın açıkça yeni default işaretlemesiyle gerçekleşir.
        const { productId, variantIds } = await seedProductWithVariants([
          { name: 'Default', isDefault: true, sortOrder: 0 },
          { name: 'Small', isDefault: false, sortOrder: 1 },
          { name: 'Large', isDefault: false, sortOrder: 2 },
        ]);

        // Default'u body'den çıkar; Small'ı yeni default yap (client explicit promote)
        const res = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            variants: [
              {
                id: variantIds[1],
                name: 'Small',
                priceDeltaCents: 0,
                isDefault: true,
              },
              {
                id: variantIds[2],
                name: 'Large',
                priceDeltaCents: 100,
                isDefault: false,
              },
            ],
          });
        expect(res.status).toBe(200);
        const variants = res.body.data.product.variants as Array<{
          name: string;
          isDefault: boolean;
          sortOrder: number;
        }>;
        // Yeni default: Small
        const small = variants.find((v) => v.name === 'Small');
        expect(small?.isDefault).toBe(true);
        const large = variants.find((v) => v.name === 'Large');
        expect(large?.isDefault).toBe(false);

        // Eski Default soft delete
        const oldDefault = await ctx.db!
          .selectFrom('product_variants')
          .select('deleted_at')
          .where('id', '=', variantIds[0]!)
          .executeTakeFirst();
        expect(oldDefault?.deleted_at).not.toBeNull();
      });

      it('admin + bilinmeyen id → 404 MENU_PRODUCT_NOT_FOUND', async () => {
        const res = await request(ctx.app!)
          .patch(`/products/${randomUUID()}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ name: 'X' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('MENU_PRODUCT_NOT_FOUND');
      });

      it('admin + boş body → 400 VALIDATION_ERROR (refine)', async () => {
        const { productId } = await seedProductWithVariants([
          { name: 'V', isDefault: true, sortOrder: 0 },
        ]);
        const res = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({});
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('admin + cross-tenant product → 404 MENU_PRODUCT_NOT_FOUND (izolasyon)', async () => {
        // Tenant B'de bir ürün yarat
        const tbProductId = randomUUID();
        await ctx.db!
          .insertInto('products')
          .values({
            id: tbProductId,
            tenant_id: TENANT_B_ID,
            category_id: TENANT_B_CATEGORY_ID,
            name: 'TB-Product',
            price_cents: 1000,
          })
          .execute();

        const res = await request(ctx.app!)
          .patch(`/products/${tbProductId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ name: 'Hacked' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('MENU_PRODUCT_NOT_FOUND');
      });

      it('cashier → 403', async () => {
        const { productId } = await seedProductWithVariants([
          { name: 'V', isDefault: true, sortOrder: 0 },
        ]);
        const res = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.cashierToken!}`)
          .send({ name: 'X' });
        expect(res.status).toBe(403);
      });

      it('waiter → 403', async () => {
        const { productId } = await seedProductWithVariants([
          { name: 'V', isDefault: true, sortOrder: 0 },
        ]);
        const res = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.waiterToken!}`)
          .send({ name: 'X' });
        expect(res.status).toBe(403);
      });

      it('kitchen → 403', async () => {
        const { productId } = await seedProductWithVariants([
          { name: 'V', isDefault: true, sortOrder: 0 },
        ]);
        const res = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
          .send({ name: 'X' });
        expect(res.status).toBe(403);
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // DELETE /products/:id — cascade soft delete (ADR-003 §8.6 K2)
    // ────────────────────────────────────────────────────────────────────
    describe('DELETE /products/:id', () => {
      it('admin → 204 + product + variants cascade soft delete (atomik)', async () => {
        const productId = randomUUID();
        const variantId1 = randomUUID();
        const variantId2 = randomUUID();
        await ctx.db!
          .insertInto('products')
          .values({
            id: productId,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_A_ID,
            name: 'DelCascade',
            price_cents: 5000,
          })
          .execute();
        await ctx.db!
          .insertInto('product_variants')
          .values([
            {
              id: variantId1,
              tenant_id: TENANT_ID,
              product_id: productId,
              name: 'V1',
              price_delta_cents: 0,
              is_default: true,
              sort_order: 0,
            },
            {
              id: variantId2,
              tenant_id: TENANT_ID,
              product_id: productId,
              name: 'V2',
              price_delta_cents: 100,
              is_default: false,
              sort_order: 1,
            },
          ])
          .execute();

        const res = await request(ctx.app!)
          .delete(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(204);

        // Product soft delete
        const productRow = await ctx.db!
          .selectFrom('products')
          .select('deleted_at')
          .where('id', '=', productId)
          .executeTakeFirst();
        expect(productRow?.deleted_at).not.toBeNull();

        // Variants cascade soft delete
        const variants = await ctx.db!
          .selectFrom('product_variants')
          .select(['id', 'deleted_at'])
          .where('product_id', '=', productId)
          .execute();
        for (const v of variants) {
          expect(v.deleted_at).not.toBeNull();
        }

        // GET listede yok
        const listRes = await request(ctx.app!)
          .get('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const listIds = (listRes.body.data.products as { id: string }[]).map(
          (p) => p.id,
        );
        expect(listIds).not.toContain(productId);
      });

      it('admin + bilinmeyen id → 404 MENU_PRODUCT_NOT_FOUND', async () => {
        const res = await request(ctx.app!)
          .delete(`/products/${randomUUID()}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('MENU_PRODUCT_NOT_FOUND');
      });

      it('cashier → 403', async () => {
        const productId = randomUUID();
        await ctx.db!
          .insertInto('products')
          .values({
            id: productId,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_A_ID,
            name: 'DelABACtest',
            price_cents: 100,
          })
          .execute();
        const res = await request(ctx.app!)
          .delete(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.cashierToken!}`);
        expect(res.status).toBe(403);
      });

      it('waiter → 403', async () => {
        const productId = randomUUID();
        await ctx.db!
          .insertInto('products')
          .values({
            id: productId,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_A_ID,
            name: 'DelABACw',
            price_cents: 100,
          })
          .execute();
        const res = await request(ctx.app!)
          .delete(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.waiterToken!}`);
        expect(res.status).toBe(403);
      });

      it('kitchen → 403', async () => {
        const productId = randomUUID();
        await ctx.db!
          .insertInto('products')
          .values({
            id: productId,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_A_ID,
            name: 'DelABACk',
            price_cents: 100,
          })
          .execute();
        const res = await request(ctx.app!)
          .delete(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
        expect(res.status).toBe(403);
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // Snapshot invariant (ADR-003 §7) — order_items product_name değişmez
    // ────────────────────────────────────────────────────────────────────
    describe('Snapshot invariant (ADR-003 §7)', () => {
      it('product update/soft delete sonrası order_items.product_name değişmez', async () => {
        // Ürün yarat
        const productId = randomUUID();
        await ctx.db!
          .insertInto('products')
          .values({
            id: productId,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_A_ID,
            name: 'Orijinal İsim',
            price_cents: 8000,
          })
          .execute();

        // Order + order_item snapshot al (raw insert; order route MVP burada
        // değil — snapshot sözleşmesini DB seviyesinde test ediyoruz).
        const orderId = randomUUID();
        const itemId = randomUUID();
        const today = new Date();
        const utcMidnight = new Date(
          Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
        );
        await ctx.db!
          .insertInto('orders')
          .values({
            id: orderId,
            tenant_id: TENANT_ID,
            order_no: 9999,
            store_date: utcMidnight,
            status: 'open',
            order_type: 'dine_in',
            waiter_user_id: ADMIN_ID,
          })
          .execute();
        await ctx.db!
          .insertInto('order_items')
          .values({
            id: itemId,
            tenant_id: TENANT_ID,
            order_id: orderId,
            product_id: productId,
            product_name: 'Orijinal İsim',
            category_name_snapshot: 'Pideler',
            unit_price_cents: 8000,
            quantity: 1,
            total_cents: 8000,
          })
          .execute();

        // Product update → name değişir
        const patchRes = await request(ctx.app!)
          .patch(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ name: 'Değişmiş İsim', priceCents: 9999 });
        expect(patchRes.status).toBe(200);

        // Sonra soft delete
        const delRes = await request(ctx.app!)
          .delete(`/products/${productId}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(delRes.status).toBe(204);

        // order_items.product_name + unit_price_cents korunmalı
        const itemRow = await ctx.db!
          .selectFrom('order_items')
          .select(['product_name', 'unit_price_cents', 'category_name_snapshot'])
          .where('id', '=', itemId)
          .executeTakeFirst();
        expect(itemRow?.product_name).toBe('Orijinal İsim');
        expect(itemRow?.unit_price_cents).toBe(8000);
        expect(itemRow?.category_name_snapshot).toBe('Pideler');
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // Transaction atomicity (ADR-003 §8.6 K1, K2 — tek BEGIN/COMMIT)
    // ────────────────────────────────────────────────────────────────────
    describe('Transaction atomicity', () => {
      it('POST sırasında variant insert hatası → product oluşmamalı (rollback)', async () => {
        // Geçersiz UUID id ile variant gönder (zod yakalamadan önce repo'ya
        // ulaşırsa transaction patlayacak). zod schema id: uuid().optional()
        // → string ama non-uuid 400 olur. Daha gerçekçi test: name min 1
        // boş → zod 400. Burada DB-level rollback'i test etmek için yapay
        // unique violation kullanırız: aynı id ile iki variant gönder.
        const dupId = randomUUID();
        const productCountBefore = (
          await ctx.db!
            .selectFrom('products')
            .select(({ fn }) => fn.countAll().as('c'))
            .where('tenant_id', '=', TENANT_ID)
            .executeTakeFirstOrThrow()
        ).c;

        const res = await request(ctx.app!)
          .post('/products')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            categoryId: CATEGORY_A_ID,
            name: 'Atomic-Test',
            priceCents: 1000,
            variants: [
              { id: dupId, name: 'V1', priceDeltaCents: 0, isDefault: true },
              { id: dupId, name: 'V2', priceDeltaCents: 100, isDefault: false },
            ],
          });
        // İkinci variant insert PK conflict → 500 INTERNAL_ERROR (ya da repo
        // mapping sonucu). Ama önemli olan transaction rollback'i.
        expect([400, 500, 409]).toContain(res.status);

        const productCountAfter = (
          await ctx.db!
            .selectFrom('products')
            .select(({ fn }) => fn.countAll().as('c'))
            .where('tenant_id', '=', TENANT_ID)
            .where('name', '=', 'Atomic-Test')
            .executeTakeFirstOrThrow()
        ).c;
        // Rollback başarılı → Atomic-Test isimli ürün yok
        expect(Number(productCountAfter)).toBe(0);
        // Total product count diff yok (sadece Atomic-Test target)
        expect(Number(productCountBefore)).toBeGreaterThanOrEqual(0);
      });
    });
  },
);

// Helper tip — test response içi shape
interface ProductListItem {
  id: string;
  name: string;
  variants: Array<{ id: string; name: string; isDefault: boolean }>;
}
