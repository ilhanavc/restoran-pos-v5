/**
 * ADR-027 Amendment 2 K2/K3/K4 — kanonik adisyon iptali:
 * yetki genişlemesi + PARA KAPISI + `merged` terminal statü.
 *
 * ASIL SÖZLEŞME: aktif ödemesi olan adisyon HİÇ KİMSE tarafından iptal
 * edilemez (admin dahil). Bu kontrol ÖNCEDEN YOKTU ve sessiz bir açıktı:
 * kısmen ödenmiş adisyon iptal edilince `orders.total_cents = 0` yazılıyor ama
 * `payments` satırları yerinde kalıyordu → tahsil edilen para adisyonsuz
 * kalıyor, raporlarda kaybolmuş görünüyordu.
 *
 * Fix'siz-kırmızı: para kapısı olmadan 2. test 200 döner (iptal başarılı olur)
 * ve `ORDER_HAS_PAYMENTS` beklentisi kırmızıya düşer.
 *
 * Yalnız lokal pos_test (DATABASE_URL yoksa skip).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const WAITER_ID = randomUUID();
const SUFFIX = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `admin-cpg-${SUFFIX}@example.com`;
const WAITER_EMAIL = `waiter-cpg-${SUFFIX}@example.com`;
const PASSWORD = 'guardpass1234';
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 15000;
/** Paket siparişte DB kısıtı müşteri zorunlu kılıyor. */
const CUSTOMER_ID = randomUUID();

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Adisyon iptali — yetki + para kapısı (ADR-027 Amd2)',
  () => {
    let pool: Pool;
    let db: Kysely<DB>;
    let app: Express;
    let adminToken: string;
    let waiterToken: string;
    let prevBypass: string | undefined;
    /**
     * Her testin KENDİ masasını açar — aynı masaya iki açık adisyon olamaz
     * (masa-çakışması); testler böyle birbirinden bağımsız kalır.
     */
    async function makeTable(label: string): Promise<string> {
      const id = randomUUID();
      await db
        .insertInto('tables')
        .values({
          id,
          tenant_id: TENANT_ID,
          code: `M-${label}-${SUFFIX}`,
          capacity: 4,
        })
        .execute();
      return id;
    }

    /** Masaya 1 kalemlik dine-in adisyon açar, order id döner. */
    async function openOrder(tableId: string, token: string): Promise<string> {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [{ productId: PRODUCT_ID, quantity: 2 }],
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      // POST /orders yanıtı nested: { data: { order, items } } (dine-in dalı).
      return (res.body as { data: { order: { id: string } } }).data.order.id;
    }

    beforeAll(async () => {
      prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';
      pool = createPool({ connectionString: DB_URL! });
      db = createKysely(pool);
      app = buildApp({
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
          name: 'CancelGuard Tenant',
          slug: `cpg-t-${SUFFIX}`,
        })
        .execute();
      await db.insertInto('tenant_settings').values({ tenant_id: TENANT_ID }).execute();
      const passwordHash = await hashPassword(PASSWORD);
      await db
        .insertInto('users')
        .values([
          {
            id: ADMIN_ID,
            tenant_id: TENANT_ID,
            email: ADMIN_EMAIL,
            username: `admin-cpg-${SUFFIX.slice(0, 6)}`,
            password_hash: passwordHash,
            role: 'admin',
          },
          {
            id: WAITER_ID,
            tenant_id: TENANT_ID,
            email: WAITER_EMAIL,
            username: `waiter-cpg-${SUFFIX.slice(0, 6)}`,
            password_hash: passwordHash,
            role: 'waiter',
          },
        ])
        .execute();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_ID,
          tenant_id: TENANT_ID,
          full_name: 'Paket Müşterisi',
          is_blacklisted: false,
        })
        .execute();
      await db
        .insertInto('categories')
        .values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Pideler' })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Kaşarlı Pide',
          price_cents: PRODUCT_PRICE,
        })
        .execute();

      const adminLogin = await request(app)
        .post('/auth/login')
        .send({ email: ADMIN_EMAIL, password: PASSWORD });
      adminToken = (adminLogin.body as { accessToken: string }).accessToken;
      const waiterLogin = await request(app)
        .post('/auth/login')
        .send({ email: WAITER_EMAIL, password: PASSWORD });
      waiterToken = (waiterLogin.body as { accessToken: string }).accessToken;
      expect(adminToken).toBeTruthy();
      expect(waiterToken).toBeTruthy();
    });

    afterAll(async () => {
      await db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
      await db
        .deleteFrom('order_item_attributes')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
      await db
        .deleteFrom('order_no_counters')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      // `db.destroy()` altındaki havuzu zaten kapatır; ayrıca `pool.end()`
      // çağırmak "Called end on pool more than once" ile teardown'ı patlatır
      // (testler geçse bile dosya FAIL görünür).
      await db.destroy();
      if (prevBypass === undefined) delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      else process.env['E2E_BYPASS_LOGIN_LIMIT'] = prevBypass;
    });

    // ---- K2: yetki genişlemesi -------------------------------------------

    it('GARSON ödemesiz adisyonu iptal edebilir (K2 — eskiden admin-only idi)', async () => {
      const tableId = await makeTable('W1');
      const orderId = await openOrder(tableId, waiterToken);

      const res = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'customer_left' });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await db
        .selectFrom('orders')
        .select(['status', 'total_cents'])
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('cancelled');
      expect(row.total_cents).toBe(0);
    });

    // ---- K3: para kapısı (ASIL SÖZLEŞME) ---------------------------------

    it('AKTİF ödemesi olan adisyon İPTAL EDİLEMEZ — garson', async () => {
      const tableId = await makeTable('W2');
      const orderId = await openOrder(tableId, waiterToken);
      await db
        .insertInto('payments')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          order_id: orderId,
          amount_cents: 10000,
          payment_type: 'cash',
          payment_scope: 'partial',
          idempotency_key: randomUUID(),
          created_by_user_id: WAITER_ID,
        })
        .execute();

      const res = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'customer_left' });

      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'ORDER_HAS_PAYMENTS',
      );
      // Adisyon DOKUNULMAMIŞ olmalı — yarım iptal en tehlikeli durum.
      const row = await db
        .selectFrom('orders')
        .select(['status', 'total_cents'])
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(row.status).not.toBe('cancelled');
      expect(row.total_cents).toBeGreaterThan(0);
    });

    it('AKTİF ödemesi olan adisyonu ADMIN de iptal EDEMEZ (koruma rolde değil, parada)', async () => {
      const tableId = await makeTable('A1');
      const orderId = await openOrder(tableId, adminToken);
      await db
        .insertInto('payments')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          order_id: orderId,
          amount_cents: 30000,
          payment_type: 'card',
          payment_scope: 'full',
          idempotency_key: randomUUID(),
          created_by_user_id: ADMIN_ID,
        })
        .execute();

      const res = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'other' });

      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'ORDER_HAS_PAYMENTS',
      );
    });

    it('VOID edilmiş ödeme kapıyı AÇMAZ-kapamaz: void sonrası iptal serbest', async () => {
      const tableId = await makeTable('V1');
      const orderId = await openOrder(tableId, waiterToken);
      const paymentId = randomUUID();
      await db
        .insertInto('payments')
        .values({
          id: paymentId,
          tenant_id: TENANT_ID,
          order_id: orderId,
          amount_cents: 10000,
          payment_type: 'cash',
          payment_scope: 'partial',
          idempotency_key: randomUUID(),
          created_by_user_id: WAITER_ID,
        })
        .execute();

      // Önce kapı KAPALI.
      const blocked = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'wrong_order' });
      expect(blocked.status).toBe(409);

      // Ödeme void edilir (ADR-033) → aktif ödeme kalmaz.
      await db
        .updateTable('payments')
        .set({ voided_at: new Date(), void_reason_code: 'other' })
        .where('id', '=', paymentId)
        .execute();

      const allowed = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'wrong_order' });
      expect(allowed.status).toBe(200);
    });

    // ---- K7: sebep enum'u -------------------------------------------------

    it('geçersiz sebep 400 döner (serbest metin kabul edilmez)', async () => {
      const tableId = await makeTable('R1');
      const orderId = await openOrder(tableId, waiterToken);

      const res = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'müşteri sinirlendi ve gitti' });

      expect(res.status).toBe(400);
    });

    it('sebep audit kaydına ENUM KODU olarak yazılır', async () => {
      const tableId = await makeTable('R2');
      const orderId = await openOrder(tableId, waiterToken);

      await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'wrong_table' })
        .expect(200);

      const audit = await db
        .selectFrom('audit_logs')
        .select(['payload', 'actor_user_id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('entity_id', '=', orderId)
        .where('event_type', '=', 'order.cancelled')
        .executeTakeFirstOrThrow();
      const payload = audit.payload as {
        reason?: string;
        auto?: boolean;
        order_id?: string;
      };
      expect(payload.reason).toBe('wrong_table');
      expect(payload.auto).toBe(false);
      expect(payload.order_id).toBe(orderId);
      // Aktör garson olabilir (yetki genişledi).
      expect(audit.actor_user_id).toBe(WAITER_ID);
    });

    // ---- Güvenlik incelemesi BLOKER'i: PAKET yolunda para kapısı ----------

    it('PAKET siparişte de aktif ödeme iptali ENGELLER (güvenlik BLOKER fix)', async () => {
      // Kapı `cancelOrderTx`'e (masa yolu) konmuştu; paket ayrı fonksiyondan
      // (`cancelTakeawayOrder`) geçtiği için korumasızdı. İstismar: açık pakete
      // kısmi ödeme yaz → iptal et → ödeme öksüz kalır. Telafi de yoktu (paket
      // ödemesi void edilemiyor: PAYMENT_VOID_TAKEAWAY_UNSUPPORTED).
      const orderId = randomUUID();
      await db
        .insertInto('orders')
        .values({
          id: orderId,
          tenant_id: TENANT_ID,
          order_type: 'takeaway',
          customer_id: CUSTOMER_ID, // CHECK: takeaway'de müşteri zorunlu
          status: 'open',
          takeaway_stage: 'preparing',
          order_no: 9001,
          store_date: new Date().toISOString().slice(0, 10),
          total_cents: 20000,
        })
        .execute();
      await db
        .insertInto('payments')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          order_id: orderId,
          amount_cents: 20000,
          payment_type: 'cash',
          payment_scope: 'full',
          idempotency_key: randomUUID(),
          created_by_user_id: WAITER_ID,
        })
        .execute();

      const res = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'customer_left' });

      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'ORDER_HAS_PAYMENTS',
      );
      const row = await db
        .selectFrom('orders')
        .select(['status', 'total_cents'])
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('open');
      expect(row.total_cents).toBe(20000);
    });

    // ---- K4: merged terminal statü ---------------------------------------

    it('MERGED adisyon iptal edilemez (K4 — guard eksikti)', async () => {
      const tableId = await makeTable('M1');
      const orderId = await openOrder(tableId, waiterToken);
      await db
        .updateTable('orders')
        .set({ status: 'merged' })
        .where('id', '=', orderId)
        .execute();

      const res = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${waiterToken}`)
        .send({ reason: 'other' });

      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'ORDER_CANCEL_NOT_ALLOWED',
      );
    });
  },
);
