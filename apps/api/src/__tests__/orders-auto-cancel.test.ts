/**
 * ADR-014 Amendment 1 — otomatik sipariş iptali (son canlı kalem iptalinde).
 *
 * v3 paritesi (autoCancelOrderIfNoActiveItems): PATCH /orders/:oid/items/:iid
 * ile SON canlı kalem cancelled olunca sipariş AYNI transaction'da otomatik
 * iptal edilir (K1) — ödeme izi varsa EDİLMEZ (K3). Fiş tarafı değişmez:
 * auto-cancel anında canlı kalem 0 → ADİSYON İPTAL fişi YOK (Amd6 A5 / K5).
 *
 * Fix'siz-kırmızı: auto-cancel yokken 1/4 numaralı testler "order.status
 * cancelled bekleniyor" assert'lerinde kırmızı (kanıt PR'da).
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
const ADMIN_EMAIL = `admin-autoc-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const TABLE_ID = randomUUID();
const CUSTOMER_ID = randomUUID();
const CUSTOMER_ADDR_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 17000;

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Otomatik sipariş iptali (ADR-014 Amd1)',
  () => {
    let pool: Pool;
    let db: Kysely<DB>;
    let app: Express;
    let adminToken: string;
    let prevBypass: string | undefined;

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
          name: 'AutoCancel Tenant',
          slug: `autoc-t-${TENANT_ID.slice(0, 8)}`,
        })
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .execute();
      await db
        .insertInto('users')
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: `admin-autoc-${TENANT_ID.slice(0, 6)}`,
          password_hash: await hashPassword(ADMIN_PASSWORD),
          role: 'admin',
        })
        .execute();
      await db
        .insertInto('tables')
        .values({
          id: TABLE_ID,
          tenant_id: TENANT_ID,
          code: `M-AUT-${TENANT_ID.slice(0, 6)}`,
          capacity: 4,
        })
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
        .insertInto('customer_addresses')
        .values({
          id: CUSTOMER_ADDR_ID,
          tenant_id: TENANT_ID,
          customer_id: CUSTOMER_ID,
          title: 'Ev',
          address_line: 'Atatürk Cad. No:12',
          neighborhood: 'Merkez',
          district: 'Akçaabat',
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

      const login = await request(app)
        .post('/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      adminToken = (login.body as { accessToken: string }).accessToken;
      expect(adminToken).toBeTruthy();
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
      await db
        .deleteFrom('customer_addresses')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
      await db
        .deleteFrom('refresh_tokens')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db
        .deleteFrom('tenant_settings')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await pool.end();
      if (prevBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = prevBypass;
      }
    });

    /** Masayı serbest bırak (dine-in testleri arka arkaya aynı masayı kullanır). */
    async function freeTableIfOpen(): Promise<void> {
      const open = await db
        .selectFrom('orders')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('table_id', '=', TABLE_ID)
        .where('status', '=', 'open')
        .execute();
      for (const o of open) {
        await request(app)
          .patch(`/orders/${o.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'cancelled' });
      }
    }

    async function createDineInOrder(
      itemCount: 1 | 2,
    ): Promise<{ orderId: string; itemIds: string[] }> {
      const items =
        itemCount === 1
          ? [{ productId: PRODUCT_ID, quantity: 1 }]
          : [
              { productId: PRODUCT_ID, quantity: 1 },
              { productId: PRODUCT_ID, quantity: 2 },
            ];
      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tableId: TABLE_ID, orderType: 'dine_in', items });
      expect(res.status).toBe(201);
      const body = res.body as {
        data: { order: { id: string }; items: Array<{ id: string }> };
      };
      return {
        orderId: body.data.order.id,
        itemIds: body.data.items.map((it) => it.id),
      };
    }

    async function orderRow(orderId: string) {
      return db
        .selectFrom('orders')
        .select(['status', 'total_cents'])
        .where('id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
    }

    async function cancelAudits(orderId: string) {
      return db
        .selectFrom('audit_logs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.cancelled')
        .where('entity_id', '=', orderId)
        .execute();
    }

    async function orderCancelJobs(orderId: string): Promise<number> {
      const rows = await db
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      return rows.filter((r) => {
        const p = r.payload as { meta?: { variant?: string; orderId?: string } };
        return (
          p.meta?.variant === 'order-cancel' && p.meta.orderId === orderId
        );
      }).length;
    }

    it('1. tek kalemli dine-in: kalem iptali siparişi OTOMATİK kapatır (K1) + audit auto:true (K4) + ADİSYON İPTAL fişi YOK (K5)', async () => {
      await freeTableIfOpen();
      const { orderId, itemIds } = await createDineInOrder(1);

      const res = await request(app)
        .patch(`/orders/${orderId}/items/${itemIds[0]}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);

      // K1 — yanıt VE DB: sipariş kapandı, total 0 ("sağlıklı kapanış").
      const body = res.body as {
        data: { order: { status: string; total_cents: number } };
      };
      expect(body.data.order.status).toBe('cancelled');
      expect(body.data.order.total_cents).toBe(0);
      const row = await orderRow(orderId);
      expect(row.status).toBe('cancelled');
      expect(row.total_cents).toBe(0);

      // K4 — order.cancelled audit, auto işaretli.
      const audits = await cancelAudits(orderId);
      expect(audits).toHaveLength(1);
      const payload = audits[0]!.payload as {
        auto?: boolean;
        trigger_item_id?: string;
      };
      expect(payload.auto).toBe(true);
      expect(payload.trigger_item_id).toBe(itemIds[0]);

      // K5 — ADİSYON İPTAL fişi YOK (kalem kendi KALEM İPTAL fişini aldı;
      // Amd6 A5 dedup).
      expect(await orderCancelJobs(orderId)).toBe(0);
    });

    it('2. iki kalemli dine-in: biri iptal → sipariş AÇIK kalır', async () => {
      await freeTableIfOpen();
      const { orderId, itemIds } = await createDineInOrder(2);

      const res = await request(app)
        .patch(`/orders/${orderId}/items/${itemIds[0]}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);
      expect(
        (res.body as { data: { order: { status: string } } }).data.order.status,
      ).toBe('open');
      expect((await orderRow(orderId)).status).toBe('open');
      expect(await cancelAudits(orderId)).toHaveLength(0);
    });

    it('3. K3 ödeme guard: parçalı ödemeli siparişte son kalem iptali otomatik KAPATMAZ', async () => {
      await freeTableIfOpen();
      const { orderId, itemIds } = await createDineInOrder(1);

      const pay = await request(app)
        .post('/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          orderId,
          paymentType: 'cash',
          paymentScope: 'partial',
          amountCents: 5000,
          idempotencyKey: randomUUID(),
          operation: 'pay',
        });
      expect(pay.status).toBe(201);

      const res = await request(app)
        .patch(`/orders/${orderId}/items/${itemIds[0]}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(res.status).toBe(200);
      // Para izi var → otomatik iptal YOK; kasiyer ADR-033 akışıyla çözer.
      expect((await orderRow(orderId)).status).toBe('open');
      expect(await cancelAudits(orderId)).toHaveLength(0);
    });

    it('4. takeaway tek kalem: kalem iptali siparişi OTOMATİK kapatır (K8 order_type bağımsız)', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          customerAddressId: CUSTOMER_ADDR_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_ID, quantity: 1 }],
        });
      expect(res.status).toBe(201);
      const orderId = (res.body as { data: { id: string } }).data.id;

      const item = await db
        .selectFrom('order_items')
        .select(['id'])
        .where('order_id', '=', orderId)
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();

      const patch = await request(app)
        .patch(`/orders/${orderId}/items/${item.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(patch.status).toBe(200);
      expect((await orderRow(orderId)).status).toBe('cancelled');
      const audits = await cancelAudits(orderId);
      expect(audits).toHaveLength(1);
      expect((audits[0]!.payload as { auto?: boolean }).auto).toBe(true);
    });
  },
);
