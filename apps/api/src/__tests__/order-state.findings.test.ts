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
 * Derin Denetim Blok 5 (Hat B) — sipariş durum makinesi KASITLI KIRMIZI
 * karakterizasyon testleri. DOĞRU/beklenen davranışı assert eder; BUGÜN
 * kırmızı (fail) döner. Prod kod DEĞİŞTİRİLMEDİ. Fixture deseni
 * payments-void.test.ts ile birebir aynı.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-os-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRICE = 5000;

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
}

const ctx: Ctx = {};

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app!).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

async function insertTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-OS-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

async function createDineInOrder(tableId: string, qty = 1): Promise<string> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${ctx.adminToken!}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: [{ productId: PRODUCT_ID, quantity: qty }],
    });
  if (res.status !== 201) {
    throw new Error(`create order failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.order.id as string;
}

async function orderRow(orderId: string): Promise<{ status: string; total_cents: number }> {
  const o = await ctx
    .db!.selectFrom('orders')
    .select(['status', 'total_cents'])
    .where('tenant_id', '=', TENANT_ID)
    .where('id', '=', orderId)
    .executeTakeFirstOrThrow();
  return o;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Durum makinesi bulguları — order-state.findings (KASITLI KIRMIZI)',
  () => {
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
        .values({ id: TENANT_ID, name: 'Order State Tenant', slug: `t-os-${TENANT_ID.slice(0, 8)}` })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      await db
        .insertInto('users')
        .values([
          { id: ADMIN_ID, tenant_id: TENANT_ID, email: ADMIN_EMAIL, username: `admin-os-${randomUUID().slice(0, 6)}`, password_hash: adminHash, role: 'admin' },
        ])
        .execute();

      await db.insertInto('areas').values({ id: AREA_ID, tenant_id: TENANT_ID, name: 'Salon' }).execute();
      await db.insertInto('categories').values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Yemekler' }).execute();
      await db
        .insertInto('products')
        .values({ id: PRODUCT_ID, tenant_id: TENANT_ID, category_id: CATEGORY_ID, name: 'Test Ürün', price_cents: PRICE, is_active: true })
        .execute();

      ctx.adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payment_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('areas').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await db.destroy();
    });

    // ─── ORD-STATE-01 [HIGH] ────────────────────────────────────────────────
    it('ORD-STATE-01: merged order\'a POST /orders/:id/items → BEKLENEN 409 ama BUGÜN 200 (kalem eklenebiliyor)', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(sourceTableId, 1);
      await createDineInOrder(targetTableId, 1);

      const merge = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(merge.status).toBe(200);
      expect((await orderRow(sourceOrderId)).status).toBe('merged');

      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/items`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }] });

      // BEKLENEN: addItems terminal-status reddi (repo orders.ts ~713-719)
      // paid|cancelled|void ile aynı ailede 'merged'i de kapsamalı → 409.
      // BUGÜN: 'merged' kontrol listesinde YOK → 200, "hayalet" siparişe
      // aktif kalem eklenir (terminal ama içi dolu adisyon).
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('ORDER_INVARIANT_VIOLATED');

      const afterAdd = await orderRow(sourceOrderId);
      expect(afterAdd.total_cents).toBe(0); // merged sipariş asla tutar taşımamalı
    });

    // ─── DB-TX-01 [BLOCKER] ─────────────────────────────────────────────────
    // NOT (metodoloji): route seviyesinde (POST /orders/:id/items +
    // PATCH /orders/:id eşzamanlı Promise.all) canlı deneme yapıldı — bu
    // ortamda addItems route'unun EK ön-iş'i (resolveItemSnapshots, repo
    // transaction'ı BAŞLAMADAN ÖNCE ürün lookup'ı yapıyor) addItems'ın kendi
    // transaction'ını cancelOrder'ın TAMAMLANMASINDAN sonra başlatacak kadar
    // geciktiriyor → addItems kendi (kilitsiz) SELECT'inde status'ü zaten
    // 'cancelled' görüp 409 ile DOĞRU reddediyor (race'e hiç girmiyor). Bu
    // ortamda HTTP üzerinden CANLI tetiklenemedi. Kök neden (addItems'ın
    // orders.ts ~700-706'daki SELECT'i kilitsiz + sonundaki recalc UPDATE'i
    // status filtresiz) DETERMİNİSTİK olarak — repo'nun BİREBİR uyguladığı
    // adımları iki elle-yönetilen ham SQL bağlantısıyla — kanıtlanır.
    it('DB-TX-01: addItems (kilitsiz SELECT + filtresiz recalc) ile eşzamanlı cancel → cancelled ama total>0 + aktif kalem üretir — DB-seviyesi deterministik kanıt', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1); // total 5000, 1 aktif (orijinal) kalem

      const clientAdd = await ctx.pool!.connect();
      const clientCancel = await ctx.pool!.connect();
      try {
        // ADIM 1 — addItems'ın repo.addItems ile BİREBİR aynı ilk adımı:
        // SELECT order, KİLİTSİZ (orders.ts repo ~702-707, forUpdate() YOK).
        await clientAdd.query('BEGIN');
        const seen = await clientAdd.query(
          'SELECT status FROM orders WHERE id=$1 AND tenant_id=$2',
          [orderId, TENANT_ID],
        );
        expect(seen.rows[0].status).toBe('open'); // check geçer (henüz cancel yok)

        // ADIM 2 — cancelOrder TAMAMEN çalışır ve COMMIT eder (repo
        // cancelOrder ~956-1007 ile birebir): FOR UPDATE + item'ları
        // cancelled yap + order.status=cancelled/total=0.
        await clientCancel.query('BEGIN');
        await clientCancel.query(
          'SELECT status FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [orderId, TENANT_ID],
        );
        await clientCancel.query(
          `UPDATE order_items SET status='cancelled'
           WHERE order_id=$1 AND tenant_id=$2 AND status != 'cancelled'`,
          [orderId, TENANT_ID],
        );
        await clientCancel.query(
          `UPDATE orders SET status='cancelled', total_cents=0, updated_at=now()
           WHERE id=$1 AND tenant_id=$2`,
          [orderId, TENANT_ID],
        );
        await clientCancel.query('COMMIT');

        // ADIM 3 — addItems devam eder (repo ~721 insertItemsAndRecalc):
        // status'ü TEKRAR KONTROL ETMEDEN yeni kalem C INSERT + total_cents
        // recalc — repo'daki GERÇEK SQL (status filtresi YOK, ~588-599).
        const newItemId = randomUUID();
        await clientAdd.query(
          `INSERT INTO order_items
             (id, tenant_id, order_id, product_id, product_name, category_name_snapshot, unit_price_cents, total_cents)
           VALUES ($1,$2,$3,$4,'Test Ürün','Yemekler',$5,$5)`,
          [newItemId, TENANT_ID, orderId, PRODUCT_ID, PRICE],
        );
        await clientAdd.query(
          `UPDATE orders SET total_cents = (
             SELECT COALESCE(SUM(total_cents), 0) FROM order_items
             WHERE order_id=$1 AND tenant_id=$2
           ), updated_at = now()
           WHERE id=$1 AND tenant_id=$2`,
          [orderId, TENANT_ID],
        );
        await clientAdd.query('COMMIT');
      } finally {
        await clientAdd.query('ROLLBACK').catch(() => undefined);
        await clientCancel.query('ROLLBACK').catch(() => undefined);
        clientAdd.release();
        clientCancel.release();
      }

      // SONUÇ — durum makinesinin en temel kuralı: sipariş cancelled İSE
      // total=0 VE aktif (cancelled olmayan) kalem OLMAMALI.
      const finalOrder = await orderRow(orderId);
      const activeItems = await ctx
        .db!.selectFrom('order_items')
        .select(['id', 'status'])
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', orderId)
        .where('status', '!=', 'cancelled')
        .execute();

      expect(finalOrder.status).toBe('cancelled'); // cancelOrder kazandı (deterministik)
      // BEKLENEN: total=0, aktif kalem=0 (iptal edilmiş adisyonda para/kalem kalamaz).
      // BUGÜN: addItems'ın filtresiz recalc'ı orijinal kalemi (cancelled, 5000)
      // VE yeni C kalemini (aktif, 5000) BİRLİKTE topluyor (status filtresi
      // YOK) → total=10000 (>0), VE C status='new' aktif kalem olarak kalır.
      expect(finalOrder.total_cents).toBe(0);
      expect(activeItems.length).toBe(0);
    });
  },
);
