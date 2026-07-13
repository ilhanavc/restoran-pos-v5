import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { sql, type Kysely } from 'kysely';
import {
  createPool,
  createKysely,
  type DB,
} from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Blok 7 (HAT A) — Derin denetim: TIMEZONE + İŞ-GÜNÜ doğruluğu, CANLI
 * route+DB testleri. ADR-015 Karar 2/4/5/7/10 (takvim günü tanımı,
 * `business_day_cutoff_hour` DROP — Migration 026/028).
 *
 * Kapsam:
 *   apps/api/src/utils/{business-day.ts, store-date.ts}
 *   apps/api/src/routes/reports/{daily-close,daily-close-aggregate,tz,
 *     snapshot,today-revenue,hourly-revenue}.ts
 *
 * Bu dosya YEŞİL (doğrulanan/doğru davranış). Kırmızı (bug) kanıtları:
 * reports-tz-findings.test.ts. ID prefix: R7-TZ-NN (01-07 bu dosyada).
 *
 * Belirleyicilik notu: tüm sınır testleri SABİT tarihli (2025-03-10/11)
 * geçmiş bir referans gün kullanır — gerçek "şu an" saatine bağlı DEĞİL.
 * Europe/Istanbul 2016'dan beri DST kullanmıyor (decisions.md §H3) → sabit
 * UTC+3 varsayımı testler boyunca güvenli.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TABLE_ID = randomUUID();
const TABLE_CODE = `M-TZA-${randomUUID().slice(0, 6)}`;
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-tza-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-tza-${randomUUID().slice(0, 8)}`;

// Sabit referans gün çifti (Istanbul local). D = 2025-03-10, D_NEXT = 2025-03-11.
const D = '2025-03-10';
const D_NEXT = '2025-03-11';
// Istanbul local D 23:59:59.500 == UTC D 20:59:59.500 (UTC+3 sabit, DST yok).
const TS_LAST_MS_OF_D = new Date('2025-03-10T20:59:59.500Z');
// Istanbul local D_NEXT 00:00:00.500 == UTC D 21:00:00.500.
const TS_FIRST_MS_OF_D_NEXT = new Date('2025-03-10T21:00:00.500Z');

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
}

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

/** Direkt DB insert — created_at kontrollü, trigger store_date'i hesaplar. */
async function seedPaidOrder(
  db: Kysely<DB>,
  args: {
    tenantId: string;
    orderId: string;
    tableId: string;
    createdAt: Date;
    totalCents: number;
  },
): Promise<void> {
  await db
    .insertInto('orders')
    .values({
      id: args.orderId,
      tenant_id: args.tenantId,
      table_id: args.tableId,
      customer_id: null,
      order_type: 'dine_in',
      status: 'paid',
      order_no: Math.floor(Math.random() * 1_000_000) + 1,
      total_cents: args.totalCents,
      store_date: args.createdAt, // trigger overrides bununla created_at+tenant_tz'den
      created_at: args.createdAt,
      updated_at: args.createdAt,
    })
    .execute();
}

async function seedPayment(
  db: Kysely<DB>,
  args: {
    tenantId: string;
    orderId: string;
    createdAt: Date;
    amountCents: number;
    paymentType?: 'cash' | 'card' | 'transfer';
  },
): Promise<void> {
  await db
    .insertInto('payments')
    .values({
      id: randomUUID(),
      tenant_id: args.tenantId,
      order_id: args.orderId,
      payment_type: args.paymentType ?? 'cash',
      payment_scope: 'full',
      amount_cents: args.amountCents,
      idempotency_key: randomUUID(),
      created_at: args.createdAt,
    })
    .execute();
}

async function cleanupOrder(db: Kysely<DB>, orderId: string): Promise<void> {
  await db.deleteFrom('payments').where('order_id', '=', orderId).execute();
  await db.deleteFrom('order_items').where('order_id', '=', orderId).execute();
  await db.deleteFrom('orders').where('id', '=', orderId).execute();
}

/**
 * `store_date` (DATE kolonu) `YYYY-MM-DD` metin olarak okunur — `pg`'nin
 * DATE→JS Date dönüşümü Node process'inin YEREL TZ'sini kullanır (bu makinede
 * Europe/Istanbul); `new Date(val).toISOString()` bu yüzden makine-lokaline
 * bağlı sonuç üretir. SQL-side `::text` cast bu riski tamamen ortadan kaldırır.
 */
async function readStoreDateText(db: Kysely<DB>, orderId: string): Promise<string> {
  const row = await db
    .selectFrom('orders')
    .select(sql<string>`store_date::text`.as('store_date_text'))
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  return row.store_date_text;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Blok 7 HAT A — reports tz/iş-günü CANLI doğrulama (YEŞİL)',
  () => {
    const ctx: Ctx = {};

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
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
        .values({ id: TENANT_ID, name: 'TZ Audit Tenant', slug: `t-tza-${TENANT_ID.slice(0, 8)}` })
        .execute();
      // timezone default 'Europe/Istanbul' (schema DEFAULT, cutoff kolonu YOK — Migration 026).
      await db.insertInto('tenant_settings').values({ tenant_id: TENANT_ID }).execute();

      const hash = await hashPassword(ADMIN_PASSWORD);
      await db
        .insertInto('users')
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          password_hash: hash,
          role: 'admin',
        })
        .execute();

      await db
        .insertInto('tables')
        .values({ id: TABLE_ID, tenant_id: TENANT_ID, code: TABLE_CODE, capacity: 4 })
        .execute();

      ctx.adminToken = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('payment_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await ctx.pool?.end();
    });

    it('R7-TZ-01: Istanbul local D 23:59:59.500 → daily-close(date=D) içinde, date=D_NEXT dışında + orders.store_date=D', async () => {
      const orderId = randomUUID();
      try {
        await seedPaidOrder(ctx.db!, {
          tenantId: TENANT_ID,
          orderId,
          tableId: TABLE_ID,
          createdAt: TS_LAST_MS_OF_D,
          totalCents: 5000,
        });

        const resD = await request(ctx.app!)
          .get(`/reports/daily-close?date=${D}`)
          .set('Authorization', `Bearer ${ctx.adminToken}`);
        expect(resD.status).toBe(200);
        expect(resD.body.data.orderCount).toBe(1);
        expect(resD.body.data.totalRevenueCents).toBe(5000);

        const resDNext = await request(ctx.app!)
          .get(`/reports/daily-close?date=${D_NEXT}`)
          .set('Authorization', `Bearer ${ctx.adminToken}`);
        expect(resDNext.status).toBe(200);
        expect(resDNext.body.data.orderCount).toBe(0);

        const storeDateText = await readStoreDateText(ctx.db!, orderId);
        expect(storeDateText).toBe(D);
      } finally {
        await cleanupOrder(ctx.db!, orderId);
      }
    });

    it('R7-TZ-02: Istanbul local D_NEXT 00:00:00.500 → daily-close(date=D_NEXT) içinde, date=D dışında (gece yarısı geçişi tenant TZ ile doğru)', async () => {
      const orderId = randomUUID();
      try {
        await seedPaidOrder(ctx.db!, {
          tenantId: TENANT_ID,
          orderId,
          tableId: TABLE_ID,
          createdAt: TS_FIRST_MS_OF_D_NEXT,
          totalCents: 7500,
        });

        const resDNext = await request(ctx.app!)
          .get(`/reports/daily-close?date=${D_NEXT}`)
          .set('Authorization', `Bearer ${ctx.adminToken}`);
        expect(resDNext.status).toBe(200);
        expect(resDNext.body.data.orderCount).toBe(1);
        expect(resDNext.body.data.totalRevenueCents).toBe(7500);

        const resD = await request(ctx.app!)
          .get(`/reports/daily-close?date=${D}`)
          .set('Authorization', `Bearer ${ctx.adminToken}`);
        expect(resD.status).toBe(200);
        expect(resD.body.data.orderCount).toBe(0);

        const storeDateText = await readStoreDateText(ctx.db!, orderId);
        expect(storeDateText).toBe(D_NEXT);
      } finally {
        await cleanupOrder(ctx.db!, orderId);
      }
    });

    it('R7-TZ-03: hourly-revenue range=custom tam 90 gün (from=2026-01-01&to=2026-03-31) → 200 (91 gün red testinin sınır tamamlayıcısı)', async () => {
      const res = await request(ctx.app!)
        .get('/reports/hourly-revenue?range=custom&from=2026-01-01&to=2026-03-31')
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.buckets).toHaveLength(24);
    });

    it('R7-TZ-04: hourly-revenue ters aralık (from > to) → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.app!)
        .get('/reports/hourly-revenue?range=custom&from=2025-06-10&to=2025-06-01')
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('R7-TZ-05: gelecek tarih (date=2099-12-25) daily-close → 200 + tüm alanlar sıfır (hata değil, boş gün)', async () => {
      const res = await request(ctx.app!)
        .get('/reports/daily-close?date=2099-12-25')
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.orderCount).toBe(0);
      expect(res.body.data.totalRevenueCents).toBe(0);
      expect(res.body.data.hourlyBuckets).toHaveLength(24);
      expect(res.body.data.hourlyBuckets.every((b: { revenueCents: number }) => b.revenueCents === 0)).toBe(true);
    });

    it('R7-TZ-06: hourly-revenue — Istanbul local saat 21 ödeme → buckets[21] doğru, buckets[18] (naif UTC tahmini) 0', async () => {
      const orderId = randomUUID();
      // Istanbul local D 21:30 == UTC D 18:30 (UTC+3).
      const createdAt = new Date('2025-03-10T18:30:00.000Z');
      try {
        await seedPaidOrder(ctx.db!, {
          tenantId: TENANT_ID,
          orderId,
          tableId: TABLE_ID,
          createdAt,
          totalCents: 4200,
        });
        await seedPayment(ctx.db!, { tenantId: TENANT_ID, orderId, createdAt, amountCents: 4200 });

        const res = await request(ctx.app!)
          .get(`/reports/hourly-revenue?range=custom&from=${D}&to=${D}`)
          .set('Authorization', `Bearer ${ctx.adminToken}`);
        expect(res.status).toBe(200);
        const buckets = res.body.data.buckets as Array<{ hour: number; revenueCents: number }>;
        expect(buckets[21]!.revenueCents).toBe(4200);
        expect(buckets[18]!.revenueCents).toBe(0);
        const total = buckets.reduce((s, b) => s + b.revenueCents, 0);
        expect(total).toBe(4200);
      } finally {
        await cleanupOrder(ctx.db!, orderId);
      }
    });

    it('R7-TZ-07: daily-close iç tutarlılık (sınır dışı, gün ortası) — totalRevenueCents === paymentBreakdown toplamı === hourlyBuckets toplamı', async () => {
      const orderId = randomUUID();
      // Istanbul local D 13:00 (gün ortası, sınırdan uzak) == UTC D 10:00.
      const createdAt = new Date('2025-03-10T10:00:00.000Z');
      try {
        await seedPaidOrder(ctx.db!, {
          tenantId: TENANT_ID,
          orderId,
          tableId: TABLE_ID,
          createdAt,
          totalCents: 9900,
        });
        await seedPayment(ctx.db!, { tenantId: TENANT_ID, orderId, createdAt, amountCents: 9900 });

        const res = await request(ctx.app!)
          .get(`/reports/daily-close?date=${D}`)
          .set('Authorization', `Bearer ${ctx.adminToken}`);
        expect(res.status).toBe(200);
        const data = res.body.data as {
          totalRevenueCents: number;
          paymentBreakdown: Array<{ amountCents: number }>;
          hourlyBuckets: Array<{ revenueCents: number }>;
        };
        const paymentSum = data.paymentBreakdown.reduce((s, p) => s + p.amountCents, 0);
        const hourlySum = data.hourlyBuckets.reduce((s, h) => s + h.revenueCents, 0);
        expect(data.totalRevenueCents).toBe(9900);
        expect(paymentSum).toBe(9900);
        expect(hourlySum).toBe(9900);
      } finally {
        await cleanupOrder(ctx.db!, orderId);
      }
    });
  },
);
