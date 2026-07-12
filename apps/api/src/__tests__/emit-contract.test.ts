import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ESLint } from 'eslint';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import type { Server as IoServer } from 'socket.io';
import {
  KitchenOrderSentPayloadSchema,
  KitchenItemStatusChangedPayloadSchema,
} from '@restoran-pos/shared-types';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { emitToRole } from '../realtime/emit';
import { logger } from '../logger';

/**
 * ADR-010 §11.3 Amendment K7 — realtime emit kontrat testleri (derin denetim
 * API-RT-01 / ORD-RT-01 KIRMIZI→YEŞİL).
 *
 * (a) 3× `kitchen.orderSent` akışı (takeaway create / dine_in create /
 *     kalem-ekle) tek emit path'ten (`emitKitchen` → `emitToRole` → safeParse)
 *     geçen payload'ı `KitchenOrderSentPayloadSchema.safeParse` GEÇMELİ (K1
 *     `quantity` + K2 `tableId` optional sonrası yeşil; drift'te emit DROP
 *     olacağı için `findEmit` undefined döner → test kırar).
 * (b) `kitchen.itemStatusChanged` akışı safeParse geçer.
 * (c) Fire-and-forget (K4): `emit.ts` helper'a bozuk payload → THROW ETMEZ,
 *     `warn`-log + DROP; `.emit()` kendisi throw ederse de sızmaz.
 * (d) eslint regresyon (K5): broad `no-restricted-syntax` selector raw
 *     `.of().to().emit()`'i apps/api/src route'ta yakalar; `emit.ts` muaf.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `emit-admin-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `emit-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

let KITCHEN_CATEGORY_ID: string;
let PIDE_PRODUCT_ID: string;
let CUSTOMER_ID: string;

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

function findEmit(mockIo: MockIo, event: string): [string, unknown] | undefined {
  return mockIo.emitSpy.mock.calls.find((c) => c[0] === event) as
    | [string, unknown]
    | undefined;
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
      code: `M-EC-${randomUUID().slice(0, 6)}`,
      capacity: 4,
    })
    .execute();
  return id;
}

// ── (a)+(b) Integration: DB-gated ─────────────────────────────────────────
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-010 Amendment K7 (a/b) — kitchen.* emit payload kontratı (safeParse yeşil)',
  () => {
    beforeAll(async () => {
      ctx.prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';

      const pool = createPool({ connectionString: DB_URL ?? '' });
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
          name: 'Emit Contract Tenant',
          slug: `ec-${TENANT_ID.slice(0, 8)}`,
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

      KITCHEN_CATEGORY_ID = randomUUID();
      await db
        .insertInto('categories')
        .values({
          id: KITCHEN_CATEGORY_ID,
          tenant_id: TENANT_ID,
          name: 'Pideler',
          sort_order: 1,
          kitchen_print: true,
        })
        .execute();

      PIDE_PRODUCT_ID = randomUUID();
      await db
        .insertInto('products')
        .values({
          id: PIDE_PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: KITCHEN_CATEGORY_ID,
          name: 'Kuşbaşılı Pide',
          price_cents: 14000,
          is_active: true,
        })
        .execute();

      CUSTOMER_ID = randomUUID();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_ID,
          tenant_id: TENANT_ID,
          full_name: 'Emit Contract Müşteri',
        })
        .execute();

      ctx.adminToken = await login(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db !== undefined) {
        await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
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

    it('a1: takeaway POST /orders → kitchen.orderSent payload şemayı geçer', async () => {
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }],
        });
      expect(res.status).toBe(201);

      const kitchen = findEmit(ctx.mockIo!, 'kitchen.orderSent');
      expect(kitchen).toBeDefined();
      const parsed = KitchenOrderSentPayloadSchema.safeParse(kitchen![1]);
      expect(parsed.success).toBe(true);
    });

    it('a2: dine_in POST /orders → kitchen.orderSent payload şemayı geçer', async () => {
      const tableId = await insertTable();
      clearEmits(ctx.mockIo!);
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 2 }],
        });
      expect(res.status).toBe(201);

      const kitchen = findEmit(ctx.mockIo!, 'kitchen.orderSent');
      expect(kitchen).toBeDefined();
      const parsed = KitchenOrderSentPayloadSchema.safeParse(kitchen![1]);
      expect(parsed.success).toBe(true);
    });

    it('a3: POST /orders/:id/items (kalem-ekle) → kitchen.orderSent şemayı geçer', async () => {
      const tableId = await insertTable();
      const create = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }],
        });
      expect(create.status).toBe(201);
      const orderId = create.body.data.order.id as string;
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }] });
      expect(res.status).toBe(200);

      const kitchen = findEmit(ctx.mockIo!, 'kitchen.orderSent');
      expect(kitchen).toBeDefined();
      const parsed = KitchenOrderSentPayloadSchema.safeParse(kitchen![1]);
      expect(parsed.success).toBe(true);
    });

    it('b: PATCH /items/:id/status → kitchen.itemStatusChanged şemayı geçer', async () => {
      const tableId = await insertTable();
      const create = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }],
        });
      expect(create.status).toBe(201);
      const orderId = create.body.data.order.id as string;

      // Kitchen kalemi create sırasında status='sent' → 'preparing' geçişi
      // kitchen.itemStatusChanged yayınlar.
      const item = await ctx.db!
        .selectFrom('order_items')
        .select(['id'])
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      clearEmits(ctx.mockIo!);

      const res = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${item.id}/status`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'preparing' });
      expect(res.status).toBe(200);

      const evt = findEmit(ctx.mockIo!, 'kitchen.itemStatusChanged');
      expect(evt).toBeDefined();
      const parsed = KitchenItemStatusChangedPayloadSchema.safeParse(evt![1]);
      expect(parsed.success).toBe(true);
    });
  },
);

// ── (c) Fire-and-forget unit (no DB) ──────────────────────────────────────
describe('ADR-010 Amendment K7 (c) — emit fire-and-forget (drop, no throw)', () => {
  it('bozuk payload → THROW ETMEZ + emit edilmez + warn-log', () => {
    const emitSpy = vi.fn();
    const io = {
      of: () => ({ to: () => ({ emit: emitSpy }) }),
    } as unknown as IoServer;
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    // orderId geçersiz uuid → safeParse FAIL (tip-geçerli, runtime-geçersiz).
    const bad = { orderId: 'not-a-uuid', orderType: 'dine_in' as const, items: [] };

    expect(() =>
      emitToRole(
        {
          io,
          eventName: 'kitchen.orderSent',
          payloadSchema: KitchenOrderSentPayloadSchema,
        },
        TENANT_ID,
        'kitchen',
        bad,
      ),
    ).not.toThrow();
    expect(emitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('gönderim .emit() throw ederse istek yoluna SIZMAZ (try/catch)', () => {
    const throwingIo = {
      of: () => ({
        to: () => ({
          emit: () => {
            throw new Error('socket boom');
          },
        }),
      }),
    } as unknown as IoServer;
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    // Geçerli payload → safeParse geçer → send() throw → yakalanır.
    const good = {
      orderId: randomUUID(),
      orderType: 'dine_in' as const,
      items: [{ id: randomUUID(), productName: 'Pide', quantity: 1 }],
    };

    expect(() =>
      emitToRole(
        {
          io: throwingIo,
          eventName: 'kitchen.orderSent',
          payloadSchema: KitchenOrderSentPayloadSchema,
        },
        TENANT_ID,
        'kitchen',
        good,
      ),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

// ── (d) eslint no-restricted-syntax regression (K5) ───────────────────────
describe('ADR-010 Amendment K7 (d) — eslint broad .emit() guard (K5)', () => {
  const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

  it('raw io.of().to().emit() apps/api/src route dosyasında lint hatası verir', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const code = [
      'const io = { of: (_n: string) => ({ to: (_r: string) => ({ emit: (_e: string, _p: unknown): boolean => true }) }) };',
      "io.of('/realtime').to('tenant:x:role:kitchen').emit('kitchen.orderSent', { orderId: 'x' });",
      '',
    ].join('\n');
    const results = await eslint.lintText(code, {
      filePath: 'apps/api/src/routes/__synthetic_emit_regression.ts',
    });
    const restricted = results[0]!.messages.filter(
      (m) => m.ruleId === 'no-restricted-syntax',
    );
    expect(restricted.length).toBeGreaterThan(0);
  });

  it('emit.ts (blessed emit path) raw .emit() lint hatası VERMEZ (ignore)', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const code = [
      'const io = { of: (_n: string) => ({ to: (_r: string) => ({ emit: (_e: string, _p: unknown): boolean => true }) }) };',
      "io.of('/realtime').to('tenant:x').emit('orders.created', { orderId: 'x' });",
      '',
    ].join('\n');
    const results = await eslint.lintText(code, {
      filePath: 'apps/api/src/realtime/emit.ts',
    });
    const restricted = results[0]!.messages.filter(
      (m) => m.ruleId === 'no-restricted-syntax',
    );
    expect(restricted.length).toBe(0);
  });
});
