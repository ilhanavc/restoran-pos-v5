import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import type { Server as IoServer } from 'socket.io';
import { KitchenOrderSentPayloadSchema } from '@restoran-pos/shared-types';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { signAccessToken } from '../auth/jwt.js';
import { createRealtimeServer, type RealtimeServer } from '../realtime/server.js';

/**
 * Deep-audit Blok 4 Hat C — KASITLI KIRMIZI. Blok 2 SD-T-B-01 kök-çözüm
 * denetimi: `apps/api/src/routes/orders.ts` içindeki 3 `kitchen.orderSent`
 * DOĞRUDAN emit'i (satır ~595, ~1009, ~1143) `realtime/emit.ts` helper'ını
 * (zod parse) BYPASS eder. ESLint `no-restricted-syntax` guard'ı da bu
 * paterni YAKALAMAZ — kanıt (statik, bu dosyanın dışında koşuldu):
 *
 *   $ npx eslint apps/api/src/routes/orders.ts   → exit 0, 0 hata
 *
 * Kök neden: eslint.config.js:132-140 selector'ı yalnız 2-seviye zincir
 * `X.of(ns).emit(...)`'i yakalıyor; gerçek kod paterni 3-seviye zincir
 * `X.of(ns).to(room).emit(...)` — selector'ın AST şekli hiç eşleşmiyor.
 * (Bu dosyadaki testler payload SÖZLEŞME ihlalini CANLI kanıtlar; lint
 * selector kanıtı raporda ayrıca belgelenmiştir.)
 *
 * Sonuç: 3 emit sitesi de `KitchenOrderSentPayloadSchema`'ya UYMUYOR —
 * `tableId` alanı YOK + `items[].qty` yerine `items[].quantity` yazılıyor.
 * Bu testler BUGÜN KIRMIZI (gerçek üretilen payload zod parse'ı geçemiyor).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `emit-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `emit-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const KITCHEN_USER_ID = randomUUID();

let KITCHEN_CATEGORY_ID: string;
let PIDE_PRODUCT_ID: string;
let CUSTOMER_ID: string;

interface MockIo {
  io: IoServer;
  emitSpy: ReturnType<typeof vi.fn>;
}
function createMockIo(): MockIo {
  const emitSpy = vi.fn();
  const toMock = vi.fn().mockReturnValue({ emit: emitSpy });
  const ofMock = vi.fn().mockReturnValue({ to: toMock });
  return { io: { of: ofMock } as unknown as IoServer, emitSpy };
}
function findEmit(mockIo: MockIo, event: string): unknown {
  const call = mockIo.emitSpy.mock.calls.find((c) => c[0] === event);
  return call?.[1];
}

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
}
const ctx: Partial<TestCtx> = {};
let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 254) + 1}`;
}

async function insertTable(db: Kysely<DB>): Promise<string> {
  const id = randomUUID();
  await db
    .insertInto('tables')
    .values({ id, tenant_id: TENANT_ID, code: `E-${randomUUID().slice(0, 6)}`, capacity: 4 })
    .execute();
  return id;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'BULGU API-RT-01/02/03 — kitchen.orderSent payload sözleşme ihlali (Blok 4 Hat C / Blok 2 SD-T-B-01)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;

      await db
        .insertInto('tenants')
        .values({ id: TENANT_ID, name: 'Emit Contract Tenant', slug: `emit-${TENANT_ID.slice(0, 8)}` })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
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

      KITCHEN_CATEGORY_ID = randomUUID();
      await db
        .insertInto('categories')
        .values({ id: KITCHEN_CATEGORY_ID, tenant_id: TENANT_ID, name: 'Pideler', sort_order: 1, kitchen_print: true })
        .execute();

      PIDE_PRODUCT_ID = randomUUID();
      await db
        .insertInto('products')
        .values({
          id: PIDE_PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: KITCHEN_CATEGORY_ID,
          name: 'Kaşarlı Pide',
          price_cents: 12000,
          is_active: true,
        })
        .execute();

      CUSTOMER_ID = randomUUID();
      await db
        .insertInto('customers')
        .values({ id: CUSTOMER_ID, tenant_id: TENANT_ID, full_name: 'Emit Contract Müşteri' })
        .execute();
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    it('API-RT-01 [BLOCKER] [SEC/BUG] gerçek socket round-trip: dine-in POST /orders → kitchen.orderSent GERÇEK payload zod parse\'ı GEÇEMİYOR (tableId eksik + qty≠quantity)', async () => {
      // TAM E2E: gerçek httpServer + Socket.IO server + gerçek buildApp(io:...) +
      // gerçek 'kitchen' rollü socket client. Mock YOK — telin üzerinden geçen
      // GERÇEK byte'lar doğrulanıyor.
      const httpServer: HttpServer = createServer();
      const realtime: RealtimeServer = createRealtimeServer({
        httpServer,
        accessSecret: ACCESS_SECRET,
        webOrigin: 'http://localhost:5173',
      });
      const app = buildApp({
        pool: ctx.pool!,
        db: ctx.db!,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
        io: realtime.io,
      });
      httpServer.on('request', app);
      await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
      const port = (httpServer.address() as AddressInfo).port;

      const kitchenToken = signAccessToken(
        { sub: KITCHEN_USER_ID, tenant_id: TENANT_ID, role: 'kitchen' },
        ACCESS_SECRET,
      );

      const client: ClientSocket = ioClient(`http://127.0.0.1:${port}/realtime`, {
        auth: { token: kitchenToken },
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });

      try {
        await new Promise<void>((resolve, reject) => {
          client.once('connect', () => resolve());
          client.once('connect_error', reject);
        });
        // Handshake sonrası room join'in oturması için kısa settle (S86
        // regresyon deseniyle tutarlı — realtime.test.ts caller-station bloğu).
        await new Promise((r) => setTimeout(r, 50));

        const receivedPayload = new Promise<unknown>((resolve) => {
          client.once('kitchen.orderSent', (p) => resolve(p));
        });

        const login = await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', uniqueIp())
          .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
        const adminToken = login.body.accessToken as string;
        const tableId = await insertTable(ctx.db!);

        const orderRes = await request(app)
          .post('/orders')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            tableId,
            orderType: 'dine_in',
            items: [{ productId: PIDE_PRODUCT_ID, quantity: 2 }],
          });
        expect(orderRes.status).toBe(201);

        const payload = await receivedPayload;

        // DOĞRU davranış: gerçek telden geçen payload şemaya UYMALI.
        // BUGÜN KIRMIZI: `tableId` YOK + `items[].qty` yerine `quantity` var
        // → safeParse başarısız.
        const parsed = KitchenOrderSentPayloadSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
      } finally {
        client.disconnect();
        await realtime.shutdown();
        await new Promise<void>((res) => httpServer.close(() => res()));
      }
    });

    it('API-RT-02 [BLOCKER] [SEC/BUG] takeaway POST /orders → kitchen.orderSent (satır ~595) aynı sözleşme ihlali (mock-io, hızlı doğrulama)', async () => {
      const mockIo = createMockIo();
      const app = buildApp({
        pool: ctx.pool!,
        db: ctx.db!,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
        io: mockIo.io,
      });
      const login = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', uniqueIp())
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      const adminToken = login.body.accessToken as string;

      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }],
        });
      expect(res.status).toBe(201);

      const payload = findEmit(mockIo, 'kitchen.orderSent');
      expect(payload).toBeDefined();
      const parsed = KitchenOrderSentPayloadSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });

    it('API-RT-03 [BLOCKER] [SEC/BUG] POST /orders/:id/items (add-items, satır ~1143) aynı sözleşme ihlali (mock-io, hızlı doğrulama)', async () => {
      const mockIo = createMockIo();
      const app = buildApp({
        pool: ctx.pool!,
        db: ctx.db!,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
        io: mockIo.io,
      });
      const login = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', uniqueIp())
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      const adminToken = login.body.accessToken as string;
      const tableId = await insertTable(ctx.db!);

      // İlk sipariş bar-only (kitchen_print=false kategori yok burada — basitçe
      // KDS'siz bir ilk kalem yerine doğrudan boş bırakmak yerine, add-items'ın
      // kendisini test etmek için minimal bir dine-in açıp sonra kitchen kalemi
      // ekliyoruz).
      const openRes = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tableId, orderType: 'dine_in', items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }] });
      expect(openRes.status).toBe(201);
      const orderId = openRes.body.data.order.id as string;
      mockIo.emitSpy.mockClear();

      const addRes = await request(app)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }] });
      expect(addRes.status).toBe(200);

      const payload = findEmit(mockIo, 'kitchen.orderSent');
      expect(payload).toBeDefined();
      const parsed = KitchenOrderSentPayloadSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
    });
  },
);
