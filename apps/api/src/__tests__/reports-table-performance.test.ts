import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

// Rapor MANTIĞI suite'i — limiter bypass'ı import-time set edilmeli
// (buildApp limiter'ı construction'da yakalar). 429 davranışı ayrı suite'te.
process.env['E2E_BYPASS_REPORTS_LIMIT'] = '1';

/**
 * ADR-015 Amendment 9 (2026-09-03) — GET /reports/table-performance.
 *
 * A9.7 kırmızı senaryoları (bu dosya):
 *   (a) cross-report invariant — channel-mix dine_in cirosu
 *                                == Σ tables[].revenueCents + unassignedRevenueCents
 *   (b) birleştirme            — kaynak HİÇBİR satırda yok; hedef ciroya girer,
 *                                süre örneklemine GİRMEZ, durationExcludedCount artar
 *   (c) reopen                 — öde → void → yeniden öde: süre SON ödemeye göre,
 *                                adisyon TEK kez sayılır
 *   (d) boş süre dürüstlüğü    — tüm adisyonları dışlanan masada
 *                                avgOccupancySeconds === null (0 DEĞİL)
 *   (e) devir hızı             — 3 aktif gün + 6 adisyon → turnsPerThousand === 2000
 *   (h) RBAC                   — admin/cashier 200, waiter/kitchen 403
 *   (i) CSV                    — admin 200 + kilitli başlık, cashier 403, boş süre `''`
 *
 * (g) gün sınırı ve (j) süreç-TZ bağımsızlığı `reports-channel-mix.test.ts`'te
 * İKİ endpoint birlikte doğrulanır (tek seed, iki iddia).
 *
 * Koşum: yalnız lokal/CI `pos_test` (DATABASE_URL yoksa skip). Her describe
 * KENDİ tenant'ını kurar — toplamlar başka suite'lerden etkilenmez.
 */

const DB_URL = process.env['DATABASE_URL'];
const SKIP = DB_URL === undefined || DB_URL.length === 0;
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const TZ_TENANT = 'Europe/Istanbul';
const PASSWORD = 'adminpass1234';

type Role = 'admin' | 'cashier' | 'waiter' | 'kitchen';

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  tokens: Partial<Record<Role, string>>;
}

function newCtx(): Ctx {
  return { tokens: {} };
}

async function login(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

async function setupTenant(
  ctx: Ctx,
  tenantId: string,
  roles: readonly Role[],
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

  const short = tenantId.slice(0, 8);
  await db
    .insertInto('tenants')
    .values({ id: tenantId, name: 'Amd9', slug: `amd9-tp-${short}` })
    .execute();
  await db
    .insertInto('tenant_settings')
    .values({ tenant_id: tenantId, timezone: TZ_TENANT })
    .execute();

  for (const role of roles) {
    const email = `amd9tp-${role}-${randomUUID().slice(0, 8)}@example.com`;
    await db
      .insertInto('users')
      .values({
        id: randomUUID(),
        tenant_id: tenantId,
        email,
        username: `amd9tp-${role}-${short}`,
        password_hash: await hashPassword(PASSWORD),
        role,
      })
      .execute();
    ctx.tokens[role] = await login(ctx.app, email, PASSWORD);
  }
}

/** FK zincirine göre sıralı temizlik — yalnız BU tenant'ın satırları. */
async function teardownTenant(ctx: Ctx, tenantId: string): Promise<void> {
  const db = ctx.db!;
  await db.deleteFrom('audit_logs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('payments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
  // Birleştirme kaynağı hedefe FK ile bağlı — önce bağı kopar, sonra sil.
  await db
    .updateTable('orders')
    .set({ merged_into_order_id: null })
    .where('tenant_id', '=', tenantId)
    .execute();
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
  status?: 'paid' | 'open' | 'cancelled' | 'merged';
  tableId?: string | null;
  tableCodeSnapshot?: string | null;
  areaNameSnapshot?: string | null;
  mergedIntoOrderId?: string | null;
  customerId?: string | null;
}

/**
 * `created_at` explicit INSERT — `store_date` trigger'ı ondan hesaplar
 * (append-only guard UPDATE'i engeller, INSERT serbest).
 */
async function seedOrder(db: Kysely<DB>, a: SeedOrderArgs): Promise<void> {
  const orderType = a.orderType ?? 'dine_in';
  await db
    .insertInto('orders')
    .values({
      id: a.orderId,
      tenant_id: a.tenantId,
      table_id: a.tableId ?? null,
      table_code_snapshot: a.tableCodeSnapshot ?? null,
      area_name_snapshot: a.areaNameSnapshot ?? null,
      customer_id: a.customerId ?? null,
      order_type: orderType,
      takeaway_stage: orderType === 'takeaway' ? 'preparing' : null,
      status: a.status ?? 'paid',
      order_no: a.orderNo,
      total_cents: a.totalCents,
      merged_into_order_id: a.mergedIntoOrderId ?? null,
      store_date: a.at, // trigger override eder; NOT NULL
      created_at: a.at,
      updated_at: a.at,
    })
    .execute();
}

interface SeedPaymentArgs {
  tenantId: string;
  orderId: string;
  at: Date;
  amountCents: number;
  paymentType?: 'cash' | 'card' | 'transfer';
  voidedAt?: Date | null;
}

async function seedPayment(db: Kysely<DB>, a: SeedPaymentArgs): Promise<void> {
  await db
    .insertInto('payments')
    .values({
      id: randomUUID(),
      tenant_id: a.tenantId,
      order_id: a.orderId,
      payment_type: a.paymentType ?? 'cash',
      payment_scope: 'full',
      amount_cents: a.amountCents,
      cash_received_cents: null,
      change_amount_cents: null,
      tip_amount_cents: null,
      voided_at: a.voidedAt ?? null,
      void_reason_code: a.voidedAt == null ? null : 'wrong_amount',
      created_at: a.at,
      created_by_user_id: null,
      idempotency_key: randomUUID(),
    })
    .execute();
}

interface TableRow {
  tableCode: string;
  areaName: string | null;
  billCount: number;
  revenueCents: number;
  averageBillCents: number;
  avgOccupancySeconds: number | null;
  durationSampleSize: number;
  turnsPerThousand: number | null;
  lastClosedAt: string | null;
}

/** CSV gövdesinin (BOM'suz) ilk satırını `;` ile ayrılmış başlık dizisine çevirir. */
function csvHeaderRow(body: string): string[] {
  const withoutBom = body.replace(/^﻿/, '');
  const firstLine = withoutBom.split('\r\n')[0] ?? '';
  return firstLine.split(';');
}

function csvDataRows(body: string): string[][] {
  const withoutBom = body.replace(/^﻿/, '');
  return withoutBom
    .split('\r\n')
    .slice(1)
    .filter((line) => line.length > 0)
    .map((line) => line.split(';'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Ana veri kümesi — (a) (b) (c) (d) (h) (i)
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd9 — /reports/table-performance ana veri kümesi', () => {
  const ctx = newCtx();
  const TENANT = randomUUID();

  // Sabit geçmiş iş-günleri (Istanbul yazın UTC+3 → 09:00Z = 12:00 yerel).
  const D1 = '2026-06-15';
  const D2 = '2026-06-16';
  const D3 = '2026-06-17';

  const O_M1_D1 = randomUUID();
  const O_M1_D2 = randomUUID();
  const O_MERGE_TARGET = randomUUID();
  const O_MERGE_SOURCE = randomUUID();
  const O_REOPEN = randomUUID();
  const O_OUTLIER = randomUUID();
  const O_UNASSIGNED = randomUUID();
  const O_FALLBACK = randomUUID();
  const O_TAKEAWAY = randomUUID();

  const TABLE_FALLBACK_ID = randomUUID();
  const CUSTOMER_ID = randomUUID();

  beforeAll(async () => {
    await setupTenant(ctx, TENANT, ['admin', 'cashier', 'waiter', 'kitchen']);
    const db = ctx.db!;

    await db
      .insertInto('tables')
      .values({
        id: TABLE_FALLBACK_ID,
        tenant_id: TENANT,
        code: 'Masa 5',
        capacity: 4,
      })
      .execute();
    await db
      .insertInto('customers')
      .values({ id: CUSTOMER_ID, tenant_id: TENANT, full_name: 'Test Müşteri' })
      .execute();

    // ── Masa 1 (Salon): iki normal adisyon → süre örneklemi 2 ────────────
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_M1_D1,
      orderNo: 9001,
      at: new Date(`${D1}T09:00:00Z`),
      totalCents: 10_000,
      tableCodeSnapshot: 'Masa 1',
      areaNameSnapshot: 'Salon',
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_M1_D1,
      at: new Date(`${D1}T10:00:00Z`), // +3600 sn
      amountCents: 10_000,
    });

    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_M1_D2,
      orderNo: 9002,
      at: new Date(`${D2}T09:00:00Z`),
      totalCents: 20_000,
      tableCodeSnapshot: 'Masa 1',
      areaNameSnapshot: 'Salon',
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_M1_D2,
      at: new Date(`${D2}T09:30:00Z`), // +1800 sn
      amountCents: 20_000,
    });

    // ── Masa 2 (Bahçe): BİRLEŞTİRME HEDEFİ (K3.d/e) ──────────────────────
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_MERGE_TARGET,
      orderNo: 9003,
      at: new Date(`${D1}T15:00:00Z`),
      totalCents: 5_000,
      tableCodeSnapshot: 'Masa 2',
      areaNameSnapshot: 'Bahçe',
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_MERGE_TARGET,
      at: new Date(`${D1}T16:00:00Z`),
      amountCents: 5_000,
    });
    // Kaynak: ADR-029 → status='merged', total_cents=0. `status='paid'` filtresi
    // onu ZATEN dışlar; "Masa 9" hiçbir satırda görünmemeli.
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_MERGE_SOURCE,
      orderNo: 9004,
      at: new Date(`${D1}T14:00:00Z`),
      totalCents: 0,
      status: 'merged',
      tableCodeSnapshot: 'Masa 9',
      areaNameSnapshot: 'Salon',
      mergedIntoOrderId: O_MERGE_TARGET,
    });

    // ── Masa 3 (Salon): ÖDE → VOID → YENİDEN ÖDE (K3.b) ──────────────────
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_REOPEN,
      orderNo: 9005,
      at: new Date(`${D3}T09:00:00Z`),
      totalCents: 7_000,
      tableCodeSnapshot: 'Masa 3',
      areaNameSnapshot: 'Salon',
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_REOPEN,
      at: new Date(`${D3}T10:00:00Z`),
      amountCents: 7_000,
      voidedAt: new Date(`${D3}T10:30:00Z`),
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_REOPEN,
      at: new Date(`${D3}T11:00:00Z`), // +7200 sn — SON aktif ödeme
      amountCents: 7_000,
    });

    // ── Masa 4 (Salon): >24 saat aykırı değer (K3.f) ─────────────────────
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_OUTLIER,
      orderNo: 9006,
      at: new Date(`${D3}T09:00:00Z`),
      totalCents: 3_000,
      tableCodeSnapshot: 'Masa 4',
      areaNameSnapshot: 'Salon',
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_OUTLIER,
      at: new Date('2026-06-18T15:00:00Z'), // +30 saat → süreden dışlanır
      amountCents: 3_000,
    });

    // ── Masası olmayan salon adisyonu (veri anomalisi, K7) ───────────────
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_UNASSIGNED,
      orderNo: 9007,
      at: new Date(`${D1}T09:00:00Z`),
      totalCents: 1_500,
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_UNASSIGNED,
      at: new Date(`${D1}T10:00:00Z`),
      amountCents: 1_500,
    });

    // ── Snapshot YOK, yalnız table_id → `t.code` fallback'i (K2) ─────────
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_FALLBACK,
      orderNo: 9008,
      at: new Date(`${D2}T09:00:00Z`),
      totalCents: 2_000,
      tableId: TABLE_FALLBACK_ID,
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_FALLBACK,
      at: new Date(`${D2}T10:00:00Z`), // +3600 sn
      amountCents: 2_000,
    });

    // ── Paket adisyon — table-performance'ta GÖRÜNMEZ, channel-mix'te var ─
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: O_TAKEAWAY,
      orderNo: 9009,
      at: new Date(`${D2}T09:00:00Z`),
      totalCents: 4_000,
      orderType: 'takeaway',
      customerId: CUSTOMER_ID,
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: O_TAKEAWAY,
      at: new Date(`${D2}T09:15:00Z`),
      amountCents: 4_000,
    });
  });

  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  const getWindow = (path: string, token?: string): request.Test =>
    request(ctx.app!)
      .get(`${path}${path.includes('?') ? '&' : '?'}range=custom&from=${D1}&to=${D3}`)
      .set('Authorization', `Bearer ${token ?? ctx.tokens.admin}`);

  it('masa satırları ciro azalan sıralı; kod ekseni + bölge + iki ayrı payda', async () => {
    const res = await getWindow('/reports/table-performance?limit=100');
    expect(res.status).toBe(200);

    const rows = res.body.data.tables as TableRow[];
    expect(rows.map((r) => r.tableCode)).toEqual([
      'Masa 1',
      'Masa 3',
      'Masa 2',
      'Masa 4',
      'Masa 5',
    ]);

    const m1 = rows[0]!;
    expect(m1.areaName).toBe('Salon');
    expect(m1.billCount).toBe(2);
    expect(m1.revenueCents).toBe(30_000);
    expect(m1.averageBillCents).toBe(15_000); // integer division
    expect(m1.durationSampleSize).toBe(2);
    expect(m1.avgOccupancySeconds).toBe(2_700); // (3600 + 1800) / 2
    expect(m1.lastClosedAt).toBe(new Date(`${D2}T09:30:00Z`).toISOString());

    // `t.code` fallback'i (snapshot NULL) satır üretir — Masa 5 kaybolmaz.
    const m5 = rows.find((r) => r.tableCode === 'Masa 5')!;
    expect(m5.areaName).toBeNull();
    expect(m5.revenueCents).toBe(2_000);
    expect(m5.avgOccupancySeconds).toBe(3_600);

    expect(res.body.data.totalTableCount).toBe(5);
    expect(res.body.data.activeDayCount).toBe(3);
    expect(res.body.data.timezone).toBe(TZ_TENANT);
  });

  it('(b) birleştirme: kaynak HİÇBİR satırda yok; hedef ciroya girer, süreye girmez', async () => {
    const res = await getWindow('/reports/table-performance?limit=100');
    const rows = res.body.data.tables as TableRow[];

    // Kaynak adisyonun masası (`status='merged'`) hiçbir satır üretmez.
    expect(rows.find((r) => r.tableCode === 'Masa 9')).toBeUndefined();

    const target = rows.find((r) => r.tableCode === 'Masa 2')!;
    expect(target.billCount).toBe(1); // ciro/sayım payda'sına GİRER
    expect(target.revenueCents).toBe(5_000);
    expect(target.durationSampleSize).toBe(0); // süre payda'sına GİRMEZ
    expect(target.avgOccupancySeconds).toBeNull();

    // Dışlananlar: birleştirme hedefi + >24sa aykırı değer.
    expect(res.body.data.durationExcludedCount).toBe(2);
  });

  it('(c) reopen: süre SON aktif ödemeye göre; adisyon TEK kez sayılır', async () => {
    const res = await getWindow('/reports/table-performance?limit=100');
    const rows = res.body.data.tables as TableRow[];
    const m3 = rows.find((r) => r.tableCode === 'Masa 3')!;

    expect(m3.billCount).toBe(1); // void'lenmiş ödeme ikinci adisyon YARATMAZ
    expect(m3.revenueCents).toBe(7_000); // ciro İKİ KEZ sayılmaz
    expect(m3.durationSampleSize).toBe(1);
    expect(m3.avgOccupancySeconds).toBe(7_200); // 09:00 → 11:00 (void'lenen 10:00 DEĞİL)
  });

  it('(d) tüm adisyonları dışlanan masada avgOccupancySeconds null (0 DEĞİL)', async () => {
    const res = await getWindow('/reports/table-performance?limit=100');
    const rows = res.body.data.tables as TableRow[];

    for (const code of ['Masa 2', 'Masa 4']) {
      const row = rows.find((r) => r.tableCode === code)!;
      expect(row.durationSampleSize).toBe(0);
      expect(row.avgOccupancySeconds).toBeNull();
      expect(row.avgOccupancySeconds).not.toBe(0);
      // Ciro payda'sı ETKİLENMEZ — iki denominatör ayrı.
      expect(row.billCount).toBeGreaterThan(0);
    }
  });

  it('masasız salon adisyonu satır üretmez ama `unassigned*` alanlarında görünür', async () => {
    const res = await getWindow('/reports/table-performance?limit=100');
    expect(res.body.data.unassignedOrderCount).toBe(1);
    expect(res.body.data.unassignedRevenueCents).toBe(1_500);
  });

  it('(a) cross-report invariant: channel-mix dine_in == Σ tables + unassigned', async () => {
    const tp = await getWindow('/reports/table-performance?limit=100');
    const cm = await getWindow('/reports/channel-mix');
    expect(tp.status).toBe(200);
    expect(cm.status).toBe(200);

    const rows = tp.body.data.tables as TableRow[];
    const sumRevenue = rows.reduce((s, r) => s + r.revenueCents, 0);
    const sumBills = rows.reduce((s, r) => s + r.billCount, 0);

    const dineIn = (
      cm.body.data.channels as Array<{
        orderType: string;
        orderCount: number;
        revenueCents: number;
      }>
    ).find((c) => c.orderType === 'dine_in')!;

    expect(dineIn.revenueCents).toBe(
      sumRevenue + tp.body.data.unassignedRevenueCents,
    );
    expect(dineIn.orderCount).toBe(sumBills + tp.body.data.unassignedOrderCount);
    // Somut değer: 30000+7000+5000+3000+2000 (masalar) + 1500 (masasız).
    expect(dineIn.revenueCents).toBe(48_500);
    expect(dineIn.orderCount).toBe(7);
  });

  it('paket adisyon table-performance\'a SIZMAZ, channel-mix\'te görünür', async () => {
    const tp = await getWindow('/reports/table-performance?limit=100');
    const total = (tp.body.data.tables as TableRow[]).reduce(
      (s, r) => s + r.revenueCents,
      0,
    );
    expect(total).toBe(47_000); // 4 000 kuruşluk paket adisyon YOK

    const cm = await getWindow('/reports/channel-mix');
    const takeaway = (
      cm.body.data.channels as Array<{ orderType: string; revenueCents: number }>
    ).find((c) => c.orderType === 'takeaway')!;
    expect(takeaway.revenueCents).toBe(4_000);
  });

  it('limit kırpar ama `totalTableCount` kırpılmadan ÖNCEKİ sayıyı basar', async () => {
    const res = await getWindow('/reports/table-performance?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data.tables).toHaveLength(2);
    expect(res.body.data.totalTableCount).toBe(5);
  });

  it('limit sınırı: limit=101 → 400 VALIDATION_ERROR', async () => {
    const res = await request(ctx.app!)
      .get('/reports/table-performance?limit=101')
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(400);
  });

  // ── (h) RBAC ────────────────────────────────────────────────────────────
  it('(h) RBAC: admin 200, cashier 200, waiter/kitchen 403 AUTH_FORBIDDEN', async () => {
    for (const path of ['/reports/table-performance', '/reports/channel-mix']) {
      for (const role of ['admin', 'cashier'] as const) {
        const res = await request(ctx.app!)
          .get(path)
          .set('Authorization', `Bearer ${ctx.tokens[role]}`);
        expect(res.status).toBe(200);
      }
      for (const role of ['waiter', 'kitchen'] as const) {
        const res = await request(ctx.app!)
          .get(path)
          .set('Authorization', `Bearer ${ctx.tokens[role]}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    }
  });

  // ── (i) CSV ─────────────────────────────────────────────────────────────
  it('(i) CSV: admin 200 + kilitli başlık sırası (iki endpoint)', async () => {
    const tp = await getWindow('/reports/table-performance?limit=100&format=csv');
    expect(tp.status).toBe(200);
    expect(csvHeaderRow(tp.text)).toEqual([
      'window_start',
      'window_end',
      'table_code',
      'area_name',
      'bill_count',
      'revenue_cents',
      'average_bill_cents',
      'avg_occupancy_seconds',
      'duration_sample_size',
      'turns_per_thousand',
      'last_closed_at',
    ]);

    const cm = await getWindow('/reports/channel-mix?format=csv');
    expect(cm.status).toBe(200);
    expect(csvHeaderRow(cm.text)).toEqual([
      'window_start',
      'window_end',
      'order_type',
      'order_count',
      'revenue_cents',
      'average_bill_cents',
    ]);
    // K17 — channel-mix CSV YALNIZ 3 kanal satırı (byHour GİRMEZ).
    expect(csvDataRows(cm.text)).toHaveLength(3);
  });

  it('(i) CSV: boş süre hücresi `\'\'` basılır (0 DEĞİL)', async () => {
    const res = await getWindow('/reports/table-performance?limit=100&format=csv');
    const rows = csvDataRows(res.text);
    // Başlık sırası: [..., 2]=table_code, [7]=avg_occupancy_seconds
    const masa2 = rows.find((cells) => cells[2] === 'Masa 2')!;
    expect(masa2[7]).toBe('');
    expect(masa2[8]).toBe('0'); // duration_sample_size
    const masa1 = rows.find((cells) => cells[2] === 'Masa 1')!;
    expect(masa1[7]).toBe('2700');
  });

  it('(i) CSV: cashier 403 — Amd6 admin-only kilidi yeni endpoint\'lerde de geçerli', async () => {
    for (const path of ['/reports/table-performance', '/reports/channel-mix']) {
      const res = await request(ctx.app!)
        .get(`${path}?format=csv`)
        .set('Authorization', `Bearer ${ctx.tokens.cashier}`);
      expect(res.status).toBe(403);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) devir hızı — 3 aktif gün, tek masada 6 adisyon
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd9 K4 — devir hızı (turnsPerThousand)', () => {
  const ctx = newCtx();
  const TENANT = randomUUID();

  const DAYS = ['2026-06-20', '2026-06-21', '2026-06-22'] as const;
  const EMPTY_DAY = '2026-05-01';

  beforeAll(async () => {
    await setupTenant(ctx, TENANT, ['admin']);
    const db = ctx.db!;
    let orderNo = 9100;
    for (const day of DAYS) {
      for (const hourOffset of [9, 12]) {
        const at = new Date(`${day}T${String(hourOffset).padStart(2, '0')}:00:00Z`);
        const orderId = randomUUID();
        await seedOrder(db, {
          tenantId: TENANT,
          orderId,
          orderNo: (orderNo += 1),
          at,
          totalCents: 1_000,
          tableCodeSnapshot: 'Masa 1',
          areaNameSnapshot: 'Salon',
        });
        await seedPayment(db, {
          tenantId: TENANT,
          orderId,
          at: new Date(at.getTime() + 30 * 60_000),
          amountCents: 1_000,
        });
      }
    }
  });

  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  it('(e) 3 aktif gün + 6 adisyon → turnsPerThousand === 2000, activeDayCount === 3', async () => {
    const res = await request(ctx.app!)
      .get(
        `/reports/table-performance?range=custom&from=${DAYS[0]}&to=${DAYS[2]}&limit=100`,
      )
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.data.activeDayCount).toBe(3);

    const row = (res.body.data.tables as TableRow[])[0]!;
    expect(row.billCount).toBe(6);
    expect(row.turnsPerThousand).toBe(2_000); // 6 / 3 = 2,000 devir/gün
  });

  it('(e) boş aralık: satır yok, activeDayCount 0 → devir hızı payda\'sı yok', async () => {
    const res = await request(ctx.app!)
      .get(
        `/reports/table-performance?range=custom&from=${EMPTY_DAY}&to=${EMPTY_DAY}`,
      )
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tables).toEqual([]);
    expect(res.body.data.activeDayCount).toBe(0);
    expect(res.body.data.durationExcludedCount).toBe(0);
    expect(res.body.data.unassignedOrderCount).toBe(0);
    expect(res.body.data.unassignedRevenueCents).toBe(0);
    expect(res.body.data.totalTableCount).toBe(0);
    expect(
      (res.body.data.tables as TableRow[]).every((r) => r.turnsPerThousand === null),
    ).toBe(true);
  });
});
