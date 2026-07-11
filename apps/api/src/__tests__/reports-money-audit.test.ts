import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { PaymentType } from '@restoran-pos/shared-types';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Derin Denetim Blok 7 (Hat B) — reports agregasyon PARA doğruluğu (GREEN).
 *
 * Kapsam: apps/api/src/routes/reports/{daily-close-aggregate,category-sales,
 * average-bill,order-count,payment-distribution,top-selling,closed-orders,
 * user-performance,anomalies,recent-orders,today-revenue}.ts — void/iptal/
 * merged sızıntısı + integer para invariantı.
 *
 * Devir (Blok 5, PAY-02 [HIGH]): 'merged' order'a phantom ödeme oluşabiliyor
 * (payments.ts terminal-guard 'paid|cancelled|void' — 'merged' HARİÇ).
 * R7-AGG-06 bu phantom ödemenin rapor katmanına SIZMADIĞINI kanıtlar —
 * `orders.status='paid'` filtresi her yerde 'merged'i zaten dışlıyor
 * (bağımsız ikinci savunma hattı, PAY-02 fix'inden bağımsız).
 *
 * Devir (ADR-033 "kör nokta"): rapor SUM(payments) siteleri kod okumasıyla
 * teyit edildi — daily-close-aggregate (payment breakdown + hourly),
 * payment-distribution, closed-orders (paid_at + type mix), user-performance
 * (cashier) ZATEN `voided_at IS NULL` filtreli. R7-AGG-01/02/09 bu korumanın
 * GERÇEKTEN iş yaptığını (dekoratif değil) canlı kanıtlar.
 *
 * Her `it` kendi İZOLE tenant'ını `setupTenant()` ile kurar — aggregate
 * endpoint'ler (today-revenue, payment-distribution, daily-close,
 * average-bill) tüm tenant'ın "bugün" verisini topladığı için mutlak-değer
 * assertion'ları testler-arası izolasyon gerektirir.
 *
 * Prod kod DEĞİŞTİRİLMEDİ. Mevcut testler DEĞİŞTİRİLMEDİ. Fixture deseni
 * payments-void.test.ts / payments-money.findings.test.ts ile birebir aynı
 * (E2E_BYPASS_LOGIN_LIMIT + FK-cleanup sırası + pool.end).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const PRICE = 5000; // "Adana Kebap" — 50,00 TL (kuruş)

interface Env {
  tenantId: string;
  app: Express;
  adminId: string;
  adminToken: string;
  cashierId: string;
  cashierToken: string;
  areaId: string;
  categoryId: string;
  productId: string;
}

interface Shared {
  pool?: Pool;
  db?: Kysely<DB>;
  prevBypass?: string | undefined;
}

const shared: Shared = {};
const tenantIds: string[] = [];

async function login(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

/** İzole tenant + admin/cashier + area/category/product ("Adana Kebap", 5000 kuruş). */
async function setupTenant(label: string): Promise<Env> {
  const db = shared.db!;
  const tenantId = randomUUID();
  tenantIds.push(tenantId);

  const adminId = randomUUID();
  const cashierId = randomUUID();
  const areaId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();

  const app = buildApp({
    pool: shared.pool!,
    db,
    accessSecret: ACCESS_SECRET,
    agentSecret: 'test-agent-secret-min-32-chars-please-long',
    tenantId,
    webOrigin: 'http://localhost:5173',
  });

  await db
    .insertInto('tenants')
    .values({ id: tenantId, name: `R7B ${label}`, slug: `t-r7b-${tenantId.slice(0, 8)}` })
    .onConflict((oc) => oc.doNothing())
    .execute();
  await db
    .insertInto('tenant_settings')
    .values({ tenant_id: tenantId })
    .onConflict((oc) => oc.doNothing())
    .execute();

  const [adminHash, cashierHash] = await Promise.all([
    hashPassword('adminpass1234'),
    hashPassword('cashierpass1234'),
  ]);
  const adminEmail = `admin-r7b-${randomUUID().slice(0, 8)}@example.com`;
  const cashierEmail = `cashier-r7b-${randomUUID().slice(0, 8)}@example.com`;
  await db
    .insertInto('users')
    .values([
      {
        id: adminId,
        tenant_id: tenantId,
        email: adminEmail,
        username: `admin-r7b-${randomUUID().slice(0, 6)}`,
        password_hash: adminHash,
        role: 'admin',
      },
      {
        id: cashierId,
        tenant_id: tenantId,
        email: cashierEmail,
        username: `cashier-r7b-${randomUUID().slice(0, 6)}`,
        password_hash: cashierHash,
        role: 'cashier',
      },
    ])
    .execute();

  await db.insertInto('areas').values({ id: areaId, tenant_id: tenantId, name: 'Salon' }).execute();
  await db
    .insertInto('categories')
    .values({ id: categoryId, tenant_id: tenantId, name: 'Ana Yemekler' })
    .execute();
  await db
    .insertInto('products')
    .values({
      id: productId,
      tenant_id: tenantId,
      category_id: categoryId,
      name: 'Adana Kebap',
      price_cents: PRICE,
      is_active: true,
    })
    .execute();

  const [adminToken, cashierToken] = await Promise.all([
    login(app, adminEmail, 'adminpass1234'),
    login(app, cashierEmail, 'cashierpass1234'),
  ]);

  return { tenantId, app, adminId, adminToken, cashierId, cashierToken, areaId, categoryId, productId };
}

async function insertTable(env: Env): Promise<string> {
  const id = randomUUID();
  await shared
    .db!.insertInto('tables')
    .values({
      id,
      tenant_id: env.tenantId,
      code: `M-R7B-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: env.areaId,
    })
    .execute();
  return id;
}

async function createDineInOrder(env: Env, token: string, tableId: string, qty = 1): Promise<string> {
  const res = await request(env.app)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ tableId, orderType: 'dine_in', items: [{ productId: env.productId, quantity: qty }] });
  if (res.status !== 201) {
    throw new Error(`order create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.order.id as string;
}

function payOrder(
  env: Env,
  token: string,
  orderId: string,
  amountCents: number,
  opts: { paymentType?: PaymentType; operation?: 'pay' | 'pay_and_close'; tipAmountCents?: number } = {},
) {
  return request(env.app)
    .post('/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      orderId,
      paymentType: opts.paymentType ?? 'cash',
      paymentScope: 'full',
      amountCents,
      idempotencyKey: randomUUID(),
      operation: opts.operation ?? 'pay_and_close',
      ...(opts.tipAmountCents !== undefined ? { tipAmountCents: opts.tipAmountCents } : {}),
    });
}

async function payAndClose(
  env: Env,
  token: string,
  orderId: string,
  amountCents: number,
  paymentType: PaymentType = 'cash',
): Promise<string> {
  const res = await payOrder(env, token, orderId, amountCents, { paymentType, operation: 'pay_and_close' });
  if (res.status !== 201) {
    throw new Error(`payAndClose failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.payment.id as string;
}

function voidPayment(env: Env, token: string, paymentId: string, reasonCode = 'wrong_amount') {
  return request(env.app)
    .post(`/payments/${paymentId}/void`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reasonCode });
}

function cancelOrderApi(env: Env, token: string, orderId: string) {
  return request(env.app).patch(`/orders/${orderId}`).set('Authorization', `Bearer ${token}`).send({ status: 'cancelled' });
}

function mergeOrderApi(env: Env, token: string, sourceOrderId: string, targetTableId: string) {
  return request(env.app)
    .post(`/orders/${sourceOrderId}/merge`)
    .set('Authorization', `Bearer ${token}`)
    .send({ targetTableId });
}

async function orderRow(env: Env, orderId: string): Promise<{ status: string; total_cents: number }> {
  return shared
    .db!.selectFrom('orders')
    .select(['status', 'total_cents'])
    .where('tenant_id', '=', env.tenantId)
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
}

function getReport(env: Env, token: string, path: string) {
  return request(env.app).get(path).set('Authorization', `Bearer ${token}`);
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Blok 7 Hat B — reports agregasyon para doğruluğu (audit, GREEN)',
  () => {
    beforeAll(async () => {
      shared.prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';
      shared.pool = createPool({ connectionString: DB_URL! });
      shared.db = createKysely(shared.pool);
    });

    afterAll(async () => {
      const db = shared.db;
      if (db !== undefined) {
        for (const tenantId of tenantIds) {
          await db.deleteFrom('payment_items').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('payments').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('order_item_attributes').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('order_no_counters').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('audit_logs').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('products').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('categories').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('tables').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('areas').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('refresh_tokens').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('tenant_settings').where('tenant_id', '=', tenantId).execute();
          await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
        }
      }
      if (shared.prevBypass === undefined) delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      else process.env['E2E_BYPASS_LOGIN_LIMIT'] = shared.prevBypass;
      await shared.pool?.end();
    });

    it('R7-AGG-01: ödeme void edilince today-revenue/payment-distribution/daily-close ciroda GÖRÜNMEZ olur', async () => {
      const env = await setupTenant('void-basic');
      const tableId = await insertTable(env);
      const orderId = await createDineInOrder(env, env.adminToken, tableId, 1);
      const paymentId = await payAndClose(env, env.adminToken, orderId, PRICE, 'cash');

      const revBefore = await getReport(env, env.adminToken, '/reports/kpi/today-revenue');
      expect(revBefore.body.data.totalRevenueCents).toBe(PRICE);
      const distBefore = await getReport(env, env.adminToken, '/reports/payment-distribution');
      expect(distBefore.body.data.totalCents).toBe(PRICE);
      const closeBefore = await getReport(env, env.adminToken, '/reports/daily-close');
      expect(closeBefore.body.data.totalRevenueCents).toBe(PRICE);

      const voidRes = await voidPayment(env, env.adminToken, paymentId, 'wrong_amount');
      expect(voidRes.status).toBe(200);
      const reopened = await orderRow(env, orderId);
      expect(reopened.status).toBe('open'); // K3 atomik auto-reopen (ADR-033)

      const revAfter = await getReport(env, env.adminToken, '/reports/kpi/today-revenue');
      expect(revAfter.body.data.totalRevenueCents).toBe(0);
      const distAfter = await getReport(env, env.adminToken, '/reports/payment-distribution');
      expect(distAfter.body.data.totalCents).toBe(0);
      expect(distAfter.body.data.segments).toEqual([]);
      const closeAfter = await getReport(env, env.adminToken, '/reports/daily-close');
      expect(closeAfter.body.data.totalRevenueCents).toBe(0);
      expect(closeAfter.body.data.paymentBreakdown).toEqual([]);
    });

    it('R7-AGG-02: void + aynı gün yeniden ödeme → voided satır ÇİFT SAYILMAZ (voided_at IS NULL filtresi gerçek iş yapıyor)', async () => {
      const env = await setupTenant('void-reclose');
      const tableId = await insertTable(env);
      const orderId = await createDineInOrder(env, env.adminToken, tableId, 1);
      const p1 = await payAndClose(env, env.adminToken, orderId, PRICE, 'cash');
      const voidRes = await voidPayment(env, env.adminToken, p1, 'wrong_payment_type');
      expect(voidRes.status).toBe(200);
      await payAndClose(env, env.adminToken, orderId, PRICE, 'card');

      // BUG olsaydı (voided_at filtresi yok): cash(voided,5000) + card(5000) = 10000.
      // Doğru (mevcut kod): sadece card 5000.
      const dist = await getReport(env, env.adminToken, '/reports/payment-distribution');
      expect(dist.body.data.totalCents).toBe(PRICE);
      const cashSeg = dist.body.data.segments.find((s: { paymentType: string }) => s.paymentType === 'cash');
      const cardSeg = dist.body.data.segments.find((s: { paymentType: string }) => s.paymentType === 'card');
      expect(cashSeg).toBeUndefined();
      expect(cardSeg.totalCents).toBe(PRICE);

      const close = await getReport(env, env.adminToken, '/reports/daily-close');
      const closePaymentTotal = close.body.data.paymentBreakdown.reduce(
        (s: number, p: { amountCents: number }) => s + p.amountCents,
        0,
      );
      expect(closePaymentTotal).toBe(PRICE);

      const closedOrders = await getReport(env, env.adminToken, '/reports/closed-orders');
      const row = closedOrders.body.data.orders.find((o: { orderId: string }) => o.orderId === orderId);
      expect(row.paymentTypeMix).toEqual(['card']);
      expect(row.totalCents).toBe(PRICE);
    });

    it("R7-AGG-03: iptal edilmiş sipariş order-count/category-sales/top-selling/today-revenue/average-bill/closed-orders/recent-orders'a GİRMEZ", async () => {
      const env = await setupTenant('cancel-scope');
      const tableId = await insertTable(env);
      const orderId = await createDineInOrder(env, env.adminToken, tableId, 1);
      const cancelRes = await cancelOrderApi(env, env.adminToken, orderId);
      expect(cancelRes.status).toBe(200);

      const rev = await getReport(env, env.adminToken, '/reports/kpi/today-revenue');
      expect(rev.body.data.totalRevenueCents).toBe(0);
      expect(rev.body.data.paidOrderCount).toBe(0);

      const count = await getReport(env, env.adminToken, '/reports/kpi/order-count');
      expect(count.body.data.byStatus).toEqual({ open: 0, paid: 0, cancelled: 1 });
      expect(count.body.data.totalOrders).toBe(0);

      const avg = await getReport(env, env.adminToken, '/reports/kpi/average-bill');
      expect(avg.body.data.sampleSize).toBe(0);
      expect(avg.body.data.averageBillCents).toBe(0);

      const cat = await getReport(env, env.adminToken, '/reports/category-sales');
      for (const c of cat.body.data.categories as Array<{ revenueCents: number; qty: number }>) {
        expect(c.revenueCents).toBe(0);
        expect(c.qty).toBe(0);
      }

      const top = await getReport(env, env.adminToken, '/reports/top-selling');
      expect(top.body.data.items).toEqual([]);

      const closedOrders = await getReport(env, env.adminToken, '/reports/closed-orders');
      expect(closedOrders.body.data.orders).toEqual([]);
      expect(closedOrders.body.data.totalClosedCount).toBe(0);

      const recent = await getReport(env, env.adminToken, '/reports/recent-orders');
      expect(recent.body.data.orders).toEqual([]);
      expect(recent.body.data.totalOpenCount).toBe(0);
    });

    it('R7-AGG-04: average-bill integer floor bölme — float sızıntısı yok', async () => {
      const env = await setupTenant('avg-floor');
      const tableId1 = await insertTable(env);
      const tableId2 = await insertTable(env);
      const tableId3 = await insertTable(env);
      const o1 = await createDineInOrder(env, env.adminToken, tableId1, 2); // 10000
      const o2 = await createDineInOrder(env, env.adminToken, tableId2, 2); // 10000
      const o3 = await createDineInOrder(env, env.adminToken, tableId3, 1); // 5000
      await payAndClose(env, env.adminToken, o1, PRICE * 2);
      await payAndClose(env, env.adminToken, o2, PRICE * 2);
      await payAndClose(env, env.adminToken, o3, PRICE);
      // Toplam 25000 / 3 = 8333.333... → floor = 8333 (float DEĞİL).

      const avg = await getReport(env, env.adminToken, '/reports/kpi/average-bill');
      expect(avg.body.data.sampleSize).toBe(3);
      expect(avg.body.data.averageBillCents).toBe(8333);
      expect(Number.isInteger(avg.body.data.averageBillCents)).toBe(true);
      expect(25000 / 3).not.toBe(8333); // JS float bölme kontrastı (8333.333333333334)
    });

    it('R7-AGG-05: bilinen veri seti → daily-close para invariantı (2 cash + 1 card paid, 1 cancelled, 1 open)', async () => {
      const env = await setupTenant('daily-close-invariant');
      const cash1Table = await insertTable(env);
      const cash2Table = await insertTable(env);
      const cardTable = await insertTable(env);
      const cancelledTable = await insertTable(env);
      const openTable = await insertTable(env);

      const cash1 = await createDineInOrder(env, env.adminToken, cash1Table, 1);
      const cash2 = await createDineInOrder(env, env.adminToken, cash2Table, 1);
      const cardOrder = await createDineInOrder(env, env.adminToken, cardTable, 1);
      const cancelledOrder = await createDineInOrder(env, env.adminToken, cancelledTable, 1);
      await createDineInOrder(env, env.adminToken, openTable, 1); // açık kalır

      await payAndClose(env, env.adminToken, cash1, PRICE, 'cash');
      await payAndClose(env, env.adminToken, cash2, PRICE, 'cash');
      await payAndClose(env, env.adminToken, cardOrder, PRICE, 'card');
      await cancelOrderApi(env, env.adminToken, cancelledOrder);

      const close = await getReport(env, env.adminToken, '/reports/daily-close');
      const d = close.body.data;
      expect(d.totalRevenueCents).toBe(PRICE * 3); // 15000 — yalnız 3 paid order
      expect(d.orderCount).toBe(3);
      expect(d.avgBillCents).toBe(PRICE); // 15000/3 tam bölünüyor = 5000
      const cash = d.paymentBreakdown.find((p: { paymentType: string }) => p.paymentType === 'cash');
      const card = d.paymentBreakdown.find((p: { paymentType: string }) => p.paymentType === 'card');
      expect(cash.amountCents).toBe(PRICE * 2);
      expect(cash.count).toBe(2);
      expect(card.amountCents).toBe(PRICE);
      expect(card.count).toBe(1);
      expect(d.anomalySummary.cancelCount).toBe(1);
      expect(d.anomalySummary.totalLossCents).toBe(PRICE); // tek iptal, comp yok → temiz
      const hourlyTotal = d.hourlyBuckets.reduce((s: number, b: { revenueCents: number }) => s + b.revenueCents, 0);
      expect(hourlyTotal).toBe(PRICE * 3);
      const cat = d.topCategories.find((c: { categoryId: string }) => c.categoryId === env.categoryId);
      expect(cat.revenueCents).toBe(PRICE * 3);
      expect(cat.qty).toBe(3);

      // Çapraz doğrulama — standalone endpoint'ler daily-close ile AYNI sonucu vermeli.
      const rev = await getReport(env, env.adminToken, '/reports/kpi/today-revenue');
      expect(rev.body.data.totalRevenueCents).toBe(d.totalRevenueCents);
      const cnt = await getReport(env, env.adminToken, '/reports/kpi/order-count');
      expect(cnt.body.data.totalOrders).toBe(d.orderCount);
      const avg = await getReport(env, env.adminToken, '/reports/kpi/average-bill');
      expect(avg.body.data.averageBillCents).toBe(d.avgBillCents);
      const dist = await getReport(env, env.adminToken, '/reports/payment-distribution');
      expect(dist.body.data.totalCents).toBe(d.totalRevenueCents);
    });

    it('R7-AGG-06: PAY-02 phantom ödeme (merged order) ciroya SIZMIYOR (Blok 5 devir kapanışı)', async () => {
      const env = await setupTenant('pay02-phantom');
      const sourceTableId = await insertTable(env);
      const targetTableId = await insertTable(env);
      const sourceOrderId = await createDineInOrder(env, env.adminToken, sourceTableId, 1);
      await createDineInOrder(env, env.adminToken, targetTableId, 1); // hedef masa DOLU olmalı (merge ön-koşulu)

      const merge = await mergeOrderApi(env, env.adminToken, sourceOrderId, targetTableId);
      expect(merge.status).toBe(200);
      const merged = await orderRow(env, sourceOrderId);
      expect(merged.status).toBe('merged');
      expect(merged.total_cents).toBe(0);

      const phantom = await payOrder(env, env.adminToken, sourceOrderId, PRICE, { operation: 'pay' });

      if (phantom.status === 201) {
        // PAY-02 (Blok 5, HIGH) BUGÜN canlı: payments.ts terminal-guard 'merged'i
        // dışlamıyor → phantom kayıt oluşuyor. Asıl soru: bu kayıt CİROYA sızıyor mu?
        const rev = await getReport(env, env.adminToken, '/reports/kpi/today-revenue');
        expect(rev.body.data.totalRevenueCents).toBe(0);
        const dist = await getReport(env, env.adminToken, '/reports/payment-distribution');
        expect(dist.body.data.totalCents).toBe(0);
        expect(dist.body.data.segments).toEqual([]);
        const close = await getReport(env, env.adminToken, '/reports/daily-close');
        expect(close.body.data.totalRevenueCents).toBe(0);
        expect(close.body.data.paymentBreakdown).toEqual([]);
      } else {
        // PAY-02 fix'lendiyse (merged artık reddediliyor) sızacak phantom kayıt yok.
        expect(phantom.status).toBe(409);
      }
    });

    it('R7-AGG-07: tip_amount_cents ciroya DAHİL EDİLMEZ (bahşiş ≠ ciro, ADR-015 Karar 8)', async () => {
      const env = await setupTenant('tip-exclusion');
      const tableId = await insertTable(env);
      const orderId = await createDineInOrder(env, env.adminToken, tableId, 1);
      const res = await payOrder(env, env.adminToken, orderId, PRICE, {
        operation: 'pay_and_close',
        tipAmountCents: 1000,
      });
      expect(res.status).toBe(201);

      const rev = await getReport(env, env.adminToken, '/reports/kpi/today-revenue');
      expect(rev.body.data.totalRevenueCents).toBe(PRICE); // 5000, 6000 DEĞİL
      const dist = await getReport(env, env.adminToken, '/reports/payment-distribution');
      expect(dist.body.data.totalCents).toBe(PRICE);
      const close = await getReport(env, env.adminToken, '/reports/daily-close');
      expect(close.body.data.totalRevenueCents).toBe(PRICE);
    });

    it("R7-AGG-08: kalem-düzeyi iptal (adisyon paid, tek kalem iptal) category-sales/top-selling'e GİRMEZ", async () => {
      const env = await setupTenant('item-cancel-scope');
      const tableId = await insertTable(env);
      const createRes = await request(env.app)
        .post('/orders')
        .set('Authorization', `Bearer ${env.adminToken}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [
            { productId: env.productId, quantity: 1 }, // A
            { productId: env.productId, quantity: 1 }, // B
          ],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.order.id as string;
      const itemAId = createRes.body.data.items[0].id as string;

      const cancelItem = await request(env.app)
        .patch(`/orders/${orderId}/items/${itemAId}`)
        .set('Authorization', `Bearer ${env.adminToken}`)
        .send({ status: 'cancelled' });
      expect(cancelItem.status).toBe(200);
      const afterCancel = await orderRow(env, orderId);
      expect(afterCancel.total_cents).toBe(PRICE); // temiz recalc (yalnız cancel, MONEY-01 tetiklenmedi)

      await payAndClose(env, env.adminToken, orderId, PRICE);

      const cat = await getReport(env, env.adminToken, '/reports/category-sales');
      const row = cat.body.data.categories.find((c: { categoryId: string }) => c.categoryId === env.categoryId);
      expect(row.qty).toBe(1);
      expect(row.revenueCents).toBe(PRICE);

      const top = await getReport(env, env.adminToken, '/reports/top-selling');
      expect(top.body.data.items[0].totalQuantity).toBe(1);
      expect(top.body.data.items[0].totalRevenueCents).toBe(PRICE);
    });

    it('R7-AGG-09: user-performance — void sonrası kasiyer cirosu doğru atfediliyor (çift sayım yok)', async () => {
      const env = await setupTenant('user-perf-void');
      const tableId = await insertTable(env);
      const orderId = await createDineInOrder(env, env.cashierToken, tableId, 1);
      const p1 = await payAndClose(env, env.cashierToken, orderId, PRICE, 'cash');

      type PerfRow = { userId: string; revenueCents: number; orderCount: number };
      let perf = await getReport(env, env.adminToken, '/reports/user-performance?role=cashier');
      let row: PerfRow | undefined = perf.body.data.users.find((u: PerfRow) => u.userId === env.cashierId);
      expect(row?.revenueCents).toBe(PRICE);
      expect(row?.orderCount).toBe(1);

      const voidRes = await voidPayment(env, env.adminToken, p1, 'wrong_amount');
      expect(voidRes.status).toBe(200);

      perf = await getReport(env, env.adminToken, '/reports/user-performance?role=cashier');
      row = perf.body.data.users.find((u: PerfRow) => u.userId === env.cashierId);
      expect(row).toBeUndefined(); // hiç geçerli ödemesi kalmadı → grup satırı hiç dönmez

      await payAndClose(env, env.cashierToken, orderId, PRICE, 'card');
      perf = await getReport(env, env.adminToken, '/reports/user-performance?role=cashier');
      row = perf.body.data.users.find((u: PerfRow) => u.userId === env.cashierId);
      expect(row?.revenueCents).toBe(PRICE); // 10000 DEĞİL — voided satır çift sayılmadı
      expect(row?.orderCount).toBe(1);
    });
  },
);
