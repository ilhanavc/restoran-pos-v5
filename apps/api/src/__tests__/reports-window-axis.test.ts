import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import { sql, type Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { resolveRangeWindow, storeDateBound } from '../utils/business-day';

// Bu suite rapor MANTIĞINI test eder, limiter'ı değil (reports-rate-limit.test
// kendini savunarak bypass'ı kapatır). buildApp limiter'ı construction'da
// yakaladığı için env import-time set edilir.
process.env['E2E_BYPASS_REPORTS_LIMIT'] = '1';

/**
 * ADR-015 Amendment 7 (R11-TZ-01 + R11-TZ-02) — rapor gün-penceresi TEK EKSEN.
 *
 * K16(a) — cross-endpoint invariant: 23:50'de açılan / 00:10'da ödenen adisyon
 *   `today-revenue`, `payment-distribution`, `hourly-revenue`, `closed-orders`
 *   ve `user-performance`'ın HEPSİNDE aynı iş-gününe (D) yazar. Amd7 öncesi
 *   sipariş-eksenli raporlar D'yi, ödeme-eksenli raporlar D+1'i gösteriyordu.
 *
 * K16(b) — `anomalies` özet↔detay tek kaynak: D'de açılıp D+1'de iptal edilen
 *   sipariş özette de detayda da D gününde ve AYNI sayıda görünür. Amd7 öncesi
 *   özet `o.created_at` (D), detay `al.created_at` (D+1) okuyordu → "5 iptal
 *   var" deyip 4 satır listeleme sınıfı.
 *
 * K16(c) — `::date` bağlama kanıtı: süreç TZ'si `America/New_York` iken bile
 *   pencere tenant TZ'sinin takvim gününü verir ve PG'ye aynı tarih ulaşır.
 *   JS `Date` bağlansaydı node-postgres süreç-TZ'siyle serialize eder, UTC
 *   batısındaki bir host D-1 okurdu.
 *
 * Koşum: yalnız lokal/CI pos_test (DATABASE_URL yoksa skip).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const TZ_TENANT = 'Europe/Istanbul';

// Sabit geçmiş iş-günü D — koşum anından bağımsız determinizm.
// Istanbul yazın UTC+3: 23:50 yerel = 20:50Z (D), 00:10 yerel = 21:10Z (D+1).
const DAY_D = '2026-07-01';
const DAY_D_PLUS_1 = '2026-07-02';
const ORDER_AT_2350_LOCAL = new Date('2026-07-01T20:50:00Z');
const PAYMENT_AT_0010_NEXT_LOCAL = new Date('2026-07-01T21:10:00Z');

const ORDER_TOTAL = 50_000; // 500 TL

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
}

async function login(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

/**
 * İzole tenant + admin kullanıcı kurar. Her describe kendi tenant'ını kullanır
 * ki toplam/sayım assertion'ları başka suite'lerin verisinden etkilenmesin.
 */
async function setupTenant(
  ctx: Ctx,
  tenantId: string,
  adminId: string,
  email: string,
  password: string,
): Promise<void> {
  const pool = createPool({ connectionString: DB_URL! });
  const db = createKysely(pool);
  ctx.pool = pool;
  ctx.db = db;
  ctx.app = buildApp({
    pool,
    db,
    accessSecret: ACCESS_SECRET,
    agentSecret: 'test-agent-secret-min-32-chars-please-long',
    tenantId,
    webOrigin: 'http://localhost:5173',
  });

  await db
    .insertInto('tenants')
    .values({ id: tenantId, name: 'Amd7', slug: `amd7-${tenantId.slice(0, 8)}` })
    .execute();
  await db
    .insertInto('tenant_settings')
    .values({ tenant_id: tenantId, timezone: TZ_TENANT })
    .execute();
  await db
    .insertInto('users')
    .values({
      id: adminId,
      tenant_id: tenantId,
      email,
      username: `amd7-admin-${tenantId.slice(0, 8)}`,
      password_hash: await hashPassword(password),
      role: 'admin',
    })
    .execute();

  ctx.adminToken = await login(ctx.app, email, password);
}

async function teardownTenant(ctx: Ctx, tenantId: string): Promise<void> {
  const db = ctx.db!;
  await db.deleteFrom('audit_logs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('payments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
  await db
    .deleteFrom('order_no_counters')
    .where('tenant_id', '=', tenantId)
    .execute();
  await db.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
  await db
    .deleteFrom('tenant_settings')
    .where('tenant_id', '=', tenantId)
    .execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  await ctx.pool!.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// K16(a) — cross-endpoint invariant
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-015 Amd7 K16(a) — gece-yarısı-sarkan adisyon: 5 endpoint aynı iş-gününü raporlar',
  () => {
    const ctx: Ctx = {};
    const TENANT = randomUUID();
    const ADMIN_ID = randomUUID();
    const ADMIN_EMAIL = `amd7-a-${randomUUID().slice(0, 8)}@example.com`;
    const ADMIN_PASSWORD = 'adminpass1234';
    const ORDER_ID = randomUUID();

    beforeAll(async () => {
      await setupTenant(ctx, TENANT, ADMIN_ID, ADMIN_EMAIL, ADMIN_PASSWORD);

      // created_at explicit INSERT — trigger store_date'i ondan hesaplar
      // (append-only guard UPDATE'i engeller, INSERT serbest).
      await ctx.db!
        .insertInto('orders')
        .values({
          id: ORDER_ID,
          tenant_id: TENANT,
          table_id: null,
          customer_id: null,
          order_type: 'dine_in',
          status: 'paid',
          order_no: 7001,
          total_cents: ORDER_TOTAL,
          store_date: ORDER_AT_2350_LOCAL, // trigger override eder; NOT NULL
          created_at: ORDER_AT_2350_LOCAL,
          updated_at: PAYMENT_AT_0010_NEXT_LOCAL,
          waiter_user_id: ADMIN_ID,
        })
        .execute();
      await ctx.db!
        .insertInto('payments')
        .values({
          id: randomUUID(),
          tenant_id: TENANT,
          order_id: ORDER_ID,
          payment_type: 'cash',
          payment_scope: 'full',
          amount_cents: ORDER_TOTAL,
          cash_received_cents: ORDER_TOTAL,
          change_amount_cents: 0,
          created_at: PAYMENT_AT_0010_NEXT_LOCAL,
          created_by_user_id: ADMIN_ID,
          idempotency_key: randomUUID(),
        })
        .execute();
    });

    afterAll(async () => {
      await teardownTenant(ctx, TENANT);
    });

    const get = (path: string, day: string): request.Test =>
      request(ctx.app!)
        .get(`${path}${path.includes('?') ? '&' : '?'}range=custom&from=${day}&to=${day}`)
        .set('Authorization', `Bearer ${ctx.adminToken}`);

    it('D gününde: sipariş-eksenli ve ödeme-eksenli 5 rapor da parayı D gününe yazar', async () => {
      const revenue = await get('/reports/kpi/today-revenue', DAY_D);
      expect(revenue.status).toBe(200);
      expect(revenue.body.data.totalRevenueCents).toBe(ORDER_TOTAL);

      // Amd7 öncesi: 0 (ödeme D+1 penceresindeydi).
      const dist = await get('/reports/payment-distribution', DAY_D);
      expect(dist.status).toBe(200);
      expect(dist.body.data.totalCents).toBe(ORDER_TOTAL);

      // Amd7 öncesi: tüm kovalar 0. K9: kova saati hâlâ p.created_at → 00:10
      // ödemesi D gününün hour=0 kovasında.
      const hourly = await get('/reports/hourly-revenue', DAY_D);
      expect(hourly.status).toBe(200);
      const buckets = hourly.body.data.buckets as Array<{
        hour: number;
        revenueCents: number;
      }>;
      expect(buckets.reduce((s, b) => s + b.revenueCents, 0)).toBe(ORDER_TOTAL);
      expect(buckets.find((b) => b.hour === 0)?.revenueCents).toBe(ORDER_TOTAL);

      // Amd7 öncesi: 0 kayıt (pencere MAX(payments.created_at) üzerindeydi).
      const closed = await get('/reports/closed-orders', DAY_D);
      expect(closed.status).toBe(200);
      expect(closed.body.data.totalClosedCount).toBe(1);
      expect(closed.body.data.orders[0].orderId).toBe(ORDER_ID);
      // K8 — paidAt gerçek kapanış anını göstermeye devam eder (D+1 saati).
      expect(closed.body.data.orders[0].paidAt).toBe(
        PAYMENT_AT_0010_NEXT_LOCAL.toISOString(),
      );

      // Tek endpoint içi tutarlılık: garson satırı D'den, kasiyer satırı
      // Amd7 öncesi D+1'den geliyordu (aynı para iki ayrı günde).
      const perf = await get('/reports/user-performance', DAY_D);
      expect(perf.status).toBe(200);
      const users = perf.body.data.users as Array<{
        role: string;
        revenueCents: number;
      }>;
      expect(users.find((u) => u.role === 'waiter')?.revenueCents).toBe(
        ORDER_TOTAL,
      );
      expect(users.find((u) => u.role === 'cashier')?.revenueCents).toBe(
        ORDER_TOTAL,
      );
    });

    it('D+1 gününde: hiçbir rapor bu parayı ikinci kez saymaz', async () => {
      const dist = await get('/reports/payment-distribution', DAY_D_PLUS_1);
      expect(dist.body.data.totalCents).toBe(0);

      const hourly = await get('/reports/hourly-revenue', DAY_D_PLUS_1);
      const buckets = hourly.body.data.buckets as Array<{ revenueCents: number }>;
      expect(buckets.reduce((s, b) => s + b.revenueCents, 0)).toBe(0);

      const closed = await get('/reports/closed-orders', DAY_D_PLUS_1);
      expect(closed.body.data.totalClosedCount).toBe(0);

      const perf = await get('/reports/user-performance', DAY_D_PLUS_1);
      expect(perf.body.data.users).toHaveLength(0);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// K16(b) — anomalies özet ↔ detay tek kaynak
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-015 Amd7 K16(b) — anomalies: D\'de açılıp D+1\'de iptal edilen sipariş özet=detay',
  () => {
    const ctx: Ctx = {};
    const TENANT = randomUUID();
    const ADMIN_ID = randomUUID();
    const ADMIN_EMAIL = `amd7-b-${randomUUID().slice(0, 8)}@example.com`;
    const ADMIN_PASSWORD = 'adminpass1234';
    const ORDER_ID = randomUUID();
    const ITEM_TOTAL = 4200;

    beforeAll(async () => {
      await setupTenant(ctx, TENANT, ADMIN_ID, ADMIN_EMAIL, ADMIN_PASSWORD);

      await ctx.db!
        .insertInto('orders')
        .values({
          id: ORDER_ID,
          tenant_id: TENANT,
          table_id: null,
          customer_id: null,
          order_type: 'dine_in',
          status: 'cancelled',
          order_no: 7101,
          total_cents: 0,
          store_date: ORDER_AT_2350_LOCAL,
          created_at: ORDER_AT_2350_LOCAL,
          updated_at: PAYMENT_AT_0010_NEXT_LOCAL,
        })
        .execute();
      await ctx.db!
        .insertInto('order_items')
        .values({
          id: randomUUID(),
          tenant_id: TENANT,
          order_id: ORDER_ID,
          product_id: null,
          product_name: 'Test Item',
          category_name_snapshot: 'Test Cat',
          unit_price_cents: ITEM_TOTAL,
          quantity: 1,
          total_cents: ITEM_TOTAL,
          status: 'cancelled',
          created_at: ORDER_AT_2350_LOCAL,
          updated_at: PAYMENT_AT_0010_NEXT_LOCAL,
        })
        .execute();
      // İptal olayı ERTESİ yerel günde (00:10) — Amd7 öncesi detay D+1'e
      // düşerken özet D'de kalıyordu.
      await ctx.db!
        .insertInto('audit_logs')
        .values({
          id: randomUUID(),
          tenant_id: TENANT,
          event_type: 'order.cancelled',
          entity_type: 'order',
          entity_id: ORDER_ID,
          actor_user_id: ADMIN_ID,
          actor: JSON.stringify({}),
          payload: JSON.stringify({ order_id: ORDER_ID, reason: 'amd7' }),
          created_at: PAYMENT_AT_0010_NEXT_LOCAL,
        })
        .execute();
    });

    afterAll(async () => {
      await teardownTenant(ctx, TENANT);
    });

    const anomalies = (day: string): request.Test =>
      request(ctx.app!)
        .get(`/reports/anomalies?range=custom&from=${day}&to=${day}`)
        .set('Authorization', `Bearer ${ctx.adminToken}`);

    it('D gününde: cancelCount = cancel detay satır sayısı (yapısal invariant)', async () => {
      const res = await anomalies(DAY_D);
      expect(res.status).toBe(200);

      const details = res.body.data.details as Array<{
        type: string;
        orderId: string;
        amountCents: number;
        occurredAt: string;
      }>;
      const cancelDetails = details.filter((d) => d.type === 'cancel');

      // Amd7 öncesi: summary.cancelCount=1 ama cancelDetails.length=0.
      expect(res.body.data.summary.cancelCount).toBe(1);
      expect(cancelDetails).toHaveLength(1);
      expect(cancelDetails).toHaveLength(res.body.data.summary.cancelCount);
      expect(cancelDetails[0]!.orderId).toBe(ORDER_ID);
      expect(cancelDetails[0]!.amountCents).toBe(ITEM_TOTAL);
      expect(res.body.data.summary.totalLossCents).toBe(ITEM_TOTAL);
      // K7 — occurredAt gerçek olay anı kalır; pencere dışına düşebilir.
      expect(cancelDetails[0]!.occurredAt).toBe(
        PAYMENT_AT_0010_NEXT_LOCAL.toISOString(),
      );
    });

    it('D+1 gününde: ne özet ne detay — kayıt tek güne aittir', async () => {
      const res = await anomalies(DAY_D_PLUS_1);
      expect(res.status).toBe(200);
      expect(res.body.data.summary.cancelCount).toBe(0);
      expect(res.body.data.details).toHaveLength(0);
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// K16(c) — `::date` bağlama, süreç TZ'sinden bağımsız
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  "ADR-015 Amd7 K16(c) — TZ=America/New_York süreç TZ'si pencereyi kaydırmaz",
  () => {
    const ctx: Ctx = {};
    const TENANT = randomUUID();
    const ADMIN_ID = randomUUID();
    const ADMIN_EMAIL = `amd7-c-${randomUUID().slice(0, 8)}@example.com`;
    const ADMIN_PASSWORD = 'adminpass1234';
    const ORDER_ID = randomUUID();
    // 2026-07-02T02:00Z: Istanbul'da 05:00 (2 Tem) → store_date=2026-07-02.
    // New York'ta 22:00 (1 Tem) → süreç-TZ sızıntısı D-1 okurdu.
    const ORDER_AT = new Date('2026-07-02T02:00:00Z');

    /** Testi süreç TZ'si `America/New_York` altında koşar, sonra geri alır. */
    async function withNewYorkTz(fn: () => Promise<void>): Promise<void> {
      const prev = process.env['TZ'];
      process.env['TZ'] = 'America/New_York';
      try {
        await fn();
      } finally {
        if (prev === undefined) delete process.env['TZ'];
        else process.env['TZ'] = prev;
      }
    }

    beforeAll(async () => {
      await setupTenant(ctx, TENANT, ADMIN_ID, ADMIN_EMAIL, ADMIN_PASSWORD);
      await ctx.db!
        .insertInto('orders')
        .values({
          id: ORDER_ID,
          tenant_id: TENANT,
          table_id: null,
          customer_id: null,
          order_type: 'dine_in',
          status: 'paid',
          order_no: 7201,
          total_cents: ORDER_TOTAL,
          store_date: ORDER_AT,
          created_at: ORDER_AT,
          updated_at: ORDER_AT,
        })
        .execute();
    });

    afterAll(async () => {
      await teardownTenant(ctx, TENANT);
    });

    it('resolveRangeWindow tenant takvim gününü verir (süreç günü DEĞİL)', async () => {
      await withNewYorkTz(async () => {
        // Süreç TZ'sinde bu an 1 Temmuz 22:00; tenant TZ'sinde 2 Temmuz 05:00.
        const w = resolveRangeWindow({
          range: 'today',
          tz: TZ_TENANT,
          now: ORDER_AT,
        });
        expect(w.startDate).toBe(DAY_D_PLUS_1);
        expect(w.endDate).toBe(DAY_D_PLUS_1);
        // last7 sol kenarı da aynı eksende kayar (Y/M/D aritmetiği).
        const w7 = resolveRangeWindow({
          range: 'last7',
          tz: TZ_TENANT,
          now: ORDER_AT,
        });
        expect(w7.startDate).toBe('2026-06-26');
        expect(w7.endDate).toBe(DAY_D_PLUS_1);
        await Promise.resolve();
      });
    });

    it('storeDateBound PG\'ye tarihi kaydırmadan ulaştırır (`::date` cast)', async () => {
      await withNewYorkTz(async () => {
        const res = await sql<{ d: string }>`
          SELECT to_char(${storeDateBound(DAY_D_PLUS_1)}, 'YYYY-MM-DD') AS d
        `.execute(ctx.db!);
        expect(res.rows[0]!.d).toBe(DAY_D_PLUS_1);
      });
    });

    it('uçtan uca: D+1 sorgusu siparişi bulur, D sorgusu bulmaz', async () => {
      await withNewYorkTz(async () => {
        const hit = await request(ctx.app!)
          .get(
            `/reports/kpi/today-revenue?range=custom&from=${DAY_D_PLUS_1}&to=${DAY_D_PLUS_1}`,
          )
          .set('Authorization', `Bearer ${ctx.adminToken}`);
        expect(hit.status).toBe(200);
        expect(hit.body.data.totalRevenueCents).toBe(ORDER_TOTAL);

        const miss = await request(ctx.app!)
          .get(`/reports/kpi/today-revenue?range=custom&from=${DAY_D}&to=${DAY_D}`)
          .set('Authorization', `Bearer ${ctx.adminToken}`);
        expect(miss.status).toBe(200);
        expect(miss.body.data.totalRevenueCents).toBe(0);
      });
    });
  },
);
