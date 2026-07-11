import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { sql, type Kysely } from 'kysely';
import {
  createPool,
  createKysely,
  createOrdersRepository,
  type DB,
} from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { todayStoreDate } from '../utils/store-date';
import { getCalendarDayWindow } from '../utils/business-day';

/**
 * Blok 7 (HAT A) — Derin denetim: TIMEZONE + İŞ-GÜNÜ bulguları (KIRMIZI).
 *
 * Bu dosyadaki testler DOĞRU beklenen davranışı assert eder; mevcut kod
 * kırmızı (fail) verir. Fix sonrası yeşile döner + regresyon paketine girer.
 * ID prefix: R7-TZ-NN (08-13 bu dosyada; 01-07 reports-tz-audit.test.ts'te).
 *
 * R7-TZ-08/09/10 — SD-T-C-01 (Blok 2 devri): `yyyyMmDd` regex
 * (`/^\d{4}-\d{2}-\d{2}$/`, packages/shared-types/src/reports.ts:45,431)
 * takvim geçerliliğini doğrulamıyor. `getDailyCloseWindow`/`explicitWindow`
 * (business-day.ts) `Date.UTC(y, m-1, d)` kullanıyor — JS Date taşan
 * ay/gün değerlerini SESSİZCE normalize ediyor, exception atmıyor.
 * Ampirik doğrulama (tsx ile business-day.ts'i doğrudan çağırarak):
 *   2026-02-30  → pencere 2026-03-01T21:00Z..2026-03-02T21:00Z (2 Mart'a kaymış)
 *   2026-13-01  → pencere 2026-12-31T21:00Z..2027-01-01T21:00Z (2027-01-01'e kaymış — YIL atlıyor)
 *   9999-99-99  → pencere +010007-06-06T21:00Z.. (yıl 10007'ye kaymış)
 *
 * R7-TZ-11 — store-date.ts `todayStoreDate()` UTC takvim günü kullanıyor;
 * ADR-015 (business-day.ts, DB trigger `populate_order_store_date`) tenant
 * TZ takvim günü kullanıyor. Europe/Istanbul = UTC+3 sabit → her gece
 * 00:00-03:00 local (UTC 21:00-24:00 önceki gün) aralığında iki hesap
 * FARKLI takvim günü verir. `GET /orders` (storeDate param verilmezse) ve
 * `POST /orders` dine-in default'u (orders.ts:949) bu fonksiyonu kullanıyor.
 *
 * R7-TZ-12/13 — bu kökün iki farklı yayılma etkisi: (a) daily-close içi
 * gelir/ödeme tutarsızlığı (orders.created_at vs payments.created_at farklı
 * pencere kaynağı), (b) order_no_counters.business_date ile orders.store_date
 * arasında sessiz ayrışma (packages/db/src/repositories/orders.ts:604 doc
 * yorumu bizzat "storeDate: caller UTC midnight hesaplar" diyor — ADR-015
 * tenant-TZ modeliyle çelişen tasarım varsayımı, kod içinde itiraf edilmiş).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TABLE_ID = randomUUID();
const TABLE_CODE = `M-TZF-${randomUUID().slice(0, 6)}`;
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-tzf-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-tzf-${randomUUID().slice(0, 8)}`;

const D = '2025-03-10';

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
      store_date: args.createdAt,
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
  },
): Promise<void> {
  await db
    .insertInto('payments')
    .values({
      id: randomUUID(),
      tenant_id: args.tenantId,
      order_id: args.orderId,
      payment_type: 'cash',
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
 * bağlı sonuç üretir (yanlış-negatif riski). SQL-side `::text` cast bunu
 * tamamen ortadan kaldırır — reports-tz-audit.test.ts ile aynı desen.
 */
async function readStoreDateText(db: Kysely<DB>, orderId: string): Promise<string> {
  const row = await db
    .selectFrom('orders')
    .select(sql<string>`store_date::text`.as('store_date_text'))
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  return row.store_date_text;
}

// ─── R7-TZ-11 — pure-function, DB/HTTP bağımsız, her zaman çalışır ─────────
describe('R7-TZ-11 [BLOCKER] — store-date.ts todayStoreDate() UTC takvimi kullanıyor, tenant TZ değil', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Istanbul local 01:00 (00:00-03:00 kayma penceresi) → todayStoreDate() tenant-TZ "bugün"den FARKLI gün döner', () => {
    // Istanbul local 2025-03-11T01:00:00+03:00 === UTC 2025-03-10T22:00:00Z.
    const frozenUtc = new Date('2025-03-10T22:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(frozenUtc);

    const actual = todayStoreDate();
    const tenantTzToday = getCalendarDayWindow('Europe/Istanbul', frozenUtc).startUtc;

    // DOĞRU DAVRANIŞ: "bugün" tanımı sistem genelinde ADR-015 (tenant TZ takvim
    // günü) ile tutarlı olmalı — todayStoreDate() de aynı günü vermeli.
    expect(actual.toISOString()).toBe(tenantTzToday.toISOString());
  });
});

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Blok 7 HAT A — reports tz/iş-günü CANLI bulgular (KIRMIZI)',
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
        .values({ id: TENANT_ID, name: 'TZ Findings Tenant', slug: `t-tzf-${TENANT_ID.slice(0, 8)}` })
        .execute();
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

    it('R7-TZ-08 [BLOCKER] SD-T-C-01: GET /reports/daily-close?date=2026-02-30 → 400 beklenir (takvim-geçersiz), route 200 döner', async () => {
      const res = await request(ctx.app!)
        .get('/reports/daily-close?date=2026-02-30')
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      // DOĞRU DAVRANIŞ: 2026 artık yıl değil, Şubat 30 diye bir gün YOK → 400.
      expect(res.status).toBe(400);
    });

    it('R7-TZ-08b [KANIT — mevcut yanlış davranış]: date=2026-02-30 şu an 200 dönüyor + pencere sessizce 2 Mart\'a kayıyor', async () => {
      const res = await request(ctx.app!)
        .get('/reports/daily-close?date=2026-02-30')
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(res.status).toBe(200);
      // Şubat 30 istenmiş ama pencere 2 Mart'ın günü — kullanıcı fark etmez,
      // Z-raporu yanlış günün verisiyle "başarılı" döner.
      expect(res.body.data.windowStart).toBe('2026-03-01T21:00:00.000Z');
      expect(res.body.data.windowEnd).toBe('2026-03-02T21:00:00.000Z');
    });

    it.each([
      ['2026-13-01', 'ay taşması → sessizce 2027-01-01\'e kayar (yıl atlıyor)'],
      ['9999-99-99', 'ay+gün taşması → sessizce yıl 10007\'ye kayar'],
    ])('R7-TZ-09 [BLOCKER]: date=%s → 400 beklenir (%s), route kabul ediyor', async (date) => {
      const res = await request(ctx.app!)
        .get(`/reports/daily-close?date=${date}`)
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(res.status).toBe(400);
    });

    it('R7-TZ-10 [BLOCKER]: GET /reports/kpi/today-revenue?range=custom&from=2026-02-30&to=2026-02-30 → 400 beklenir, route 200 döner (SD-T-C-01, 11-endpoint ReportRangeQuerySchema ailesine de sızmış)', async () => {
      const res = await request(ctx.app!)
        .get('/reports/kpi/today-revenue?range=custom&from=2026-02-30&to=2026-02-30')
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(res.status).toBe(400);
    });

    it('R7-TZ-12 [HIGH]: sipariş D 23:58 oluştu + ödeme D_NEXT 00:05 alındı → daily-close(date=D) totalRevenueCents ile paymentBreakdown/hourlyBuckets toplamı UYUŞMUYOR', async () => {
      const orderId = randomUUID();
      // Istanbul local D 23:58 == UTC D 20:58 (window[D] içinde: < 21:00).
      const orderCreatedAt = new Date('2025-03-10T20:58:00.000Z');
      // Istanbul local D_NEXT 00:05 == UTC D 21:05 (window[D] DIŞINDA: >= 21:00).
      const paymentCreatedAt = new Date('2025-03-10T21:05:00.000Z');

      try {
        await seedPaidOrder(ctx.db!, {
          tenantId: TENANT_ID,
          orderId,
          tableId: TABLE_ID,
          createdAt: orderCreatedAt,
          totalCents: 12_345,
        });
        await seedPayment(ctx.db!, {
          tenantId: TENANT_ID,
          orderId,
          createdAt: paymentCreatedAt,
          amountCents: 12_345,
        });

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

        // DOĞRU DAVRANIŞ: aynı Z-raporu içinde ciro toplamı ile ödeme/saatlik
        // dökümlerin toplamı TUTARLI olmalı — aynı ödemenin geliri raporun bir
        // bölümünde var, diğerinde YOK olmamalı.
        expect(paymentSum).toBe(data.totalRevenueCents);
        expect(hourlySum).toBe(data.totalRevenueCents);
      } finally {
        await cleanupOrder(ctx.db!, orderId);
      }
    });

    it('R7-TZ-13 [HIGH]: repo.create() caller-storeDate\'e güveniyor (order_no_counters), trigger orders.store_date\'i created_at+tenant TZ\'den BAĞIMSIZ hesaplıyor → sessizce ayrışabiliyor', async () => {
      const repo = createOrdersRepository(ctx.db!);
      const orderId = randomUUID();
      // todayStoreDate()'in 00:00-03:00 TR kayma penceresinde üreteceği YANLIŞ
      // (bugünden 1 gün geride) değeri simüle eder — created_at ise gerçek
      // now() (DB default), trigger bunu DOĞRU hesaplayacak. `Date.UTC(y,m,d)`
      // tam UTC gece yarısı üretir — bu değerin `date` kolonuna yazımı, pozitif
      // (<24h) yerel ofsette (bu makinede Europe/Istanbul +3) takvim günü
      // kaymasına uğramaz (pg parametre serileştirme notuna bkz. dosya üstü).
      const now = new Date();
      const wrongStoreDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
      );

      try {
        await repo.create(
          TENANT_ID,
          {
            id: orderId,
            tableId: TABLE_ID,
            orderType: 'dine_in',
            storeDate: wrongStoreDate,
          },
          [],
        );

        const counterRow = await ctx.db!
          .selectFrom('order_no_counters')
          .select(['business_date'])
          .where('tenant_id', '=', TENANT_ID)
          .where('business_date', '=', wrongStoreDate)
          .executeTakeFirst();
        // Kanıt: sayaç, caller'ın verdiği (yanlış) günde satır oluşturdu.
        expect(counterRow).toBeDefined();

        const orderStoreDateStr = await readStoreDateText(ctx.db!, orderId);
        const wrongStoreDateStr = wrongStoreDate.toISOString().slice(0, 10);

        // DOĞRU DAVRANIŞ: order_no günlük-reset sayaç anahtarı, siparişin GERÇEK
        // (trigger-hesaplı) store_date'iyle her zaman aynı gün olmalı (decisions.md
        // §11 "UNIQUE(tenant_id, store_date, order_no)" invaryantı) — aksi halde
        // günlük sipariş numarası yanlış günde artar / doğru günde 1'den başlamaz.
        expect(wrongStoreDateStr).toBe(orderStoreDateStr);
      } finally {
        await cleanupOrder(ctx.db!, orderId);
        await ctx.db!
          .deleteFrom('order_no_counters')
          .where('tenant_id', '=', TENANT_ID)
          .where('business_date', '=', wrongStoreDate)
          .execute();
      }
    });
  },
);
