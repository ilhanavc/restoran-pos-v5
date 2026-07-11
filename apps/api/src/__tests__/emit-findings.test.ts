import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { Server as IoServer } from 'socket.io';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { KitchenOrderSentPayloadSchema } from '@restoran-pos/shared-types';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Blok 5 (Hat C) derin denetim — KASITLI KIRMIZI regresyon kilidi.
 *
 * API-RT-01 [HIGH] (Blok 4 devirinden) — `apps/api/src/routes/orders.ts`
 * içindeki 3× `kitchen.orderSent` emit call-site'ı (satır ~599 takeaway POST,
 * ~1013 dine-in POST, ~1147 POST /:id/items) `emitTenant()` helper'ının zod
 * parse-öncesi kontratını (§11.3) BYPASS eder — doğrudan
 * `deps.io.of('/realtime').to(room).emit('kitchen.orderSent', {...})` çağırır.
 * Gönderilen payload şekli:
 *
 *   { orderId, orderType, items: [{ id, productName, quantity }] }
 *
 * `KitchenOrderSentPayloadSchema` (packages/shared-types/src/realtime.ts) ise:
 *
 *   { orderId, tableId: uuid|null, orderType, items: [{ id, productName, qty }] }
 *
 * İKİ sapma: (1) `tableId` alanı HİÇ gönderilmiyor (schema'da zorunlu,
 * nullable ama optional DEĞİL); (2) `items[].qty` yerine `items[].quantity`
 * gönderiliyor (schema'nın `qty` alanı da zorunlu). Sonuç: gerçek bir
 * dine-in `POST /orders` (mutfak kalemi ile) sonrası yayınlanan
 * `kitchen.orderSent` payload'ı kendi kontrat şemasını GEÇEMİYOR — mobil/web
 * KDS istemcisi (ADR-020) zod-tip varsayımıyla kodlanmışsa runtime'da ya
 * `tableId`/`qty` `undefined` okur ya da (istemci de safeParse kullanıyorsa)
 * event'i sessizce reddeder → mutfak ekranına sipariş DÜŞMEZ.
 *
 * Bu dosya gerçek bir `POST /orders` (dine-in, mutfak-basılan kategori)
 * çağırır, mock Socket.IO'dan yakalanan GERÇEK payload'ı şemaya karşı
 * `safeParse` eder ve `success === true` bekler (doğru davranış) — bugün
 * KIRMIZI (fail, `success === false`).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-rt01-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `admin-rt01-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const CUSTOMER_ID = randomUUID();

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

async function insertTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-RT1-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'API-RT-01 [HIGH] — kitchen.orderSent emit payload KitchenOrderSentPayloadSchema ile uyuşmuyor (KASITLI KIRMIZI)',
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
        .values({
          id: TENANT_ID,
          name: `RT-01 Tenant ${TENANT_ID.slice(0, 8)}`,
          slug: `t-rt01-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      await db
        .insertInto('users')
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          password_hash: adminHash,
          role: 'admin',
        })
        .execute();

      await db
        .insertInto('areas')
        .values({ id: AREA_ID, tenant_id: TENANT_ID, name: 'Salon' })
        .execute();

      // kitchen_print DEFAULT TRUE (Migration 034) — explicit vermiyoruz,
      // mutfağa düşen gerçek prod default'u test ediyoruz.
      await db
        .insertInto('categories')
        .values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Çorbalar' })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Mercimek Çorbası',
          price_cents: 4500,
          is_active: true,
        })
        .execute();
      await db
        .insertInto('customers')
        .values({ id: CUSTOMER_ID, tenant_id: TENANT_ID, full_name: 'RT-01 Müşteri' })
        .execute();

      ctx.adminToken = await login(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
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
        await db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('areas').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await db.destroy();
      }
      if (ctx.prevBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = ctx.prevBypass;
      }
    });

    it('ORD-RT-01: gerçek dine-in POST /orders → kitchen.orderSent payload şemayı GEÇMELİ (bugün FAIL — KIRMIZI)', async () => {
      const tableId = await insertTable();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [{ productId: PRODUCT_ID, quantity: 2 }],
        });
      expect(res.status).toBe(201);

      const emits = findEmits(ctx.mockIo!, 'kitchen.orderSent');
      expect(emits.length).toBe(1);
      const payload = emits[0]![1];

      // Kontrat: emitTenant() paterninin (§11.3) yaptığı gibi emit-öncesi
      // zod parse burada AYRIYETEN (test tarafında) uygulanır — çünkü prod
      // kodu bunu hiç yapmıyor (bypass, bulgunun kendisi).
      const parsed = KitchenOrderSentPayloadSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it('ORD-RT-02: yakalanan payload gerçek alan-eksikliğini kanıtlar (tableId yok, items[].qty yok)', async () => {
      const tableId = await insertTable();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [{ productId: PRODUCT_ID, quantity: 1 }],
        });
      expect(res.status).toBe(201);

      const emits = findEmits(ctx.mockIo!, 'kitchen.orderSent');
      const payload = emits[0]![1] as Record<string, unknown>;

      // Somut kanıt: alan gerçekten payload'ta yok / yanlış adla var.
      expect('tableId' in payload).toBe(false);
      const items = payload['items'] as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]!['qty']).toBeUndefined();
      expect(items[0]!['quantity']).toBe(1);
    });
  },
);
