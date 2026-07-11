import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Derin Denetim Blok 7 (Hat B) — reports agregasyon PARA doğruluğu (KIRMIZI).
 *
 * Bu dosyadaki testler BUGÜNKÜ (buggy) davranışla ÇALIŞIR — yani DOĞRU/
 * beklenen davranışı assert eder ve BUGÜN KIRMIZI (fail) döner. Fix
 * geldiğinde yeşile döner ve regresyon kilidi olarak kalır.
 *
 * R7-AGG-10 [HIGH] — `anomalies.ts` comp+cancel double-count: bir kalem
 * ikram (is_comped=true) edilip SONRA adisyonun TAMAMI iptal edilirse,
 * `totalLossCents` o kalemin tutarını İKİ KEZ sayar (cancelVoidLoss'ta ORDER
 * bazında ALL items + compLoss'ta is_comped bazında AYNI item tekrar).
 *
 * R7-AGG-11 [HIGH, MONEY-01 türevi] — kök neden Blok 5 BLOCKER MONEY-01
 * (`insertItemsAndRecalc` iptal edilmiş kalemi dışlamıyor, PR bekliyor).
 * Bu test MONEY-01'in RAPOR KATMANINA yansımasını kanıtlar: today-revenue
 * (orders.total_cents bazlı, MONEY-01 ile şişer) ile category-sales
 * (order_items bazlı, cancelled kalemi doğru dışlar) arasında tutarsızlık
 * oluşur. Severity burada HIGH (BLOCKER olarak yeniden ilan edilmiyor —
 * kök neden zaten Blok 5/13'te BLOCKER); katkısı: "MONEY-01 fix'i bu rapor
 * tutarsızlığını da otomatik çözer" bilgisini doğrulamak.
 *
 * Prod kod DEĞİŞTİRİLMEDİ. Fixture deseni reports-money-audit.test.ts /
 * payments-money.findings.test.ts ile birebir aynı.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const PRICE = 5000; // "Adana Kebap" — 50,00 TL (kuruş)

interface Env {
  tenantId: string;
  app: Express;
  adminId: string;
  adminToken: string;
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

/** İzole tenant + admin + area/category/product ("Adana Kebap", 5000 kuruş). */
async function setupTenant(label: string): Promise<Env> {
  const db = shared.db!;
  const tenantId = randomUUID();
  tenantIds.push(tenantId);

  const adminId = randomUUID();
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
    .values({ id: tenantId, name: `R7B Findings ${label}`, slug: `t-r7bf-${tenantId.slice(0, 8)}` })
    .onConflict((oc) => oc.doNothing())
    .execute();
  await db
    .insertInto('tenant_settings')
    .values({ tenant_id: tenantId })
    .onConflict((oc) => oc.doNothing())
    .execute();

  const adminHash = await hashPassword('adminpass1234');
  const adminEmail = `admin-r7bf-${randomUUID().slice(0, 8)}@example.com`;
  await db
    .insertInto('users')
    .values({
      id: adminId,
      tenant_id: tenantId,
      email: adminEmail,
      username: `admin-r7bf-${randomUUID().slice(0, 6)}`,
      password_hash: adminHash,
      role: 'admin',
    })
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

  const adminToken = await login(app, adminEmail, 'adminpass1234');

  return { tenantId, app, adminId, adminToken, areaId, categoryId, productId };
}

async function insertTable(env: Env): Promise<string> {
  const id = randomUUID();
  await shared
    .db!.insertInto('tables')
    .values({
      id,
      tenant_id: env.tenantId,
      code: `M-R7BF-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: env.areaId,
    })
    .execute();
  return id;
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
  'Blok 7 Hat B — reports agregasyon para doğruluğu (findings, KASITLI KIRMIZI)',
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

    // ─── R7-AGG-10 [HIGH] ───────────────────────────────────────────────────
    it('R7-AGG-10: anomalies.ts ikram+iptal aynı kalemde İKİ KEZ sayılıyor (comp+cancel double-count)', async () => {
      const env = await setupTenant('anomaly-comp-cancel');
      const tableId = await insertTable(env);

      const createRes = await request(env.app)
        .post('/orders')
        .set('Authorization', `Bearer ${env.adminToken}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [
            { productId: env.productId, quantity: 1 }, // X — ikram edilecek
            { productId: env.productId, quantity: 1 }, // Y — normal
          ],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.order.id as string;
      const itemXId = createRes.body.data.items[0].id as string;

      // X'i ikram et (is_comped=true) — ADR-013 §9.2, admin/cashier.
      const compRes = await request(env.app)
        .patch(`/orders/${orderId}/items/${itemXId}`)
        .set('Authorization', `Bearer ${env.adminToken}`)
        .send({ isComped: true });
      expect(compRes.status).toBe(200);

      // Adisyonun TAMAMI iptal edilir (müşteri gelmedi/vazgeçti — X ikram
      // edilmişti ama Y de dahil tüm adisyon boşa gitti).
      const cancelRes = await request(env.app)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${env.adminToken}`)
        .send({ status: 'cancelled' });
      expect(cancelRes.status).toBe(200);
      const cancelled = await orderRow(env, orderId);
      expect(cancelled.status).toBe('cancelled');

      const anomalies = await getReport(env, env.adminToken, '/reports/anomalies');
      const s = anomalies.body.data.summary;

      // BEKLENEN (para invariantı — gerçek kayıp, iki kez sayılmamalı):
      // Adisyonun toplam değeri X(5000) + Y(5000) = 10000 idi; tamamı boşa
      // gitti → gerçek kayıp 10000 (X'in ikram OLMASI, kaybın büyüklüğünü
      // DEĞİŞTİRMEZ — zaten hiç tahsil edilmeyecekti).
      // BUGÜN: cancelVoidLoss (orders.status IN cancelled/void → TÜM
      // order_items, filtre yok) = X+Y = 10000, AYRICA compLoss
      // (order_items.is_comped=true, order status'tan bağımsız) = X = 5000
      // tekrar eklenir → totalLossCents = 15000 (KIRMIZI).
      expect(s.totalLossCents).toBe(PRICE * 2);
    });

    // ─── R7-AGG-11 [HIGH, MONEY-01 türevi] ─────────────────────────────────
    it('R7-AGG-11: MONEY-01 (Blok 5 BLOCKER) rapor katmanına sızıyor — today-revenue ile category-sales TUTARSIZ', async () => {
      const env = await setupTenant('money01-report-blast-radius');
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
      expect(createRes.body.data.order.total_cents).toBe(PRICE * 2); // 10000

      // A'yı iptal et → total_cents 5000'e düşer (updateItemTx recalc — temiz).
      const cancelItem = await request(env.app)
        .patch(`/orders/${orderId}/items/${itemAId}`)
        .set('Authorization', `Bearer ${env.adminToken}`)
        .send({ status: 'cancelled' });
      expect(cancelItem.status).toBe(200);
      const afterCancel = await orderRow(env, orderId);
      expect(afterCancel.total_cents).toBe(PRICE); // kontrol noktası — bu adım doğru

      // Yeni kalem C ekle (5000) → MONEY-01: insertItemsAndRecalc SUM'ı
      // status filtresi OLMADAN hesaplıyor → A (cancelled, 5000) yeniden
      // toplama girer → total_cents 15000 olur (doğrusu B+C=10000).
      const addItem = await request(env.app)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${env.adminToken}`)
        .send({ items: [{ productId: env.productId, quantity: 1 }] }); // C
      expect(addItem.status).toBe(200);
      const afterAdd = await orderRow(env, orderId);
      expect(afterAdd.total_cents).toBe(PRICE * 3); // MONEY-01 canlı kanıt (15000)

      // Kapatmak için mevcut (şişmiş) order.total_cents kadar ödeme gerekir
      // (close-invariant tam eşitlik, ADR-014 §12) — restoran müşteriye
      // iptal edilen A için de para tahsil eder (MONEY-01'in gerçek etkisi).
      const pay = await request(env.app)
        .post('/payments')
        .set('Authorization', `Bearer ${env.adminToken}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: PRICE * 3,
          idempotencyKey: randomUUID(),
          operation: 'pay_and_close',
        });
      expect(pay.status).toBe(201);

      const rev = await getReport(env, env.adminToken, '/reports/kpi/today-revenue');
      const cat = await getReport(env, env.adminToken, '/reports/category-sales');
      const catGrandTotal = (cat.body.data.categories as Array<{ revenueCents: number }>).reduce(
        (s, c) => s + c.revenueCents,
        0,
      );

      // BEKLENEN (rapor-düzeyi para invariantı — order.total ↔ SUM(items)
      // tutarlı olmalı): today-revenue (orders.total_cents bazlı) ile
      // category-sales (order_items bazlı, cancelled A doğru dışlanmış:
      // B+C=10000) AYNI toplamı vermeli.
      // BUGÜN: today-revenue=15000 (MONEY-01 şişmesi) ≠ category-sales
      // toplamı=10000 → rapor katmanları TUTARSIZ (KIRMIZI). Kök neden
      // MONEY-01 fix'lenince (recalc'a status!='cancelled' filtresi)
      // otomatik yeşile döner.
      expect(rev.body.data.totalRevenueCents).toBe(catGrandTotal);
    });
  },
);
