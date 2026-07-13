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
 * ADR-013 Amendment 1 (FAZ 1 / PR-3) — sipariş oluşturma + kalem-ekleme
 * idempotency regresyon çekirdeği (derin denetim BLOCKER M10-A-01).
 *
 * Kanıtlanan davranış:
 *   (a) create retry-aynı-key → TEK sipariş + 200 replay + print_jobs DEĞİŞMEZ.
 *   (b) addItems retry-aynı-batchKey → kalem duplike OLMAZ + print_jobs DEĞİŞMEZ.
 *   (c) keysiz istek (eski APK) → legacy: addItems tekrarı kalemi DUPLİKE eder
 *       (bilinçli degradation — Karar 5 opsiyonel-başla).
 *   (d) farklı batchKey → ikinci batch normal eklenir (dedup yok).
 *   (e) başarılı create retry → 200 replay, 409 DEĞİL (Bağlam belirsizliği fix).
 *   (f) Idempotency-Key HEADER paritesi (body yerine header).
 *   (g) paralel aynı-batchKey → tek batch kazanır, kalem duplike YOK, 500 YOK.
 *   (h) order_item_batches FK: order silinince CASCADE (23503 yok).
 *   (i) actor hard-delete → order_item_batches.created_by_user_id SET NULL.
 *
 * Lokal `pos_test` DB'de koşulur (afterAll `DELETE FROM tenants` yapar).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE_CENTS = 5000;

// Her senaryo kendi boş masasını kullanır (tables-open partial unique bir masada
// yalnız tek açık siparişe izin verir → izole masa = temiz create).
const TABLE_A = randomUUID(); // create idempotency
const TABLE_B = randomUUID(); // addItems idempotency
const TABLE_C = randomUUID(); // keyless legacy
const TABLE_D = randomUUID(); // different batchKey
const TABLE_E = randomUUID(); // create success retry (200 not 409)
const TABLE_F = randomUUID(); // header parity
const TABLE_G = randomUUID(); // parallel addItems race
const TABLE_H = randomUUID(); // FK cascade
const TABLE_I = randomUUID(); // actor SET NULL

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
}

const ctx: Partial<TestCtx> = {};
let prevBypass: string | undefined;

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

/** Bearer'lı POST /orders (dine_in create). */
function postCreate(body: Record<string, unknown>) {
  return request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${ctx.adminToken}`)
    .send(body);
}

/** Bearer'lı POST /orders/:id/items (addItems). */
function postAddItems(orderId: string, body: Record<string, unknown>) {
  return request(ctx.app!)
    .post(`/orders/${orderId}/items`)
    .set('Authorization', `Bearer ${ctx.adminToken}`)
    .send(body);
}

const oneItem = () => [{ productId: PRODUCT_ID, quantity: 1 }];

/** Tenant print_jobs toplam sayısı — replay'de +0 (KDS enqueue bastırılır). */
async function countPrintJobs(): Promise<number> {
  const row = await ctx.db!
    .selectFrom('print_jobs')
    .select((eb) => eb.fn.countAll<string>().as('c'))
    .where('tenant_id', '=', TENANT_ID)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

async function countItems(orderId: string): Promise<number> {
  const row = await ctx.db!
    .selectFrom('order_items')
    .select((eb) => eb.fn.countAll<string>().as('c'))
    .where('tenant_id', '=', TENANT_ID)
    .where('order_id', '=', orderId)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

async function countOrdersWithKey(key: string): Promise<number> {
  const row = await ctx.db!
    .selectFrom('orders')
    .select((eb) => eb.fn.countAll<string>().as('c'))
    .where('tenant_id', '=', TENANT_ID)
    .where('idempotency_key', '=', key)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

async function countBatches(key: string): Promise<number> {
  const row = await ctx.db!
    .selectFrom('order_item_batches')
    .select((eb) => eb.fn.countAll<string>().as('c'))
    .where('tenant_id', '=', TENANT_ID)
    .where('batch_key', '=', key)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Orders idempotency regression (ADR-013 Amd1)',
  () => {
    beforeAll(async () => {
      // Tek app + tek login (limiter'ı test etmiyoruz) → bypass aç (buildApp ÖNCESİ).
      prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';
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
          name: 'Test Tenant Idempotency',
          slug: `test-idem-${TENANT_ID.slice(0, 8)}`,
        })
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .execute();

      await db
        .insertInto('users')
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          password_hash: await hashPassword(ADMIN_PASSWORD),
          role: 'admin',
        })
        .execute();

      // kitchen_print DEFAULT TRUE → dine_in kalem KDS'e düşer → print_jobs satırı.
      await db
        .insertInto('categories')
        .values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Test Kategori' })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Test Ürün',
          price_cents: PRODUCT_PRICE_CENTS,
        })
        .execute();

      await db
        .insertInto('tables')
        .values(
          [
            TABLE_A,
            TABLE_B,
            TABLE_C,
            TABLE_D,
            TABLE_E,
            TABLE_F,
            TABLE_G,
            TABLE_H,
            TABLE_I,
          ].map((id, i) => ({
            id,
            tenant_id: TENANT_ID,
            code: `M-${i}-${id.slice(0, 4)}`,
            capacity: 4,
          })),
        )
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        const del = (t: 'refresh_tokens' | 'order_item_batches' | 'print_jobs' | 'order_items' | 'orders' | 'order_no_counters' | 'tables' | 'users' | 'products' | 'categories' | 'tenant_settings') =>
          ctx.db!.deleteFrom(t).where('tenant_id', '=', TENANT_ID).execute();
        await del('refresh_tokens');
        await del('order_item_batches');
        await del('print_jobs');
        await del('order_items');
        await del('orders');
        await del('order_no_counters');
        await del('tables');
        await del('users');
        await del('products');
        await del('categories');
        await del('tenant_settings');
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
      if (prevBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = prevBypass;
      }
    });

    it('(a) create retry-aynı-key → TEK sipariş + 200 replay + print_jobs değişmez', async () => {
      const key = randomUUID();
      const first = await postCreate({
        tableId: TABLE_A,
        orderType: 'dine_in',
        items: oneItem(),
        idempotencyKey: key,
      });
      expect(first.status).toBe(201);
      const orderId = first.body.data.order.id as string;
      const jobsAfterFirst = await countPrintJobs();

      const second = await postCreate({
        tableId: TABLE_A,
        orderType: 'dine_in',
        items: oneItem(),
        idempotencyKey: key,
      });
      expect(second.status).toBe(200);
      expect(second.body.data.replayed).toBe(true);
      expect(second.body.data.order.id).toBe(orderId);

      expect(await countOrdersWithKey(key)).toBe(1);
      // Replay yan-etkisiz: 2. mutfak fişi enqueue EDİLMEDİ.
      expect(await countPrintJobs()).toBe(jobsAfterFirst);
    });

    it('(b) addItems retry-aynı-batchKey → kalem duplike olmaz + print_jobs değişmez', async () => {
      // Base sipariş (keysiz create yeterli — addItems'i test ediyoruz).
      const created = await postCreate({
        tableId: TABLE_B,
        orderType: 'dine_in',
        items: oneItem(),
      });
      expect(created.status).toBe(201);
      const orderId = created.body.data.order.id as string;

      const batchKey = randomUUID();
      const add1 = await postAddItems(orderId, { items: oneItem(), batchKey });
      expect(add1.status).toBe(200);
      const itemsAfterAdd = await countItems(orderId);
      const jobsAfterAdd = await countPrintJobs();

      const add2 = await postAddItems(orderId, { items: oneItem(), batchKey });
      expect(add2.status).toBe(200);
      expect(add2.body.data.replayed).toBe(true);
      expect(add2.body.data.order.id).toBe(orderId);

      // Kalem duplike OLMADI + batch marker TEK + 2. mutfak fişi YOK.
      expect(await countItems(orderId)).toBe(itemsAfterAdd);
      expect(await countBatches(batchKey)).toBe(1);
      expect(await countPrintJobs()).toBe(jobsAfterAdd);
    });

    it('(c) keysiz addItems (eski istemci) → legacy: kalem DUPLİKE olur', async () => {
      const created = await postCreate({
        tableId: TABLE_C,
        orderType: 'dine_in',
        items: oneItem(),
      });
      const orderId = created.body.data.order.id as string;

      await postAddItems(orderId, { items: oneItem() }); // batchKey YOK
      const afterFirst = await countItems(orderId);
      await postAddItems(orderId, { items: oneItem() }); // batchKey YOK — retry
      const afterSecond = await countItems(orderId);

      // Guard yok → bilinçli legacy davranış (Karar 5): ikinci ekleme duplike eder.
      expect(afterSecond).toBe(afterFirst + 1);
    });

    it('(d) farklı batchKey → ikinci batch normal eklenir', async () => {
      const created = await postCreate({
        tableId: TABLE_D,
        orderType: 'dine_in',
        items: oneItem(),
      });
      const orderId = created.body.data.order.id as string;

      const add1 = await postAddItems(orderId, {
        items: oneItem(),
        batchKey: randomUUID(),
      });
      expect(add1.body.data.replayed).toBeFalsy();
      const afterFirst = await countItems(orderId);

      const add2 = await postAddItems(orderId, {
        items: oneItem(),
        batchKey: randomUUID(), // FARKLI key → dedup yok
      });
      expect(add2.body.data.replayed).toBeFalsy();
      expect(await countItems(orderId)).toBe(afterFirst + 1);
    });

    it('(e) başarılı create retry → 200 replay, 409 DEĞİL', async () => {
      const key = randomUUID();
      const first = await postCreate({
        tableId: TABLE_E,
        orderType: 'dine_in',
        items: oneItem(),
        idempotencyKey: key,
      });
      expect(first.status).toBe(201);

      const retry = await postCreate({
        tableId: TABLE_E,
        orderType: 'dine_in',
        items: oneItem(),
        idempotencyKey: key,
      });
      // Masa-doluluk 409'una TAKILMADAN replay (belirsizlik çözüldü).
      expect(retry.status).toBe(200);
      expect(retry.status).not.toBe(409);
      expect(retry.body.data.order.id).toBe(first.body.data.order.id);
    });

    it('(f) Idempotency-Key HEADER paritesi → body yerine header ile guard', async () => {
      const key = randomUUID();
      const first = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .set('Idempotency-Key', key)
        .send({ tableId: TABLE_F, orderType: 'dine_in', items: oneItem() });
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .set('Idempotency-Key', key)
        .send({ tableId: TABLE_F, orderType: 'dine_in', items: oneItem() });
      expect(second.status).toBe(200);
      expect(second.body.data.replayed).toBe(true);
      expect(await countOrdersWithKey(key)).toBe(1);
    });

    it('(g) paralel aynı-batchKey addItems → tek batch, kalem duplike YOK, 500 YOK', async () => {
      const created = await postCreate({
        tableId: TABLE_G,
        orderType: 'dine_in',
        items: oneItem(),
      });
      const orderId = created.body.data.order.id as string;
      const baseItems = await countItems(orderId);

      const batchKey = randomUUID();
      const [r1, r2] = await Promise.all([
        postAddItems(orderId, { items: oneItem(), batchKey }),
        postAddItems(orderId, { items: oneItem(), batchKey }),
      ]);

      // İkisi de 200 (ON CONFLICT yolu — kaybeden replay, 500 DEĞİL — DB-TX-05).
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      // Tek batch işlendi → yalnız 1 kalem eklendi + tek marker.
      expect(await countItems(orderId)).toBe(baseItems + 1);
      expect(await countBatches(batchKey)).toBe(1);
    });

    it('(h) order_item_batches FK: order silinince CASCADE (23503 yok)', async () => {
      const created = await postCreate({
        tableId: TABLE_H,
        orderType: 'dine_in',
        items: oneItem(),
      });
      const orderId = created.body.data.order.id as string;
      const batchKey = randomUUID();
      await postAddItems(orderId, { items: oneItem(), batchKey });
      expect(await countBatches(batchKey)).toBe(1);

      // order_items + order sil (CASCADE marker'ı da düşürmeli).
      await ctx.db!.deleteFrom('order_items').where('order_id', '=', orderId).execute();
      await ctx.db!.deleteFrom('orders').where('id', '=', orderId).execute();
      expect(await countBatches(batchKey)).toBe(0);
    });

    it('(i) actor hard-delete → order_item_batches.created_by_user_id SET NULL', async () => {
      const created = await postCreate({
        tableId: TABLE_I,
        orderType: 'dine_in',
        items: oneItem(),
      });
      const orderId = created.body.data.order.id as string;
      const batchKey = randomUUID();
      await postAddItems(orderId, { items: oneItem(), batchKey });

      const before = await ctx.db!
        .selectFrom('order_item_batches')
        .select(['created_by_user_id'])
        .where('batch_key', '=', batchKey)
        .executeTakeFirstOrThrow();
      expect(before.created_by_user_id).toBe(ADMIN_ID);

      // Yeni kullanıcı ekle + onunla batch yaz + hard-delete → SET NULL.
      const tmpUserId = randomUUID();
      await ctx.db!
        .insertInto('users')
        .values({
          id: tmpUserId,
          tenant_id: TENANT_ID,
          email: `tmp-${tmpUserId}@example.com`,
          username: `tmp-${tmpUserId.slice(0, 8)}`,
          password_hash: await hashPassword('tmppass1234'),
          role: 'waiter',
        })
        .execute();
      const markerId = randomUUID();
      await ctx.db!
        .insertInto('order_item_batches')
        .values({
          id: markerId,
          tenant_id: TENANT_ID,
          order_id: orderId,
          batch_key: randomUUID(),
          created_by_user_id: tmpUserId,
        })
        .execute();

      await ctx.db!.deleteFrom('users').where('id', '=', tmpUserId).execute();

      const after = await ctx.db!
        .selectFrom('order_item_batches')
        .select(['created_by_user_id'])
        .where('id', '=', markerId)
        .executeTakeFirstOrThrow();
      expect(after.created_by_user_id).toBeNull();
    });
  },
);
