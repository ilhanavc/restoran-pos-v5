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
 * ADR-015 Amendment 8 (2026-08-11) — Trend + Bahşiş raporları.
 *
 * A8.5 kırmızı senaryoları (a–g):
 *   (a) cross-report invariant  — trend/daily D == today-revenue(D);
 *                                 trend/payment-mix D == payment-distribution(D)
 *   (b) tam seri                — veri olmayan aralıkta last7 → 7 sıfır eleman, artan
 *   (c) gün sınırı              — 23:50 açılıp 00:10 ödenen adisyon üç raporda da AYNI gün
 *   (d) RBAC                    — /reports/tips admin 200, diğer roller 403
 *   (e) bahşiş doğruluğu        — void'lenmiş/NULL bahşiş sayılmaz, ciroyu değiştirmez
 *   (f) CSV                     — admin 200 + kilitli başlık, cashier 403 (Amd6)
 *   (g) süreç-TZ bağımsızlığı   — TZ=America/New_York altında doğru günler
 *
 * Ek: product-mix Top-N + `other` kovası (K7).
 *
 * Koşum: yalnız lokal/CI `pos_test` (DATABASE_URL yoksa skip). Her describe
 * KENDİ tenant'ını kurar — toplam/sayım assertion'ları başka suite'lerden etkilenmez.
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
  tokens: Partial<Record<'admin' | 'cashier' | 'waiter' | 'kitchen', string>>;
}

function newCtx(): Ctx {
  return { tokens: {} };
}

async function login(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

/** İzole tenant + istenen rollerde kullanıcı kurar, token'ları ctx'e yazar. */
async function setupTenant(
  ctx: Ctx,
  tenantId: string,
  roles: readonly ('admin' | 'cashier' | 'waiter' | 'kitchen')[],
): Promise<Record<string, string>> {
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
    .values({ id: tenantId, name: 'Amd8', slug: `amd8-${short}` })
    .execute();
  await db
    .insertInto('tenant_settings')
    .values({ tenant_id: tenantId, timezone: TZ_TENANT })
    .execute();

  const ids: Record<string, string> = {};
  for (const role of roles) {
    const id = randomUUID();
    const email = `amd8-${role}-${randomUUID().slice(0, 8)}@example.com`;
    await db
      .insertInto('users')
      .values({
        id,
        tenant_id: tenantId,
        email,
        username: `amd8-${role}-${short}`,
        password_hash: await hashPassword(PASSWORD),
        role,
      })
      .execute();
    ids[role] = id;
    ctx.tokens[role] = await login(ctx.app, email, PASSWORD);
  }
  return ids;
}

/** FK zincirine göre sıralı temizlik — yalnız BU tenant'ın satırları. */
async function teardownTenant(ctx: Ctx, tenantId: string): Promise<void> {
  const db = ctx.db!;
  await db.deleteFrom('audit_logs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('payments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('order_no_counters').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('customers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('products').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('categories').where('tenant_id', '=', tenantId).execute();
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
  status?: 'paid' | 'open' | 'cancelled';
  waiterUserId?: string | null;
  /** `takeaway` siparişlerde ZORUNLU (orders_takeaway_customer_when_takeaway CHECK). */
  customerId?: string | null;
}

/**
 * `created_at` explicit INSERT — `store_date` trigger'ı ondan hesaplar
 * (append-only guard UPDATE'i engeller, INSERT serbest).
 *
 * DB CHECK'leri: `takeaway` siparişi hem `customer_id` hem `takeaway_stage`
 * ister; diğer türlerde `takeaway_stage` NULL olmak ZORUNDA.
 */
async function seedOrder(db: Kysely<DB>, a: SeedOrderArgs): Promise<void> {
  const orderType = a.orderType ?? 'dine_in';
  await db
    .insertInto('orders')
    .values({
      id: a.orderId,
      tenant_id: a.tenantId,
      table_id: null,
      customer_id: a.customerId ?? null,
      order_type: orderType,
      takeaway_stage: orderType === 'takeaway' ? 'preparing' : null,
      status: a.status ?? 'paid',
      order_no: a.orderNo,
      total_cents: a.totalCents,
      store_date: a.at, // trigger override eder; NOT NULL
      created_at: a.at,
      updated_at: a.at,
      waiter_user_id: a.waiterUserId ?? null,
    })
    .execute();
}

interface SeedPaymentArgs {
  tenantId: string;
  orderId: string;
  at: Date;
  amountCents: number;
  paymentType?: 'cash' | 'card' | 'transfer';
  tipAmountCents?: number | null;
  voidedAt?: Date | null;
  createdByUserId?: string | null;
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
      tip_amount_cents: a.tipAmountCents ?? null,
      voided_at: a.voidedAt ?? null,
      void_reason_code: a.voidedAt == null ? null : 'wrong_amount',
      created_at: a.at,
      created_by_user_id: a.createdByUserId ?? null,
      idempotency_key: randomUUID(),
    })
    .execute();
}

interface SeedItemArgs {
  tenantId: string;
  orderId: string;
  productId: string | null;
  productName: string;
  categoryName: string;
  unitPriceCents: number;
  quantity: number;
  at: Date;
  status?: 'served' | 'cancelled';
}

async function seedItem(db: Kysely<DB>, a: SeedItemArgs): Promise<void> {
  await db
    .insertInto('order_items')
    .values({
      id: randomUUID(),
      tenant_id: a.tenantId,
      order_id: a.orderId,
      product_id: a.productId,
      product_name: a.productName,
      category_name_snapshot: a.categoryName,
      unit_price_cents: a.unitPriceCents,
      quantity: a.quantity,
      total_cents: a.unitPriceCents * a.quantity,
      status: a.status ?? 'served',
      created_at: a.at,
      updated_at: a.at,
    })
    .execute();
}

/** `range=custom&from=D&to=D` tek-gün sorgusu. */
function getDay(ctx: Ctx, path: string, day: string, token?: string): request.Test {
  const sep = path.includes('?') ? '&' : '?';
  return request(ctx.app!)
    .get(`${path}${sep}range=custom&from=${day}&to=${day}`)
    .set('Authorization', `Bearer ${token ?? ctx.tokens.admin}`);
}

/** CSV gövdesinin (BOM'suz) ilk satırını `;` ile ayrılmış başlık dizisine çevirir. */
function csvHeaderRow(body: string): string[] {
  const withoutBom = body.replace(/^﻿/, '');
  const firstLine = withoutBom.split('\r\n')[0] ?? '';
  return firstLine.split(';');
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) cross-report invariant + (e) bahşiş doğruluğu + (f) CSV + Top-N
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd8 — trend/bahşiş ana veri kümesi', () => {
  const ctx = newCtx();
  const TENANT = randomUUID();

  // Sabit geçmiş iş-günleri — koşum anından bağımsız determinizm.
  const D1 = '2026-06-10';
  const D2 = '2026-06-11';
  const D3 = '2026-06-12';
  // Istanbul yazın UTC+3 → 12:00 yerel = 09:00Z (aynı takvim günü).
  const at = (day: string): Date => new Date(`${day}T09:00:00Z`);

  // D1: dine_in 30000 (cash) + takeaway 10000 (card, bahşiş 500)
  // D2: (veri yok — seri içi boş gün)
  // D3: dine_in 20000 (cash, bahşiş 1500) + void'lenmiş ödeme (bahşiş 9999)
  const ORDER_D1_A = randomUUID();
  const ORDER_D1_B = randomUUID();
  const ORDER_D3_A = randomUUID();
  const ORDER_D3_VOID = randomUUID();

  const CAT_PIDE = randomUUID();
  const CAT_ICECEK = randomUUID();
  const PROD_PIDE = randomUUID();
  const PROD_AYRAN = randomUUID();
  /** Paket siparişi DB CHECK'i müşteri zorunlu kılar. */
  const CUSTOMER_ID = randomUUID();

  beforeAll(async () => {
    await setupTenant(ctx, TENANT, ['admin', 'cashier', 'waiter', 'kitchen']);
    const db = ctx.db!;

    await db
      .insertInto('customers')
      .values({ id: CUSTOMER_ID, tenant_id: TENANT, full_name: 'Test Müşteri' })
      .execute();
    await db
      .insertInto('categories')
      .values([
        { id: CAT_PIDE, tenant_id: TENANT, name: 'Pideler', sort_order: 1 },
        { id: CAT_ICECEK, tenant_id: TENANT, name: 'İçecekler', sort_order: 2 },
      ])
      .execute();
    await db
      .insertInto('products')
      .values([
        {
          id: PROD_PIDE,
          tenant_id: TENANT,
          category_id: CAT_PIDE,
          name: 'Kıymalı Pide',
          price_cents: 15_000,
        },
        {
          id: PROD_AYRAN,
          tenant_id: TENANT,
          category_id: CAT_ICECEK,
          name: 'Ayran',
          price_cents: 2_500,
        },
      ])
      .execute();

    // ── D1 ────────────────────────────────────────────────────────────────
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: ORDER_D1_A,
      orderNo: 8001,
      at: at(D1),
      totalCents: 30_000,
      orderType: 'dine_in',
    });
    await seedItem(db, {
      tenantId: TENANT,
      orderId: ORDER_D1_A,
      productId: PROD_PIDE,
      productName: 'Kıymalı Pide',
      categoryName: 'Pideler',
      unitPriceCents: 15_000,
      quantity: 2,
      at: at(D1),
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: ORDER_D1_A,
      at: at(D1),
      amountCents: 30_000,
      paymentType: 'cash',
    });

    await seedOrder(db, {
      tenantId: TENANT,
      orderId: ORDER_D1_B,
      orderNo: 8002,
      at: at(D1),
      totalCents: 10_000,
      orderType: 'takeaway',
      customerId: CUSTOMER_ID,
    });
    await seedItem(db, {
      tenantId: TENANT,
      orderId: ORDER_D1_B,
      productId: PROD_AYRAN,
      productName: 'Ayran',
      categoryName: 'İçecekler',
      unitPriceCents: 2_500,
      quantity: 4,
      at: at(D1),
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: ORDER_D1_B,
      at: at(D1),
      amountCents: 10_000,
      paymentType: 'card',
      tipAmountCents: 500,
    });

    // ── D3 ────────────────────────────────────────────────────────────────
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: ORDER_D3_A,
      orderNo: 8003,
      at: at(D3),
      totalCents: 20_000,
      orderType: 'dine_in',
    });
    await seedItem(db, {
      tenantId: TENANT,
      orderId: ORDER_D3_A,
      productId: PROD_PIDE,
      productName: 'Kıymalı Pide',
      categoryName: 'Pideler',
      unitPriceCents: 20_000,
      quantity: 1,
      at: at(D3),
    });
    // İPTAL kalem — hiçbir mix toplamına girmemeli (K6).
    await seedItem(db, {
      tenantId: TENANT,
      orderId: ORDER_D3_A,
      productId: PROD_AYRAN,
      productName: 'Ayran',
      categoryName: 'İçecekler',
      unitPriceCents: 2_500,
      quantity: 8,
      at: at(D3),
      status: 'cancelled',
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: ORDER_D3_A,
      at: at(D3),
      amountCents: 20_000,
      paymentType: 'cash',
      tipAmountCents: 1_500,
    });

    // Void'lenmiş ödeme (bahşişli) — ne ciroya ne bahşişe girmeli (ADR-033).
    await seedOrder(db, {
      tenantId: TENANT,
      orderId: ORDER_D3_VOID,
      orderNo: 8004,
      at: at(D3),
      totalCents: 0,
      orderType: 'dine_in',
    });
    await seedPayment(db, {
      tenantId: TENANT,
      orderId: ORDER_D3_VOID,
      at: at(D3),
      amountCents: 7_777,
      paymentType: 'card',
      tipAmountCents: 9_999,
      voidedAt: at(D3),
    });
  });

  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  // ── (a) cross-report invariant ─────────────────────────────────────────
  it('(a) trend/daily D günü cirosu == today-revenue(custom D..D) — birebir', async () => {
    for (const day of [D1, D2, D3]) {
      const trend = await getDay(ctx, '/reports/trend/daily', day);
      expect(trend.status).toBe(200);
      const point = (
        trend.body.data.points as Array<{ date: string; revenueCents: number }>
      ).find((p) => p.date === day);

      const kpi = await getDay(ctx, '/reports/kpi/today-revenue', day);
      expect(kpi.status).toBe(200);
      expect(point?.revenueCents).toBe(kpi.body.data.totalRevenueCents);
    }
  });

  it('(a) trend/payment-mix D toplamı == payment-distribution(D) totalCents', async () => {
    for (const day of [D1, D2, D3]) {
      const mix = await getDay(ctx, '/reports/trend/payment-mix', day);
      expect(mix.status).toBe(200);
      const point = (
        mix.body.data.points as Array<{ date: string; totalCents: number }>
      ).find((p) => p.date === day);

      const dist = await getDay(ctx, '/reports/payment-distribution', day);
      expect(dist.status).toBe(200);
      expect(point?.totalCents).toBe(dist.body.data.totalCents);
    }
  });

  it('trend/daily: kanal kırılımı 3 sabit anahtar + integer ortalama adisyon', async () => {
    const res = await request(ctx.app!)
      .get(`/reports/trend/daily?range=custom&from=${D1}&to=${D3}`)
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(200);

    const points = res.body.data.points as Array<{
      date: string;
      revenueCents: number;
      orderCount: number;
      averageBillCents: number;
      channels: Array<{ orderType: string; revenueCents: number; orderCount: number }>;
    }>;
    expect(points.map((p) => p.date)).toEqual([D1, D2, D3]);
    // Her gün üç kanalı da taşır — `delivery` 0 olsa bile bastırılmaz (K5).
    for (const p of points) {
      expect(p.channels.map((c) => c.orderType)).toEqual([
        'dine_in',
        'takeaway',
        'delivery',
      ]);
    }

    const d1 = points[0]!;
    expect(d1.revenueCents).toBe(40_000);
    expect(d1.orderCount).toBe(2);
    expect(d1.averageBillCents).toBe(20_000);
    expect(d1.channels.find((c) => c.orderType === 'dine_in')?.revenueCents).toBe(30_000);
    expect(d1.channels.find((c) => c.orderType === 'takeaway')?.revenueCents).toBe(10_000);
    expect(d1.channels.find((c) => c.orderType === 'delivery')?.revenueCents).toBe(0);

    // Boş gün seri içinde 0 ile durur (K4).
    expect(points[1]!.revenueCents).toBe(0);
    expect(points[1]!.orderCount).toBe(0);
    expect(points[1]!.averageBillCents).toBe(0);

    // 20000 (paid) + 0 (void'lenmiş ödemenin siparişi total_cents=0)
    expect(points[2]!.revenueCents).toBe(20_000);
    expect(res.body.data.totalRevenueCents).toBe(60_000);
    expect(res.body.data.totalOrderCount).toBe(4);
    expect(res.body.data.timezone).toBe(TZ_TENANT);
  });

  it('trend/payment-mix: void\'lenmiş ödeme hiçbir güne yazılmaz (ADR-033)', async () => {
    const res = await getDay(ctx, '/reports/trend/payment-mix', D3);
    const point = (res.body.data.points as Array<{
      date: string;
      totalCents: number;
      paymentTypes: Array<{ paymentType: string; totalCents: number; count: number }>;
    }>)[0]!;
    // 20 000 nakit; void'lenmiş 7 777 kart YOK.
    expect(point.totalCents).toBe(20_000);
    expect(point.paymentTypes.map((b) => b.paymentType)).toEqual([
      'cash',
      'card',
      'transfer',
    ]);
    expect(point.paymentTypes.find((b) => b.paymentType === 'card')?.totalCents).toBe(0);
    expect(point.paymentTypes.find((b) => b.paymentType === 'card')?.count).toBe(0);
  });

  // ── (e) bahşiş doğruluğu ────────────────────────────────────────────────
  it('(e) tips: yalnız void\'lenmemiş, >0 bahşişler sayılır', async () => {
    const res = await request(ctx.app!)
      .get(`/reports/tips?range=custom&from=${D1}&to=${D3}`)
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(200);

    // 500 (D1 kart) + 1500 (D3 nakit); void'lenmiş 9 999 HARİÇ, NULL'lar HARİÇ.
    expect(res.body.data.totalTipCents).toBe(2_000);
    expect(res.body.data.tipPaymentCount).toBe(2);

    const byDay = res.body.data.byDay as Array<{
      date: string;
      tipCents: number;
      paymentCount: number;
    }>;
    expect(byDay.map((d) => d.date)).toEqual([D1, D2, D3]);
    expect(byDay[0]!.tipCents).toBe(500);
    expect(byDay[0]!.paymentCount).toBe(1);
    // Bahşişsiz gün 0 ile basılır (K4).
    expect(byDay[1]!).toEqual({ date: D2, tipCents: 0, paymentCount: 0 });
    expect(byDay[2]!.tipCents).toBe(1_500);
  });

  it('(e) bahşiş ciroyu DEĞİŞTİRMEZ — today-revenue ve trend/daily etkilenmez', async () => {
    // D3'te 1 500 bahşiş var; ciro yalnız 20 000 olmalı (bahşiş restoran geliri değil).
    const kpi = await getDay(ctx, '/reports/kpi/today-revenue', D3);
    expect(kpi.body.data.totalRevenueCents).toBe(20_000);

    const trend = await getDay(ctx, '/reports/trend/daily', D3);
    expect(trend.body.data.points[0].revenueCents).toBe(20_000);

    const mix = await getDay(ctx, '/reports/trend/payment-mix', D3);
    expect(mix.body.data.points[0].totalCents).toBe(20_000);
  });

  // ── product-mix (K7) ────────────────────────────────────────────────────
  it('product-mix dimension=category: iptal kalem hariç, gün × kategori', async () => {
    const res = await request(ctx.app!)
      .get(
        `/reports/trend/product-mix?dimension=category&range=custom&from=${D1}&to=${D3}`,
      )
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(200);
    expect(res.body.data.dimension).toBe('category');

    const points = res.body.data.points as Array<{
      date: string;
      entities: Array<{ entityId: string | null; entityName: string; qty: number; revenueCents: number }>;
    }>;
    expect(points.map((p) => p.date)).toEqual([D1, D2, D3]);
    expect(points[1]!.entities).toEqual([]);

    const d1Pide = points[0]!.entities.find((e) => e.entityId === CAT_PIDE);
    expect(d1Pide?.revenueCents).toBe(30_000);
    expect(d1Pide?.qty).toBe(2);

    // D3'te iptal edilen Ayran kalemi (8 × 2 500) HİÇ görünmemeli.
    expect(points[2]!.entities.find((e) => e.entityId === CAT_ICECEK)).toBeUndefined();
    expect(points[2]!.entities).toHaveLength(1);
    expect(points[2]!.entities[0]!.revenueCents).toBe(20_000);

    // Pencere geneli özet ciro azalan sıralı.
    const overall = res.body.data.entities as Array<{ entityId: string | null; revenueCents: number }>;
    expect(overall[0]!.entityId).toBe(CAT_PIDE);
    expect(overall[0]!.revenueCents).toBe(50_000);
  });

  it('product-mix limit=1: Top-N dışı kalanlar `other` kovasına katlanır (K7)', async () => {
    const res = await request(ctx.app!)
      .get(
        `/reports/trend/product-mix?dimension=product&limit=1&range=custom&from=${D1}&to=${D3}`,
      )
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(200);

    const overall = res.body.data.entities as Array<{
      entityId: string | null;
      entityName: string;
      revenueCents: number;
    }>;
    expect(overall).toHaveLength(2);
    expect(overall[0]!.entityId).toBe(PROD_PIDE);
    expect(overall[0]!.revenueCents).toBe(50_000);
    // Ayran Top-1 dışında → `other`.
    expect(overall[1]!.entityId).toBeNull();
    expect(overall[1]!.entityName).toBe('other');
    expect(overall[1]!.revenueCents).toBe(10_000);

    const d1 = (res.body.data.points as Array<{ date: string; entities: Array<{ entityId: string | null; revenueCents: number }> }>)[0]!;
    expect(d1.entities.find((e) => e.entityId === null)?.revenueCents).toBe(10_000);
  });

  it('product-mix limit sınırı: limit=26 → 400 VALIDATION_ERROR', async () => {
    const res = await request(ctx.app!)
      .get('/reports/trend/product-mix?limit=26')
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(res.status).toBe(400);
  });

  // ── (d) RBAC ────────────────────────────────────────────────────────────
  it('(d) /reports/tips: admin 200; cashier/waiter/kitchen 403 AUTH_FORBIDDEN', async () => {
    const ok = await request(ctx.app!)
      .get('/reports/tips')
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);
    expect(ok.status).toBe(200);

    for (const role of ['cashier', 'waiter', 'kitchen'] as const) {
      const res = await request(ctx.app!)
        .get('/reports/tips')
        .set('Authorization', `Bearer ${ctx.tokens[role]}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    }
  });

  it('trend endpoint\'leri kasiyere AÇIK, garson/mutfağa KAPALI (reports.read paritesi)', async () => {
    for (const path of [
      '/reports/trend/daily',
      '/reports/trend/payment-mix',
      '/reports/trend/product-mix',
    ]) {
      const cashier = await request(ctx.app!)
        .get(path)
        .set('Authorization', `Bearer ${ctx.tokens.cashier}`);
      expect(cashier.status).toBe(200);

      for (const role of ['waiter', 'kitchen'] as const) {
        const res = await request(ctx.app!)
          .get(path)
          .set('Authorization', `Bearer ${ctx.tokens[role]}`);
        expect(res.status).toBe(403);
      }
    }
  });

  // ── (f) CSV ─────────────────────────────────────────────────────────────
  it('(f) CSV: admin 200 + kilitli başlık sırası (4 endpoint)', async () => {
    const expected: Record<string, string[]> = {
      '/reports/trend/daily': [
        'date',
        'revenue_cents',
        'order_count',
        'average_bill_cents',
        'dine_in_revenue_cents',
        'dine_in_order_count',
        'takeaway_revenue_cents',
        'takeaway_order_count',
        'delivery_revenue_cents',
        'delivery_order_count',
        'timezone',
        'as_of',
      ],
      '/reports/trend/payment-mix': [
        'date',
        'payment_type',
        'total_cents',
        'payment_count',
        'day_total_cents',
        'timezone',
        'as_of',
      ],
      '/reports/trend/product-mix': [
        'date',
        'dimension',
        'entity_id',
        'entity_name',
        'qty',
        'revenue_cents',
        'timezone',
        'as_of',
      ],
      '/reports/tips': [
        'date',
        'tip_cents',
        'payment_count',
        'total_tip_cents',
        'timezone',
        'as_of',
      ],
    };

    for (const [path, headers] of Object.entries(expected)) {
      const res = await request(ctx.app!)
        .get(`${path}?range=custom&from=${D1}&to=${D3}&format=csv`)
        .set('Authorization', `Bearer ${ctx.tokens.admin}`);
      expect(res.status).toBe(200);
      expect(csvHeaderRow(res.text)).toEqual(headers);
    }
  });

  it('(f) CSV: cashier 403 — Amd6 CSV admin-only kilidi yeni endpoint\'lerde de geçerli', async () => {
    for (const path of [
      '/reports/trend/daily',
      '/reports/trend/payment-mix',
      '/reports/trend/product-mix',
      '/reports/tips',
    ]) {
      const res = await request(ctx.app!)
        .get(`${path}?format=csv`)
        .set('Authorization', `Bearer ${ctx.tokens.cashier}`);
      expect(res.status).toBe(403);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) tam seri — veri olmayan tenant
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd8 K4 — tam seri garantisi (boş tenant)', () => {
  const ctx = newCtx();
  const TENANT = randomUUID();

  beforeAll(async () => {
    await setupTenant(ctx, TENANT, ['admin']);
  });
  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  const get = (path: string, range: string): request.Test =>
    request(ctx.app!)
      .get(`${path}?range=${range}`)
      .set('Authorization', `Bearer ${ctx.tokens.admin}`);

  it('(b) last7 → 7 eleman, hepsi 0, tarihler artan ve ARDIŞIK', async () => {
    const res = await get('/reports/trend/daily', 'last7');
    expect(res.status).toBe(200);
    const points = res.body.data.points as Array<{ date: string; revenueCents: number }>;
    expect(points).toHaveLength(7);
    expect(points.every((p) => p.revenueCents === 0)).toBe(true);

    const dates = points.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);
    for (let i = 1; i < dates.length; i += 1) {
      const prev = Date.parse(`${dates[i - 1]!}T00:00:00Z`);
      const cur = Date.parse(`${dates[i]!}T00:00:00Z`);
      expect(cur - prev).toBe(86_400_000);
    }
  });

  it('(b) last30 → 30 eleman (payment-mix ve tips dahil aynı garanti)', async () => {
    const daily = await get('/reports/trend/daily', 'last30');
    expect(daily.body.data.points).toHaveLength(30);

    const mix = await get('/reports/trend/payment-mix', 'last30');
    expect(mix.body.data.points).toHaveLength(30);
    expect(mix.body.data.totalCents).toBe(0);

    const tips = await get('/reports/tips', 'last30');
    expect(tips.body.data.byDay).toHaveLength(30);
    expect(tips.body.data.totalTipCents).toBe(0);
    expect(tips.body.data.tipPaymentCount).toBe(0);
  });

  it('range=today → 1 elemanlı seri (K8: tüm preset\'ler kabul edilir)', async () => {
    const res = await get('/reports/trend/daily', 'today');
    expect(res.status).toBe(200);
    expect(res.body.data.points).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) gün sınırı — 23:50 açılıp 00:10 ödenen adisyon
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd8 K3 — gece-yarısı sarkan adisyon tek güne düşer', () => {
  const ctx = newCtx();
  const TENANT = randomUUID();
  const ORDER_ID = randomUUID();

  const DAY_D = '2026-07-01';
  const DAY_D_PLUS_1 = '2026-07-02';
  // Istanbul UTC+3: 23:50 yerel = 20:50Z (D); 00:10 yerel = 21:10Z (hâlâ D tarihli UTC).
  const OPENED_AT = new Date('2026-07-01T20:50:00Z');
  const PAID_AT = new Date('2026-07-01T21:10:00Z');
  const TOTAL = 50_000;
  const TIP = 2_500;

  beforeAll(async () => {
    await setupTenant(ctx, TENANT, ['admin']);
    await seedOrder(ctx.db!, {
      tenantId: TENANT,
      orderId: ORDER_ID,
      orderNo: 8101,
      at: OPENED_AT,
      totalCents: TOTAL,
    });
    await seedPayment(ctx.db!, {
      tenantId: TENANT,
      orderId: ORDER_ID,
      at: PAID_AT,
      amountCents: TOTAL,
      paymentType: 'card',
      tipAmountCents: TIP,
    });
  });
  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  it('(c) D günü: trend/daily + trend/payment-mix + tips üçü de D\'ye yazar', async () => {
    const daily = await getDay(ctx, '/reports/trend/daily', DAY_D);
    expect(daily.status).toBe(200);
    expect(daily.body.data.points[0].date).toBe(DAY_D);
    expect(daily.body.data.points[0].revenueCents).toBe(TOTAL);

    const mix = await getDay(ctx, '/reports/trend/payment-mix', DAY_D);
    expect(mix.body.data.points[0].totalCents).toBe(TOTAL);

    const tips = await getDay(ctx, '/reports/tips', DAY_D);
    expect(tips.body.data.totalTipCents).toBe(TIP);
    expect(tips.body.data.byDay[0].date).toBe(DAY_D);
  });

  it('(c) D+1 günü: hiçbiri bu parayı ikinci kez saymaz', async () => {
    const daily = await getDay(ctx, '/reports/trend/daily', DAY_D_PLUS_1);
    expect(daily.body.data.points[0].revenueCents).toBe(0);

    const mix = await getDay(ctx, '/reports/trend/payment-mix', DAY_D_PLUS_1);
    expect(mix.body.data.points[0].totalCents).toBe(0);

    const tips = await getDay(ctx, '/reports/tips', DAY_D_PLUS_1);
    expect(tips.body.data.totalTipCents).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) süreç-TZ bağımsızlığı
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('ADR-015 Amd8 — TZ=America/New_York süreç TZ\'si günleri kaydırmaz', () => {
  const ctx = newCtx();
  const TENANT = randomUUID();
  const ORDER_ID = randomUUID();

  const DAY_D = '2026-07-01';
  const DAY_D_PLUS_1 = '2026-07-02';
  // 02:00Z → Istanbul 05:00 (2 Tem), New York 22:00 (1 Tem).
  // Süreç-TZ sızıntısı olsaydı gün etiketi D-1 okunurdu.
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
    await setupTenant(ctx, TENANT, ['admin']);
    await seedOrder(ctx.db!, {
      tenantId: TENANT,
      orderId: ORDER_ID,
      orderNo: 8201,
      at: ORDER_AT,
      totalCents: TOTAL,
    });
    await seedPayment(ctx.db!, {
      tenantId: TENANT,
      orderId: ORDER_ID,
      at: ORDER_AT,
      amountCents: TOTAL,
      tipAmountCents: 700,
    });
  });
  afterAll(async () => {
    await teardownTenant(ctx, TENANT);
  });

  it('(g) gün etiketi tenant takvim günüdür; seri D+1\'i işaretler, D boş kalır', async () => {
    await withNewYorkTz(async () => {
      const res = await request(ctx.app!)
        .get(`/reports/trend/daily?range=custom&from=${DAY_D}&to=${DAY_D_PLUS_1}`)
        .set('Authorization', `Bearer ${ctx.tokens.admin}`);
      expect(res.status).toBe(200);

      const points = res.body.data.points as Array<{ date: string; revenueCents: number }>;
      expect(points.map((p) => p.date)).toEqual([DAY_D, DAY_D_PLUS_1]);
      expect(points[0]!.revenueCents).toBe(0);
      expect(points[1]!.revenueCents).toBe(TOTAL);

      const tips = await request(ctx.app!)
        .get(`/reports/tips?range=custom&from=${DAY_D}&to=${DAY_D_PLUS_1}`)
        .set('Authorization', `Bearer ${ctx.tokens.admin}`);
      const byDay = tips.body.data.byDay as Array<{ date: string; tipCents: number }>;
      expect(byDay[0]!.tipCents).toBe(0);
      expect(byDay[1]!.tipCents).toBe(700);
    });
  });
});
