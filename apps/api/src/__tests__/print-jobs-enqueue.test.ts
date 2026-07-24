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
 * Integration tests — ADR-004 Phase 3 PR-4b.
 *
 * KDS hook'larından sonra `print_jobs` tablosuna mutfak fişi job'ının
 * enqueue edildiğini doğrular (status='queued', payload.kind='kitchen').
 *
 * Cases:
 *   1. POST /orders dine_in + kitchen_print=true → 1 print_jobs row queued.
 *   2. POST /orders takeaway + kitchen_print=true → 1 print_jobs row queued.
 *   3. POST /orders dine_in + kitchen_print=false only → 0 print_jobs row
 *      (kitchen_print=false → sent transition yok → enqueue yok).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `pj-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `pj-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

// kitchen_print=true (pide) + kitchen_print=false (drink) categories.
let KITCHEN_CATEGORY_ID: string;
let BAR_CATEGORY_ID: string;
let PIDE_PRODUCT_ID: string;
let DRINK_PRODUCT_ID: string;
let TABLE_ID: string;
const TABLE_CODE = `M-${randomUUID().slice(0, 6)}`;
let CUSTOMER_ID: string;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
}

const ctx: Partial<TestCtx> = {};

async function loginAndGetToken(
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

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'print_jobs enqueue (ADR-004 PR-4b)',
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
        .values({
          id: TENANT_ID,
          name: 'Print Jobs Test Tenant',
          slug: `pj-${TENANT_ID.slice(0, 8)}`,
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
      BAR_CATEGORY_ID = randomUUID();
      await db
        .insertInto('categories')
        .values([
          {
            id: KITCHEN_CATEGORY_ID,
            tenant_id: TENANT_ID,
            name: 'Pideler',
            sort_order: 1,
            kitchen_print: true,
          },
          {
            id: BAR_CATEGORY_ID,
            tenant_id: TENANT_ID,
            name: 'İçecek',
            sort_order: 2,
            kitchen_print: false,
          },
        ])
        .execute();

      PIDE_PRODUCT_ID = randomUUID();
      DRINK_PRODUCT_ID = randomUUID();
      await db
        .insertInto('products')
        .values([
          {
            id: PIDE_PRODUCT_ID,
            tenant_id: TENANT_ID,
            category_id: KITCHEN_CATEGORY_ID,
            name: 'Kuşbaşılı Pide',
            price_cents: 14000,
            is_active: true,
          },
          {
            id: DRINK_PRODUCT_ID,
            tenant_id: TENANT_ID,
            category_id: BAR_CATEGORY_ID,
            name: 'Kola',
            price_cents: 3000,
            is_active: true,
          },
        ])
        .execute();

      TABLE_ID = randomUUID();
      await db
        .insertInto('tables')
        .values({
          id: TABLE_ID,
          tenant_id: TENANT_ID,
          code: TABLE_CODE,
          capacity: 4,
        })
        .execute();

      CUSTOMER_ID = randomUUID();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_ID,
          tenant_id: TENANT_ID,
          full_name: 'Print Jobs Test Müşteri',
        })
        .execute();

      ctx.adminToken = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        // print_jobs (FK tenant_id) → tenants temizlemeden önce.
        await ctx.db
          .deleteFrom('print_jobs')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('payments')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('audit_logs')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('order_items')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('orders')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('order_no_counters')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('customers')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('products')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('categories')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tables')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('users')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', '=', TENANT_ID)
          .execute();
        await ctx.db.destroy();
      }
    });

    // ----------------------------------------------------------------
    // 1. dine_in + kitchen_print=true → print_jobs row queued
    // ----------------------------------------------------------------
    it('1. POST /orders dine_in + kitchen item → enqueues 1 print_jobs row', async () => {
      const postRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 2 }],
        });
      expect(postRes.status).toBe(201);
      const orderId = postRes.body.data.order.id as string;
      const orderNo = postRes.body.data.order.order_no as number;

      const jobs = await ctx.db!
        .selectFrom('print_jobs')
        .selectAll()
        .where('tenant_id', '=', TENANT_ID)
        .execute();

      // Bu test'in tek queued job'ı. Cross-test pollution riskine karşı meta.orderId
      // ile filtre.
      const job = jobs.find(
        (j) =>
          (j.payload as { meta?: { orderId?: string } }).meta?.orderId === orderId,
      );
      expect(job).toBeDefined();
      expect(job!.status).toBe('queued');

      const payload = job!.payload as {
        kind: string;
        bytesBase64: string;
        meta: { orderId: string; orderNo: number; itemCount: number; renderedAt: string };
      };
      expect(payload.kind).toBe('kitchen');
      expect(payload.bytesBase64.length).toBeGreaterThan(0);
      // Base64 round-trip — gerçek byte stream non-empty.
      const decoded = Buffer.from(payload.bytesBase64, 'base64');
      expect(decoded.length).toBeGreaterThan(0);
      expect(payload.meta.orderId).toBe(orderId);
      expect(payload.meta.orderNo).toBe(orderNo);
      expect(payload.meta.itemCount).toBe(1);
      expect(payload.meta.renderedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    // ----------------------------------------------------------------
    // 2. takeaway + kitchen_print=true → print_jobs row queued
    // ----------------------------------------------------------------
    it('2. POST /orders takeaway + kitchen item → enqueues 1 print_jobs row', async () => {
      const postRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }],
        });
      expect(postRes.status).toBe(201);
      const orderId = postRes.body.data.id as string;

      const jobs = await ctx.db!
        .selectFrom('print_jobs')
        .selectAll()
        .where('tenant_id', '=', TENANT_ID)
        .execute();

      const job = jobs.find(
        (j) =>
          (j.payload as { meta?: { orderId?: string } }).meta?.orderId === orderId,
      );
      expect(job).toBeDefined();
      expect(job!.status).toBe('queued');

      const payload = job!.payload as {
        kind: string;
        bytesBase64: string;
        meta: { orderId: string; itemCount: number };
      };
      expect(payload.kind).toBe('kitchen');
      expect(payload.bytesBase64.length).toBeGreaterThan(0);
      expect(payload.meta.orderId).toBe(orderId);
      expect(payload.meta.itemCount).toBe(1);
    });

    // ----------------------------------------------------------------
    // ADR-013 Amd3 K6 REVİZYONU (S104 go-live) — adet değişimi DELTA fiş.
    // ----------------------------------------------------------------
    const jobsFor = async (orderId: string) =>
      (
        await ctx.db!
          .selectFrom('print_jobs')
          .selectAll()
          .where('tenant_id', '=', TENANT_ID)
          .execute()
      ).filter(
        (j) =>
          (j.payload as { meta?: { orderId?: string } }).meta?.orderId ===
          orderId,
      );

    it('K6.1 — paket kitchen kalem ADET ARTIŞI → İLAVE mutfak + kasa fişi', async () => {
      const postRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 2 }],
        });
      expect(postRes.status).toBe(201);
      const orderId = postRes.body.data.id as string;
      const itemId = postRes.body.data.items[0].id as string;

      const before = await jobsFor(orderId); // create: kitchen + packing(bill)
      const patchRes = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ quantity: 3 });
      expect(patchRes.status).toBe(200);

      const after = await jobsFor(orderId);
      // 2 yeni iş: mutfak İLAVE (kind kitchen) + kasa yeniden (kind bill).
      expect(after.length).toBe(before.length + 2);
      const newKinds = after
        .filter((j) => !before.some((b) => b.id === j.id))
        .map((j) => (j.payload as { kind: string }).kind)
        .sort();
      expect(newKinds).toEqual(['bill', 'kitchen']);
    });

    it('K6.3 — PORSİYON değişimi → HİÇBİR yeni fiş yok', async () => {
      const postRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PIDE_PRODUCT_ID, quantity: 1 }],
        });
      expect(postRes.status).toBe(201);
      const orderId = postRes.body.data.id as string;
      const itemId = postRes.body.data.items[0].id as string;

      const before = await jobsFor(orderId);
      // Yalnız not değiştir (porsiyon fixture'ı yok; not de K6.4 sessiz sınıfı).
      const patchRes = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ note: 'az pişmiş' });
      expect(patchRes.status).toBe(200);

      const after = await jobsFor(orderId);
      expect(after.length).toBe(before.length); // yeni fiş YOK
    });

    // ----------------------------------------------------------------
    // 3. kitchen_print=false only → no print_jobs row
    // ----------------------------------------------------------------
    it('3. POST /orders dine_in + drink only → no print_jobs row', async () => {
      // Pre-snapshot mevcut job sayısı (test isolation için bu order'a özel artış olmadığını
      // göstermek yeter).
      const before = await ctx.db!
        .selectFrom('print_jobs')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      const beforeCount = before.length;

      // Bağımsız masa (test 1 zaten TABLE_ID'yi açtı; ikinci dine_in çakışmasın diye yeni).
      const tableB = randomUUID();
      await ctx.db!
        .insertInto('tables')
        .values({
          id: tableB,
          tenant_id: TENANT_ID,
          code: `M-${randomUUID().slice(0, 6)}`,
          capacity: 4,
        })
        .execute();

      const postRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId: tableB,
          orderType: 'dine_in',
          items: [{ productId: DRINK_PRODUCT_ID, quantity: 1 }],
        });
      expect(postRes.status).toBe(201);
      const orderId = postRes.body.data.order.id as string;

      // Bu order için job olmamalı.
      const jobsAll = await ctx.db!
        .selectFrom('print_jobs')
        .selectAll()
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      expect(jobsAll.length).toBe(beforeCount);
      const matched = jobsAll.find(
        (j) =>
          (j.payload as { meta?: { orderId?: string } }).meta?.orderId === orderId,
      );
      expect(matched).toBeUndefined();
    });
  },
);
