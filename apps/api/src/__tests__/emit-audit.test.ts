import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { Server as IoServer } from 'socket.io';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { KitchenItemStatusChangedPayloadSchema } from '@restoran-pos/shared-types';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Blok 5 (Hat C) derin denetim — `kitchen.*` emit envanteri (YEŞİL).
 *
 * API-RT-01 bulgusu (`emit-findings.test.ts`) yalnız `kitchen.orderSent`
 * PAYLOAD ŞEKLİNİ kırıyor. Bu dosya envanterin geri kalanını doğrular:
 *   - Routing (oda hedefi) 3 `kitchen.orderSent` call-site'ında da DOĞRU
 *     (yalnız payload şekli bozuk — hedef oda/emit-sayısı temiz).
 *   - 4. emit (`kitchen.itemStatusChanged`, satır ~1954) payload şeması ile
 *     BİREBİR uyumlu — API-RT-01 bu event'i ETKİLEMİYOR (temiz alan kanıtı).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-rtaud-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `admin-rtaud-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();

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
      code: `M-RTA-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'kitchen.* emit envanteri — routing + kitchen.itemStatusChanged uyum (YEŞİL, API-RT-01 kapsamı DIŞI kanıt)',
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
          name: `RT-Audit Tenant ${TENANT_ID.slice(0, 8)}`,
          slug: `t-rtaud-${TENANT_ID.slice(0, 8)}`,
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

      // kitchen_print DEFAULT TRUE (Migration 034).
      await db
        .insertInto('categories')
        .values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Izgara' })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Adana Kebap',
          price_cents: 5500,
          is_active: true,
        })
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

    it('ORD-RT-04: kitchen.orderSent (dine-in POST) doğru odaya, tam olarak 1 kez emit edilir (routing temiz — yalnız payload şekli bozuk)', async () => {
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
      expect(emits.length).toBe(1);
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}:role:kitchen`)).toBe(true);
    });

    it('ORD-RT-05: kitchen.itemStatusChanged payload KitchenItemStatusChangedPayloadSchema ile birebir uyumlu (temiz alan — API-RT-01 kapsamı dışı)', async () => {
      const tableId = await insertTable();
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [{ productId: PRODUCT_ID, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.order.id as string;
      const itemId = createRes.body.data.items[0].id as string;

      clearEmits(ctx.mockIo!);

      const patchRes = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}/status`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'preparing' });
      expect(patchRes.status).toBe(200);

      const emits = findEmits(ctx.mockIo!, 'kitchen.itemStatusChanged');
      expect(emits.length).toBe(1);
      const payload = emits[0]![1];
      const parsed = KitchenItemStatusChangedPayloadSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      expect(routedTo(ctx.mockIo!, `tenant:${TENANT_ID}:role:kitchen`)).toBe(true);
    });
  },
);
