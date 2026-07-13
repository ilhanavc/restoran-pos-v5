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
 * Blok 5 (Hat C) derin denetim — ADR-029 (Adisyon Birleştir) invariant kilidi.
 *
 * `orders-merge.test.ts` (ADR-029 K9 test matrisi) zaten happy/guard yollarını
 * kapsıyor. Bu dosya AYRI bir eksen doğrular: **kalem (item) ve tutar (para)
 * KAYBI/ÇİFT SAYIMI** — gerçek restoran senaryosu ("2 farklı ürün sipariş
 * edilmiş 100 TL'lik masa + 50 TL'lik başka masa birleşiyor, hiçbir kalem
 * kaybolmamalı/çoğalmamalı").
 *
 * ORD-MERGE-01: A (2 KALEM — farklı ürün, 100 TL) + B (1 kalem, 50 TL) →
 *   B'ye merge → hedef 150 TL + 3 kalem (kayıp/çift YOK — item id set birebir
 *   korunur), kaynak terminal (`merged`, total_cents=0, 0 kalem).
 * ORD-MERGE-02 (edge case — zincir merge): C, B'ye (A zaten merge olmuş
 *   B'ye) tekrar merge edilir → iki ardışık merge'de de kayıp/çift olmadığı
 *   doğrulanır (gerçek operasyon: "3. masa da gruba katıldı").
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-mgaud-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `admin-mgaud-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
// Gerçekçi lokanta menüsü — kalem kaybı/çift sayımı farklı ürünlerle daha
// net görülür (aynı ürün tekrarı "qty toplama" ile karışabilir).
const PRODUCT_KEBAP_ID = randomUUID(); // Adana Kebap 5000 kuruş
const PRODUCT_CORBA_ID = randomUUID(); // Mercimek Çorbası 5000 kuruş
const PRODUCT_PIDE_ID = randomUUID(); // Karışık Pide 5000 kuruş

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
  prevBypass?: string | undefined;
}

const ctx: Ctx = {};

async function login(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(
      `login failed: ${res.status} ${JSON.stringify(res.body)} [email=${email}]`,
    );
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
      code: `M-MA-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

/** Dine-in sipariş — birden çok FARKLI ürün, her biri ayrı kalem (satır). */
async function createDineInOrderMultiItem(
  token: string,
  tableId: string,
  productIds: string[],
): Promise<{ orderId: string; itemIds: string[] }> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: productIds.map((productId) => ({ productId, quantity: 1 })),
    });
  if (res.status !== 201) {
    throw new Error(
      `dine-in POST failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  const itemIds = (res.body.data.items as Array<{ id: string }>).map(
    (i) => i.id,
  );
  return { orderId: res.body.data.order.id as string, itemIds };
}

/** Bir siparişe ait kalem id kümesini DB'den çeker (kayıp/çift kanıtı). */
async function itemIdsOf(orderId: string): Promise<string[]> {
  const rows = await ctx
    .db!.selectFrom('order_items')
    .select(['id'])
    .where('tenant_id', '=', TENANT_ID)
    .where('order_id', '=', orderId)
    .execute();
  return rows.map((r) => r.id);
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-029 merge invariant — kalem/tutar kaybı ve çift sayım yok (ORD-MERGE-NN)',
  () => {
    beforeAll(async () => {
      ctx.prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';

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
        .values({
          id: TENANT_ID,
          name: `Merge Audit Tenant ${TENANT_ID.slice(0, 8)}`,
          slug: `t-mgaud-${TENANT_ID.slice(0, 8)}`,
        })
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
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          password_hash: adminHash,
          role: 'admin',
        })
        .execute();

      await db
        .insertInto('areas')
        .values({ id: AREA_ID, tenant_id: TENANT_ID, name: 'Salon' })
        .execute();

      await db
        .insertInto('categories')
        .values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Ana Yemekler' })
        .execute();
      await db
        .insertInto('products')
        .values([
          {
            id: PRODUCT_KEBAP_ID,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_ID,
            name: 'Adana Kebap',
            price_cents: 5000,
            is_active: true,
          },
          {
            id: PRODUCT_CORBA_ID,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_ID,
            name: 'Mercimek Çorbası',
            price_cents: 5000,
            is_active: true,
          },
          {
            id: PRODUCT_PIDE_ID,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_ID,
            name: 'Karışık Pide',
            price_cents: 5000,
            is_active: true,
          },
        ])
        .execute();

      ctx.adminToken = await login(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db !== undefined) {
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
      }
      if (ctx.prevBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = ctx.prevBypass;
      }
    });

    it('ORD-MERGE-01: A(2 kalem/100TL)+B(1 kalem/50TL) → B hedef 150TL+3 kalem, item-id kümesi birebir korunur (kayıp/çift YOK)', async () => {
      const tableA = await insertTable();
      const tableB = await insertTable();

      const orderA = await createDineInOrderMultiItem(ctx.adminToken!, tableA, [
        PRODUCT_KEBAP_ID,
        PRODUCT_CORBA_ID,
      ]);
      const orderB = await createDineInOrderMultiItem(ctx.adminToken!, tableB, [
        PRODUCT_PIDE_ID,
      ]);
      expect(orderA.itemIds.length).toBe(2);
      expect(orderB.itemIds.length).toBe(1);

      const expectedItemIdSet = [...orderA.itemIds, ...orderB.itemIds].sort();

      const res = await request(ctx.app!)
        .post(`/orders/${orderA.orderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: tableB });
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(orderB.orderId);
      expect(res.body.data.totalCents).toBe(15000);

      // Kayıp/çift kontrolü #1: hedefteki kalem id kümesi TAM OLARAK
      // kaynak+hedefin birleşimi (ne eksik ne fazla, ne yinelenen).
      const targetItemIds = (await itemIdsOf(orderB.orderId)).sort();
      expect(targetItemIds).toEqual(expectedItemIdSet);
      expect(new Set(targetItemIds).size).toBe(targetItemIds.length); // dup yok

      // Kayıp/çift kontrolü #2: kaynakta hiç kalem kalmadı.
      const sourceItemIds = await itemIdsOf(orderA.orderId);
      expect(sourceItemIds.length).toBe(0);

      // Kayıp/çift kontrolü #3: order_items.total_cents SUM'u order.total_cents
      // ile birebir eşleşir (bağımsız yeniden hesap — recalc formülünün kendisi
      // değil, DB'deki ham veri doğrulanır).
      const sumRow = await ctx
        .db!.selectFrom('order_items')
        .select(({ fn }) => fn.sum<string>('total_cents').as('sum'))
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', orderB.orderId)
        .executeTakeFirstOrThrow();
      expect(Number(sumRow.sum)).toBe(15000);

      // Kaynak terminal + hayalet tutar yok.
      const sourceRow = await ctx
        .db!.selectFrom('orders')
        .select(['status', 'total_cents', 'merged_into_order_id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', orderA.orderId)
        .executeTakeFirstOrThrow();
      expect(sourceRow.status).toBe('merged');
      expect(sourceRow.total_cents).toBe(0);
      expect(sourceRow.merged_into_order_id).toBe(orderB.orderId);
    });

    it('ORD-MERGE-02 (edge case — zincir merge): C, (A zaten merge olmuş) B\'ye tekrar merge edilir → iki ardışık merge\'de de kayıp/çift yok', async () => {
      const tableA = await insertTable();
      const tableB = await insertTable();
      const tableC = await insertTable();

      const orderA = await createDineInOrderMultiItem(ctx.adminToken!, tableA, [
        PRODUCT_KEBAP_ID,
      ]);
      const orderB = await createDineInOrderMultiItem(ctx.adminToken!, tableB, [
        PRODUCT_CORBA_ID,
      ]);
      const orderC = await createDineInOrderMultiItem(ctx.adminToken!, tableC, [
        PRODUCT_PIDE_ID,
        PRODUCT_KEBAP_ID,
      ]);

      const merge1 = await request(ctx.app!)
        .post(`/orders/${orderA.orderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: tableB });
      expect(merge1.status).toBe(200);
      expect(merge1.body.data.totalCents).toBe(10000); // A(5000)+B(5000)

      // İkinci ardışık merge: C, büyümüş B'ye katılıyor (gerçek operasyon:
      // "3. masa da gruba katıldı").
      const merge2 = await request(ctx.app!)
        .post(`/orders/${orderC.orderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId: tableB });
      expect(merge2.status).toBe(200);
      // A(5000)+B(5000)+C(5000+5000) = 20000; hiçbir kalem kaybolmadan/
      // çoğalmadan iki ardışık merge sonrası toplam.
      expect(merge2.body.data.totalCents).toBe(20000);

      const expectedFinalIds = [
        ...orderA.itemIds,
        ...orderB.itemIds,
        ...orderC.itemIds,
      ].sort();
      const finalTargetIds = (await itemIdsOf(orderB.orderId)).sort();
      expect(finalTargetIds).toEqual(expectedFinalIds);
      expect(finalTargetIds.length).toBe(4); // 1+1+2, kayıp/çift yok

      expect((await itemIdsOf(orderA.orderId)).length).toBe(0);
      expect((await itemIdsOf(orderC.orderId)).length).toBe(0);
    });
  },
);
