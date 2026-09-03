import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

// Rapor MANTIĞI suite'i — limiter bypass'ı import-time set edilmeli.
process.env['E2E_BYPASS_REPORTS_LIMIT'] = '1';

/**
 * ADR-015 Amendment 9 (2026-09-03) — GET /reports/channel-mix.
 *
 * A9.7 kırmızı senaryoları (bu dosya):
 *   (f) tam kova serisi  — veri yokken byHour 24 eleman + channels 3 eleman,
 *                          hepsi 0; Σ byHour.orderCount === Σ channels.orderCount
 *   (g) gün sınırı       — 23:50 açılıp 00:10 ödenen adisyon İKİ endpoint'te de
 *                          AÇILIŞ gününe düşer; byHour kovası 23
 *   (j) süreç-TZ bağımsızlığı — TZ=America/New_York altında pencere + saat kovası
 *
 * (a) invariant, (b) birleştirme, (c) reopen, (d) boş süre, (e) devir hızı,
 * (h) RBAC ve (i) CSV `reports-table-performance.test.ts`'te.
 *
 * Koşum: yalnız lokal/CI `pos_test` (DATABASE_URL yoksa skip).
 */

const DB_URL = process.env['DATABASE_URL'];
const SKIP = DB_URL === undefined || DB_URL.length === 0;
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const TZ_TENANT = 'Europe/Istanbul';
const PASSWORD = 'adminpass1234';

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  token?: string;
}

async function setupTenant(ctx: Ctx, tenantId: string): Promise<void> {
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

  const short = tenantId.slice(0, 8);
  await db
    .insertInto('tenants')
    .values({ id: tenantId, name: 'Amd9', slug: `amd9-cm-${short}` })
    .execute();
  await db
    .insertInto('tenant_settings')
    .values({ tenant_id: tenantId, timezone: TZ_TENANT })
    .execute();

  const email = `amd9cm-admin-${randomUUID().slice(0, 8)}@example.com`;
  await db
    .insertInto('users')
    .values({
      id: randomUUID(),
      tenant_id: tenantId,
      email,
      username: `amd9cm-admin-${short}`,
      password_hash: await hashPassword(PASSWORD),
      role: 'admin',
    })
    .execute();
  const res = await request(ctx.app).post('/auth/login').send({ email, password: PASSWORD });
  ctx.token = res.body.accessToken as string;
}

async function teardownTenant(ctx: Ctx, tenantId: string): Promise<void> {
  const db = ctx.db!;
  await db.deleteFrom('audit_logs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('payments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('order_no_counters').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('customers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tables').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenant_settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  await ctx.pool!.end();
}

interface SeedOrderArgs {
  tenantId: string;
  orderId: string;
  orderNo: number;
  at: Date;
  totalCents: number;
  orderType?: 'dine_in' | 'takeaway' | 'delivery';
  tableCodeSnapshot?: string | null;
  customerId?: string | null;
}

async function seedOrder(db: Kysely<DB>, a: SeedOrderArgs): Promise<void> {
  const orderType = a.orderType ?? 'dine_in';
  await db
    .insertInto('orders')
    .values({
      id: a.orderId,
      tenant_id: a.tenantId,
      table_id: null,
      table_code_snapshot: a.tableCodeSnapshot ?? null,
      customer_id: a.customerId ?? null,
      order_type: orderType,
      takeaway_stage: orderType === 'takeaway' ? 'preparing' : null,
      status: 'paid',
      order_no: a.orderNo,
      total_cents: a.totalCents,
      store_date: a.at,
      created_at: a.at,
      updated_at: a.at,
    })
    .execute();
}

async function seedPayment(
  db: Kysely<DB>,
  a: { tenantId: string; orderId: string; at: Date; amountCents: number },
): Promise<void> {
  await db
    .insertInto('payments')
    .values({
      id: randomUUID(),
      tenant_id: a.tenantId,
      order_id: a.orderId,
      payment_type: 'cash',
      payment_scope: 'full',
      amount_cents: a.amountCents,
      cash_received_cents: null,
      change_amount_cents: null,
      tip_amount_cents: null,
      voided_at: null,
      void_reason_code: null,
      created_at: a.at,
      created_by_user_id: null,
      idempotency_key: randomUUID(),
    })
    .execute();
}

interface Channel {
  orderType: string;
  orderCount: number;
  revenueCents: number;
  averageBillCents: number;
}
interface HourBucket {
  hour: number;
  channels: Array<{ orderType: string; orderCount: number; revenueCents: number }>;
}

const CHANNEL_ORDER = ['dine_in', 'takeaway', 'delivery'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// (f) tam kova serisi — veri olmayan tenant
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd9 K10 — tam kova serisi (boş tenant)', () => {
  const ctx: Ctx = {};
  const TENANT = randomUUID();

  beforeAll(async () => {
    await setupTenant(ctx, TENANT);
  });
  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  it('(f) veri yokken byHour 24 kova + channels 3 kanal, hepsi 0', async () => {
    const res = await request(ctx.app!)
      .get('/reports/channel-mix?range=last30')
      .set('Authorization', `Bearer ${ctx.token}`);
    expect(res.status).toBe(200);

    const channels = res.body.data.channels as Channel[];
    expect(channels.map((c) => c.orderType)).toEqual([...CHANNEL_ORDER]);
    for (const c of channels) {
      expect(c.orderCount).toBe(0);
      expect(c.revenueCents).toBe(0);
      expect(c.averageBillCents).toBe(0);
    }

    const byHour = res.body.data.byHour as HourBucket[];
    expect(byHour).toHaveLength(24);
    expect(byHour.map((b) => b.hour)).toEqual([...Array(24).keys()]);
    for (const bucket of byHour) {
      expect(bucket.channels.map((c) => c.orderType)).toEqual([...CHANNEL_ORDER]);
      expect(bucket.channels.every((c) => c.orderCount === 0)).toBe(true);
    }
  });

  it('(f) Σ byHour.orderCount === Σ channels.orderCount (yapısal invariant)', async () => {
    const res = await request(ctx.app!)
      .get('/reports/channel-mix?range=last30')
      .set('Authorization', `Bearer ${ctx.token}`);
    const byHour = res.body.data.byHour as HourBucket[];
    const channels = res.body.data.channels as Channel[];

    const hourTotal = byHour.reduce(
      (s, b) => s + b.channels.reduce((s2, c) => s2 + c.orderCount, 0),
      0,
    );
    const channelTotal = channels.reduce((s, c) => s + c.orderCount, 0);
    expect(hourTotal).toBe(channelTotal);
    expect(channelTotal).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Kanal + saat kovası doğruluğu
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd9 K9/K10 — kanal kırılımı ve sipariş saati kovası', () => {
  const ctx: Ctx = {};
  const TENANT = randomUUID();
  const DAY = '2026-06-25';
  const CUSTOMER_ID = randomUUID();

  beforeAll(async () => {
    await setupTenant(ctx, TENANT);
    const db = ctx.db!;
    await db
      .insertInto('customers')
      .values({ id: CUSTOMER_ID, tenant_id: TENANT, full_name: 'Test Müşteri' })
      .execute();

    // Istanbul UTC+3 → 09:00Z = 12:00 yerel (kova 12); 17:00Z = 20:00 (kova 20).
    // dine_in: 12:00 kovasında 2 adisyon (10 000 + 5 000)
    for (const [i, total] of [10_000, 5_000].entries()) {
      const id = randomUUID();
      await seedOrder(db, {
        tenantId: TENANT,
        orderId: id,
        orderNo: 9200 + i,
        at: new Date(`${DAY}T09:0${i}:00Z`),
        totalCents: total,
        tableCodeSnapshot: `Masa ${i + 1}`,
      });
      // Ödeme SAATİ kovayı DEĞİŞTİRMEZ — 20:00 yerelde tahsil edilse bile
      // sipariş 12:00 kovasında kalır (K10).
      await seedPayment(db, {
        tenantId: TENANT,
        orderId: id,
        at: new Date(`${DAY}T17:00:00Z`),
        amountCents: total,
      });
    }

    // takeaway: 20:00 kovasında 1 adisyon (3 000)
    const takeawayId = randomUUID();
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: takeawayId,
      orderNo: 9210,
      at: new Date(`${DAY}T17:00:00Z`),
      totalCents: 3_000,
      orderType: 'takeaway',
      customerId: CUSTOMER_ID,
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: takeawayId,
      at: new Date(`${DAY}T17:05:00Z`),
      amountCents: 3_000,
    });
  });

  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  const getDay = (): request.Test =>
    request(ctx.app!)
      .get(`/reports/channel-mix?range=custom&from=${DAY}&to=${DAY}`)
      .set('Authorization', `Bearer ${ctx.token}`);

  it('3 kanal sıfır-dolgulu; averageBillCents integer division', async () => {
    const res = await getDay();
    expect(res.status).toBe(200);

    const channels = res.body.data.channels as Channel[];
    expect(channels.map((c) => c.orderType)).toEqual([...CHANNEL_ORDER]);

    const dineIn = channels[0]!;
    expect(dineIn.orderCount).toBe(2);
    expect(dineIn.revenueCents).toBe(15_000);
    expect(dineIn.averageBillCents).toBe(7_500);

    expect(channels[1]!.revenueCents).toBe(3_000);
    expect(channels[1]!.averageBillCents).toBe(3_000);

    // `delivery` sıfır olsa da BASTIRILMAZ (K9 dürüst gösterim).
    expect(channels[2]!.orderType).toBe('delivery');
    expect(channels[2]!.orderCount).toBe(0);
    expect(channels[2]!.averageBillCents).toBe(0);
  });

  it('kova saati SİPARİŞ anıdır, ödeme anı DEĞİL (K10)', async () => {
    const res = await getDay();
    const byHour = res.body.data.byHour as HourBucket[];

    const noon = byHour.find((b) => b.hour === 12)!;
    expect(noon.channels.find((c) => c.orderType === 'dine_in')!.orderCount).toBe(2);
    expect(noon.channels.find((c) => c.orderType === 'dine_in')!.revenueCents).toBe(
      15_000,
    );

    // Ödemeler 20:00'de yapıldı; dine_in kovası 20'de BOŞ olmalı.
    const evening = byHour.find((b) => b.hour === 20)!;
    expect(evening.channels.find((c) => c.orderType === 'dine_in')!.orderCount).toBe(0);
    expect(evening.channels.find((c) => c.orderType === 'takeaway')!.orderCount).toBe(1);
  });

  it('Σ byHour === Σ channels (dolu veri kümesinde de)', async () => {
    const res = await getDay();
    const byHour = res.body.data.byHour as HourBucket[];
    const channels = res.body.data.channels as Channel[];

    const hourCount = byHour.reduce(
      (s, b) => s + b.channels.reduce((s2, c) => s2 + c.orderCount, 0),
      0,
    );
    const hourRevenue = byHour.reduce(
      (s, b) => s + b.channels.reduce((s2, c) => s2 + c.revenueCents, 0),
      0,
    );
    expect(hourCount).toBe(channels.reduce((s, c) => s + c.orderCount, 0));
    expect(hourRevenue).toBe(channels.reduce((s, c) => s + c.revenueCents, 0));
    expect(hourCount).toBe(3);
    expect(hourRevenue).toBe(18_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) gün sınırı — 23:50 açılıp 00:10 ödenen adisyon
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd9 — gece-yarısı sarkan adisyon açılış gününe düşer', () => {
  const ctx: Ctx = {};
  const TENANT = randomUUID();
  const ORDER_ID = randomUUID();

  const DAY_D = '2026-07-01';
  const DAY_D_PLUS_1 = '2026-07-02';
  // Istanbul UTC+3: 23:50 yerel = 20:50Z (D); 00:10 yerel = 21:10Z.
  const OPENED_AT = new Date('2026-07-01T20:50:00Z');
  const PAID_AT = new Date('2026-07-01T21:10:00Z');
  const TOTAL = 50_000;

  beforeAll(async () => {
    await setupTenant(ctx, TENANT);
    await seedOrder(ctx.db!, {
      tenantId: TENANT,
      orderId: ORDER_ID,
      orderNo: 9301,
      at: OPENED_AT,
      totalCents: TOTAL,
      tableCodeSnapshot: 'Masa 7',
    });
    await seedPayment(ctx.db!, {
      tenantId: TENANT,
      orderId: ORDER_ID,
      at: PAID_AT,
      amountCents: TOTAL,
    });
  });
  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  const get = (path: string, day: string): request.Test =>
    request(ctx.app!)
      .get(`${path}${path.includes('?') ? '&' : '?'}range=custom&from=${day}&to=${day}`)
      .set('Authorization', `Bearer ${ctx.token}`);

  it('(g) D günü: her iki endpoint de adisyonu AÇILIŞ gününe yazar; kova 23', async () => {
    const tp = await get('/reports/table-performance?limit=100', DAY_D);
    expect(tp.status).toBe(200);
    expect(tp.body.data.tables).toHaveLength(1);
    expect(tp.body.data.tables[0].tableCode).toBe('Masa 7');
    expect(tp.body.data.tables[0].revenueCents).toBe(TOTAL);
    // Süre 20 dakika — gece yarısını geçmesi hesabı bozmaz.
    expect(tp.body.data.tables[0].avgOccupancySeconds).toBe(1_200);

    const cm = await get('/reports/channel-mix', DAY_D);
    expect(cm.status).toBe(200);
    const channels = cm.body.data.channels as Channel[];
    expect(channels[0]!.revenueCents).toBe(TOTAL);

    const byHour = cm.body.data.byHour as HourBucket[];
    expect(byHour.find((b) => b.hour === 23)!.channels[0]!.orderCount).toBe(1);
    // 00:10 ÖDEME anıdır; kova 0 boş kalmalı.
    expect(byHour.find((b) => b.hour === 0)!.channels[0]!.orderCount).toBe(0);
  });

  it('(g) D+1 günü: hiçbir endpoint bu adisyonu ikinci kez saymaz', async () => {
    const tp = await get('/reports/table-performance?limit=100', DAY_D_PLUS_1);
    expect(tp.body.data.tables).toEqual([]);
    expect(tp.body.data.activeDayCount).toBe(0);

    const cm = await get('/reports/channel-mix', DAY_D_PLUS_1);
    const channels = cm.body.data.channels as Channel[];
    expect(channels.every((c) => c.orderCount === 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (j) süreç-TZ bağımsızlığı
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd9 — TZ=America/New_York süreç TZ\'si pencereyi kaydırmaz', () => {
  const ctx: Ctx = {};
  const TENANT = randomUUID();
  const ORDER_ID = randomUUID();

  const DAY_D = '2026-07-01';
  const DAY_D_PLUS_1 = '2026-07-02';
  // 02:00Z → Istanbul 05:00 (2 Tem), New York 22:00 (1 Tem).
  const ORDER_AT = new Date('2026-07-02T02:00:00Z');
  const TOTAL = 12_345;

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
    await setupTenant(ctx, TENANT);
    await seedOrder(ctx.db!, {
      tenantId: TENANT,
      orderId: ORDER_ID,
      orderNo: 9401,
      at: ORDER_AT,
      totalCents: TOTAL,
      tableCodeSnapshot: 'Masa 8',
    });
    await seedPayment(ctx.db!, {
      tenantId: TENANT,
      orderId: ORDER_ID,
      at: new Date(ORDER_AT.getTime() + 15 * 60_000),
      amountCents: TOTAL,
    });
  });
  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  it('(j) pencere ve saat kovası TENANT takvimine göre; süreç TZ\'si etkisiz', async () => {
    await withNewYorkTz(async () => {
      const cmD = await request(ctx.app!)
        .get(`/reports/channel-mix?range=custom&from=${DAY_D}&to=${DAY_D}`)
        .set('Authorization', `Bearer ${ctx.token}`);
      expect(cmD.status).toBe(200);
      expect((cmD.body.data.channels as Channel[])[0]!.orderCount).toBe(0);

      const cmD1 = await request(ctx.app!)
        .get(`/reports/channel-mix?range=custom&from=${DAY_D_PLUS_1}&to=${DAY_D_PLUS_1}`)
        .set('Authorization', `Bearer ${ctx.token}`);
      expect((cmD1.body.data.channels as Channel[])[0]!.revenueCents).toBe(TOTAL);
      // Istanbul 05:00 → kova 5 (New York 22:00 olsaydı kova 22 çıkardı).
      const byHour = cmD1.body.data.byHour as HourBucket[];
      expect(byHour.find((b) => b.hour === 5)!.channels[0]!.orderCount).toBe(1);
      expect(byHour.find((b) => b.hour === 22)!.channels[0]!.orderCount).toBe(0);

      const tp = await request(ctx.app!)
        .get(
          `/reports/table-performance?range=custom&from=${DAY_D_PLUS_1}&to=${DAY_D_PLUS_1}&limit=100`,
        )
        .set('Authorization', `Bearer ${ctx.token}`);
      expect(tp.body.data.tables).toHaveLength(1);
      expect(tp.body.data.tables[0].revenueCents).toBe(TOTAL);
      expect(tp.body.data.tables[0].avgOccupancySeconds).toBe(900);
    });
  });
});
