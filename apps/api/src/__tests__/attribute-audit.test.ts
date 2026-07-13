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
 * Blok 5 (Hat C) derin denetim — `resolveItemAttributes.ts` (189 satır) +
 * sipariş TOPLAMI (order.total_cents) düzeyinde extraPriceCents doğrulaması.
 *
 * Mevcut `orders-attributes.test.ts` (PR-6) yalnız KALEM düzeyini
 * (`item.unit_price_cents`/`item.total_cents`) doğruluyor. Bu dosya EK bir
 * eksen kapsar: birden çok kalemli (bazıları attribute'lu, bazıları değil,
 * biri NEGATİF extra_price'lı — ADR-012 Karar 4 signed ±100 TL aralığı) tek
 * bir siparişte order.total_cents doğru mu — para integer, float sürüklenmesi
 * yok mu (ORD-ATTR-NN).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-attraud-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `admin-attraud-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();

// Karışık Pide — attribute grupları olan ürün.
const PIDE_ID = randomUUID();
const PIDE_PRICE = 8000; // 80.00 TL

// Ayran — attribute grubu OLMAYAN düz ürün (karışık sipariş senaryosu).
const AYRAN_ID = randomUUID();
const AYRAN_PRICE = 1500; // 15.00 TL

// "Boyut" — required-single (Küçük 0 / Büyük +1000).
const BOYUT_GROUP_ID = randomUUID();
const BOYUT_KUCUK_ID = randomUUID();
const BOYUT_BUYUK_ID = randomUUID();

// "İndirim" — optional-single, NEGATİF fiyat (Öğrenci İndirimi -500).
const INDIRIM_GROUP_ID = randomUUID();
const INDIRIM_OGRENCI_ID = randomUUID();

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
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
      code: `M-ATA-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'resolveItemAttributes — sipariş TOPLAMI extraPriceCents doğruluğu (ORD-ATTR-NN)',
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
        .values({
          id: TENANT_ID,
          name: `Attr Audit Tenant ${TENANT_ID.slice(0, 8)}`,
          slug: `t-attraud-${TENANT_ID.slice(0, 8)}`,
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
        .values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Pideler' })
        .execute();
      await db
        .insertInto('products')
        .values([
          {
            id: PIDE_ID,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_ID,
            name: 'Karışık Pide',
            price_cents: PIDE_PRICE,
            is_active: true,
          },
          {
            id: AYRAN_ID,
            tenant_id: TENANT_ID,
            category_id: CATEGORY_ID,
            name: 'Ayran',
            price_cents: AYRAN_PRICE,
            is_active: true,
          },
        ])
        .execute();

      await db
        .insertInto('attribute_groups')
        .values([
          {
            id: BOYUT_GROUP_ID,
            tenant_id: TENANT_ID,
            name: 'Boyut',
            selection_type: 'single',
            is_required: true,
          },
          {
            id: INDIRIM_GROUP_ID,
            tenant_id: TENANT_ID,
            name: 'İndirim',
            selection_type: 'single',
            is_required: false,
          },
        ])
        .execute();
      await db
        .insertInto('attribute_options')
        .values([
          {
            id: BOYUT_KUCUK_ID,
            tenant_id: TENANT_ID,
            group_id: BOYUT_GROUP_ID,
            name: 'Küçük',
            extra_price_cents: 0,
          },
          {
            id: BOYUT_BUYUK_ID,
            tenant_id: TENANT_ID,
            group_id: BOYUT_GROUP_ID,
            name: 'Büyük',
            extra_price_cents: 1000,
          },
          {
            id: INDIRIM_OGRENCI_ID,
            tenant_id: TENANT_ID,
            group_id: INDIRIM_GROUP_ID,
            name: 'Öğrenci İndirimi',
            extra_price_cents: -500,
          },
        ])
        .execute();
      // Yalnız Karışık Pide'ye atanır — Ayran'ın attribute grubu YOK.
      await db
        .insertInto('product_attribute_groups')
        .values([
          {
            id: randomUUID(),
            tenant_id: TENANT_ID,
            product_id: PIDE_ID,
            group_id: BOYUT_GROUP_ID,
          },
          {
            id: randomUUID(),
            tenant_id: TENANT_ID,
            product_id: PIDE_ID,
            group_id: INDIRIM_GROUP_ID,
          },
        ])
        .execute();

      ctx.adminToken = await login(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db !== undefined) {
        await db.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('product_attribute_groups').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('attribute_options').where('tenant_id', '=', TENANT_ID).execute();
        await db.deleteFrom('attribute_groups').where('tenant_id', '=', TENANT_ID).execute();
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
    });

    it('ORD-ATTR-01: karışık kalemler (pozitif+negatif extra + attribute\'suz ürün) → order.total_cents tam integer toplam', async () => {
      const tableId = await insertTable();
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [
            {
              // Büyük pide × 2 → unit 8000+1000=9000, total 18000.
              productId: PIDE_ID,
              quantity: 2,
              selectedAttributes: [
                { groupId: BOYUT_GROUP_ID, optionId: BOYUT_BUYUK_ID },
              ],
            },
            {
              // Küçük pide + öğrenci indirimi (NEGATİF) → unit 8000+0-500=7500.
              productId: PIDE_ID,
              quantity: 1,
              selectedAttributes: [
                { groupId: BOYUT_GROUP_ID, optionId: BOYUT_KUCUK_ID },
                { groupId: INDIRIM_GROUP_ID, optionId: INDIRIM_OGRENCI_ID },
              ],
            },
            {
              // Ayran × 3 — attribute YOK, düz base fiyat.
              productId: AYRAN_ID,
              quantity: 3,
            },
          ],
        });
      expect(res.status).toBe(201);

      const items = res.body.data.items as Array<{
        id: string;
        product_id: string;
        unit_price_cents: number;
        total_cents: number;
        quantity: number;
      }>;
      expect(items).toHaveLength(3);

      const bigPide = items.find(
        (i) => i.product_id === PIDE_ID && i.quantity === 2,
      )!;
      expect(bigPide.unit_price_cents).toBe(9000);
      expect(bigPide.total_cents).toBe(18000);

      const smallPideDiscounted = items.find(
        (i) => i.product_id === PIDE_ID && i.quantity === 1,
      )!;
      expect(smallPideDiscounted.unit_price_cents).toBe(7500); // 8000+0-500
      expect(smallPideDiscounted.total_cents).toBe(7500);

      const ayran = items.find((i) => i.product_id === AYRAN_ID)!;
      expect(ayran.unit_price_cents).toBe(AYRAN_PRICE); // attribute'suz, base aynen
      expect(ayran.total_cents).toBe(AYRAN_PRICE * 3);

      // Sipariş toplamı: 18000 + 7500 + 4500 = 30000 (float sürüklenmesi yok,
      // hepsi integer kuruş — CLAUDE.md "asla float/double para" kuralı).
      const order = res.body.data.order as { total_cents: number };
      expect(order.total_cents).toBe(30000);
      expect(Number.isInteger(order.total_cents)).toBe(true);

      // Bağımsız çapraz kontrol: order_items.total_cents SUM'u order.total_cents
      // ile birebir (recalc formülünün kendisini değil, ham veriyi doğrular).
      const sumRow = await ctx
        .db!.selectFrom('order_items')
        .select(({ fn }) => fn.sum<string>('total_cents').as('sum'))
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', res.body.data.order.id)
        .executeTakeFirstOrThrow();
      expect(Number(sumRow.sum)).toBe(30000);

      // Negatif extra_price_cents snapshot doğru işaretle yazılmış mı?
      const discountSnap = await ctx
        .db!.selectFrom('order_item_attributes')
        .select(['extra_price_cents_snapshot'])
        .where('tenant_id', '=', TENANT_ID)
        .where('order_item_id', '=', smallPideDiscounted.id)
        .where('attribute_option_id', '=', INDIRIM_OGRENCI_ID)
        .executeTakeFirstOrThrow();
      expect(discountSnap.extra_price_cents_snapshot).toBe(-500);
    });

    it('ORD-ATTR-02 (edge case): çoklu-kalemde 2. kalem required attribute eksik → 400 + SIFIR order_items yazılır (kısmi insert yok)', async () => {
      const tableId = await insertTable();
      const beforeCount = await ctx
        .db!.selectFrom('order_items')
        .select(({ fn }) => fn.countAll<string>().as('cnt'))
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();

      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [
            {
              // Geçerli ilk kalem.
              productId: PIDE_ID,
              quantity: 1,
              selectedAttributes: [
                { groupId: BOYUT_GROUP_ID, optionId: BOYUT_BUYUK_ID },
              ],
            },
            {
              // İkinci kalem — required "Boyut" grubu HİÇ seçilmedi.
              productId: PIDE_ID,
              quantity: 1,
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_REQUIRED_ATTRIBUTE');

      // Kısmi yazım yok: validasyon repo.create() ÖNCESİ (resolveItemSnapshots
      // içinde) çalışıyor — ama regresyon-kilidi olarak DB'de doğrulanır.
      const afterCount = await ctx
        .db!.selectFrom('order_items')
        .select(({ fn }) => fn.countAll<string>().as('cnt'))
        .where('tenant_id', '=', TENANT_ID)
        .executeTakeFirstOrThrow();
      expect(Number(afterCount.cnt)).toBe(Number(beforeCount.cnt));
    });
  },
);
