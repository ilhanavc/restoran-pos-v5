/**
 * ADR-004 Amendment 6 A5/A6/A7 — iptal fişi enqueue-hook integration testleri.
 *
 * Uçtan uca (HTTP route → hook → print_jobs satırı):
 *   1. kalem-iptal PATCH → 1 job (kind='kitchen', meta.variant='item-cancel')
 *   2. zaten-iptal kalemin re-PATCH'i → İKİNCİ job YOK (A6 dedup)
 *   3. sipariş-iptal → TEK job; yalnız İPTAL ANINDA CANLI kalem listelenir
 *      (önceden kalem-kalem iptal edilen TEKRAR listelenmez — A5 ince asserti)
 *   4. 0-canlı-kalemli adisyon iptali → order-cancel job YOK (A5 guard)
 *   5. takeaway POST /:id/cancel → PAKET etiketli ADİSYON İPTAL fişi
 *
 * Yalnız lokal pos_test (DATABASE_URL yoksa skip). Fix'siz-kırmızı: hook'lar
 * stash'lenirse 1/3/5 "job bekleniyor" assert'leri kırmızı (kanıt PR'da).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { encodeCP857 } from '@restoran-pos/shared-domain';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-cancel-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const TABLE_ID = randomUUID();
const CUSTOMER_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();

function bufferContains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

interface CancelJobRow {
  variant: string;
  itemCount: number;
  kind: string;
  bytes: Uint8Array;
  orderId: string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'İptal fişi enqueue hookları (ADR-004 Amd6)',
  () => {
    let pool: Pool;
    let db: Kysely<DB>;
    let app: Express;
    let adminToken: string;
    let prevBypass: string | undefined;

    /** Tenant'ın cancel-variant print job'larını çek (yardımcı). */
    async function cancelJobs(): Promise<CancelJobRow[]> {
      const rows = await db
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      const out: CancelJobRow[] = [];
      for (const r of rows) {
        const p = r.payload as {
          kind: string;
          bytesBase64: string;
          meta?: { variant?: string; itemCount?: number; orderId?: string };
        };
        if (p.meta?.variant === undefined) continue;
        out.push({
          variant: p.meta.variant,
          itemCount: p.meta.itemCount ?? -1,
          kind: p.kind,
          bytes: new Uint8Array(Buffer.from(p.bytesBase64, 'base64')),
          orderId: p.meta.orderId ?? '',
        });
      }
      return out;
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
          name: 'Cancel Fişi Tenant',
          slug: `cancel-t-${TENANT_ID.slice(0, 8)}`,
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
          username: `admin-cancel-${TENANT_ID.slice(0, 6)}`,
          password_hash: await hashPassword(ADMIN_PASSWORD),
          role: 'admin',
        })
        .execute();
      await db
        .insertInto('tables')
        .values({
          id: TABLE_ID,
          tenant_id: TENANT_ID,
          code: `M-CNL-${TENANT_ID.slice(0, 6)}`,
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
          price_cents: 17000,
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

    /** Yardımcı: masada 2 kalemli dine-in sipariş yarat, {orderId, itemIds} dön. */
    async function createDineInOrder(): Promise<{
      orderId: string;
      itemIds: string[];
    }> {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          items: [
            { productId: PRODUCT_ID, quantity: 2 },
            { productId: PRODUCT_ID, quantity: 1 },
          ],
        });
      expect(res.status).toBe(201);
      const body = res.body as {
        data: { order: { id: string }; items: Array<{ id: string }> };
      };
      return {
        orderId: body.data.order.id,
        itemIds: body.data.items.map((it) => it.id),
      };
    }

    it('1+2: kalem-iptal 1 job üretir; re-PATCH ikinci job üretmez (A6)', async () => {
      const { orderId, itemIds } = await createDineInOrder();

      const patch = await request(app)
        .patch(`/orders/${orderId}/items/${itemIds[0]}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(patch.status).toBe(200);

      let jobs = (await cancelJobs()).filter(
        (j) => j.orderId === orderId && j.variant === 'item-cancel',
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.kind).toBe('kitchen'); // A2 — routing anahtarı DEĞİŞMEZ
      expect(jobs[0]!.itemCount).toBe(1);
      expect(bufferContains(jobs[0]!.bytes, encodeCP857('İPTAL'))).toBe(true);
      expect(
        bufferContains(jobs[0]!.bytes, encodeCP857('Kaşarlı Pide')),
      ).toBe(true);
      // Fiyat mutfak fişine girmez (A3).
      expect(bufferContains(jobs[0]!.bytes, encodeCP857('TL'))).toBe(false);

      // Re-PATCH (zaten cancelled) → dedup: hâlâ 1 job.
      const rePatch = await request(app)
        .patch(`/orders/${orderId}/items/${itemIds[0]}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(rePatch.status).toBe(200);
      jobs = (await cancelJobs()).filter(
        (j) => j.orderId === orderId && j.variant === 'item-cancel',
      );
      expect(jobs).toHaveLength(1);

      // 3: sipariş-iptal → TEK order-cancel job; YALNIZ canlı kalan kalem
      // (itemIds[1]) listelenir → itemCount=1 (A5 ince asserti).
      const cancel = await request(app)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(cancel.status).toBe(200);

      const orderJobs = (await cancelJobs()).filter(
        (j) => j.orderId === orderId && j.variant === 'order-cancel',
      );
      expect(orderJobs).toHaveLength(1);
      expect(orderJobs[0]!.itemCount).toBe(1);
      expect(
        bufferContains(orderJobs[0]!.bytes, encodeCP857('ADİSYON İPTAL')),
      ).toBe(true);
    });

    it('4: tüm kalemler tek tek iptal → son kalem siparişi OTOMATİK kapatır (ADR-014 Amd1); order-cancel job YOK (A5/K5)', async () => {
      const { orderId, itemIds } = await createDineInOrder();
      // Tüm kalemleri tek tek iptal et (her biri kendi item-cancel fişini üretir).
      // SON kalem iptali ADR-014 Amd1 K1 ile siparişi otomatik kapatır (canlı
      // kalem 0). Explicit order-cancel PATCH'e artık GEREK YOK; A5 dedup zaten
      // öngörmüştü → order-cancel fişi basılmaz (kalemler kendi İPTAL fişini aldı).
      let lastOrderStatus = '';
      for (const itemId of itemIds) {
        const r = await request(app)
          .patch(`/orders/${orderId}/items/${itemId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'cancelled' });
        expect(r.status).toBe(200);
        lastOrderStatus = (
          r.body as { data: { order: { status: string } } }
        ).data.order.status;
      }
      // Son kalem iptalinde sipariş otomatik cancelled (Amd1 K1).
      expect(lastOrderStatus).toBe('cancelled');

      const orderJobs = (await cancelJobs()).filter(
        (j) => j.orderId === orderId && j.variant === 'order-cancel',
      );
      expect(orderJobs).toHaveLength(0);
      // item-cancel fişleri kalem başına üretilmiş olmalı.
      const itemJobs = (await cancelJobs()).filter(
        (j) => j.orderId === orderId && j.variant === 'item-cancel',
      );
      expect(itemJobs).toHaveLength(itemIds.length);
    });

    it('4b: header-only (0 kalemli) siparişin EXPLICIT iptali → order-cancel job YOK (A5 guard FALSE dalı)', async () => {
      // ADR-014 Amd1 auto-cancel yalnız kalem-iptal yolundan tetiklenir; 0
      // kalemli sipariş hiç kalem-iptali görmediğinden explicit PATCH-cancel
      // yolu hâlâ ulaşılabilir → orders.ts A5 guard `liveItemIds.length > 0`
      // FALSE dalı (0 canlı kalem → order-cancel fişi basılmaz) burada test
      // edilir (test #4 auto-cancel'e döndüğünde düşen kapsam geri gelir).
      const create = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tableId: TABLE_ID, orderType: 'dine_in', items: [] });
      expect(create.status).toBe(201);
      const orderId = (
        create.body as { data: { order: { id: string } } }
      ).data.order.id;

      const cancel = await request(app)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(cancel.status).toBe(200);

      const orderJobs = (await cancelJobs()).filter(
        (j) => j.orderId === orderId && j.variant === 'order-cancel',
      );
      expect(orderJobs).toHaveLength(0);
    });

    it('5: takeaway POST /:id/cancel → PAKET etiketli ADİSYON İPTAL fişi', async () => {
      const create = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          plannedPaymentType: 'cash',
          items: [{ productId: PRODUCT_ID, quantity: 1 }],
        });
      expect(create.status).toBe(201);
      // dine_in yanıtı `data.order` nested, takeaway FLAT DTO (Sprint 11 —
      // feedback_mutation_response_shape_mismatch dersi).
      const orderId = (create.body as { data: { id: string } }).data.id;

      const cancel = await request(app)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(cancel.status).toBe(200);

      const jobs = (await cancelJobs()).filter(
        (j) => j.orderId === orderId && j.variant === 'order-cancel',
      );
      expect(jobs).toHaveLength(1);
      expect(bufferContains(jobs[0]!.bytes, encodeCP857('PAKET'))).toBe(true);
      expect(
        bufferContains(jobs[0]!.bytes, encodeCP857('ADİSYON İPTAL')),
      ).toBe(true);
      // Müşteri PII fişe girmez (A8).
      expect(
        bufferContains(jobs[0]!.bytes, encodeCP857('Paket Müşterisi')),
      ).toBe(false);
    });
  },
);
