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
 * ADR-013 Amendment 5 — pending (kaydedilmemiş) sepet kaleminde birim fiyat
 * override testleri. `unitPriceOverrideCents` üç yolun da (dine_in POST
 * /orders, takeaway POST /orders, POST /orders/:id/items) tek ortak
 * `resolveItemSnapshots`'tan geçtiğini doğrular (S104 "takeaway ayrı döngü
 * alan düşürdü" dersinin bu amendment'a tekrarlanmadığının kanıtı).
 *
 * Kapsam (DoD #12-13):
 *   (a) dine_in POST /orders override → unit/total_cents = override
 *   (b) takeaway POST /orders override → aynısı
 *   (c) POST /orders/:id/items override → aynısı
 *   (d) override + variant + attributes birlikte → snapshot alanları korunur
 *   (e) negatif override → 400 VALIDATION_ERROR
 *   (f) override YOK → bugünkü katalog davranışı (regresyon)
 *   (g) products.price_cents DEĞİŞMEDİ
 *   audit: order.created / order_item.created yalnız override varken priceOverrides taşır
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-pxo-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-pxo-${randomUUID().slice(0, 8)}`;

const TABLE_ID = randomUUID();
const TABLE_CODE = `M-PXO-${randomUUID().slice(0, 6)}`;

// Takeaway (b) senaryosu için — CreateTakeawayOrderInputSchema.customerId zorunlu.
const CUSTOMER_ID = randomUUID();

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 20000; // 200.00 TL

// Porsiyon (variant) + özellik — (d) senaryosu için.
const VARIANT_ID = randomUUID();
const VARIANT_DELTA = 1000; // +10 TL
const ATTR_GROUP_ID = randomUUID();
const ATTR_OPTION_ID = randomUUID();
const ATTR_EXTRA = 500; // +5 TL

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  token?: string;
}

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined)(
  'POST /orders + items[].unitPriceOverrideCents (ADR-013 Amendment 5)',
  () => {
    const ctx: Ctx = {};

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
          name: 'Test Tenant Price Override',
          slug: `t-pxo-${TENANT_ID.slice(0, 8)}`,
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
        .insertInto('tables')
        .values({
          id: TABLE_ID,
          tenant_id: TENANT_ID,
          code: TABLE_CODE,
          capacity: 4,
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
          is_active: true,
        })
        .execute();

      await db
        .insertInto('product_variants')
        .values({
          id: VARIANT_ID,
          tenant_id: TENANT_ID,
          product_id: PRODUCT_ID,
          name: 'Büyük',
          price_delta_cents: VARIANT_DELTA,
        })
        .execute();

      await db
        .insertInto('attribute_groups')
        .values({
          id: ATTR_GROUP_ID,
          tenant_id: TENANT_ID,
          name: 'Ekstra',
          selection_type: 'multiple',
          is_required: false,
        })
        .execute();

      await db
        .insertInto('attribute_options')
        .values({
          id: ATTR_OPTION_ID,
          tenant_id: TENANT_ID,
          group_id: ATTR_GROUP_ID,
          name: 'Sucuk',
          extra_price_cents: ATTR_EXTRA,
        })
        .execute();

      await db
        .insertInto('product_attribute_groups')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          product_id: PRODUCT_ID,
          group_id: ATTR_GROUP_ID,
        })
        .execute();

      // (b) takeaway senaryosu için — CreateTakeawayOrderInputSchema.customerId zorunlu.
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_ID,
          tenant_id: TENANT_ID,
          full_name: 'Test Müşteri PXO',
          note: null,
        })
        .execute();

      ctx.token = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
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
      await db
        .deleteFrom('product_attribute_groups')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('attribute_options')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('attribute_groups')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('product_variants')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('customers').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
      await db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
      await db
        .deleteFrom('tenant_settings')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await db.destroy();
    });

    async function freeTable(): Promise<void> {
      await ctx.db!
        .deleteFrom('order_item_attributes')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db!.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
      await ctx.db!.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
    }

    // (g) baseline — hiçbir testte products.price_cents değişmemeli.
    async function assertCatalogUnchanged(): Promise<void> {
      const row = await ctx.db!
        .selectFrom('products')
        .select('price_cents')
        .where('id', '=', PRODUCT_ID)
        .executeTakeFirst();
      expect(row?.price_cents).toBe(PRODUCT_PRICE);
    }

    it('(a) dine_in POST /orders override → unit/total_cents = override', async () => {
      await freeTable();
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          items: [
            { productId: PRODUCT_ID, quantity: 2, unitPriceOverrideCents: 15000 },
          ],
        });
      expect(res.status).toBe(201);
      const item = res.body.data.items[0];
      expect(item.unit_price_cents).toBe(15000);
      expect(item.total_cents).toBe(30000);
      await assertCatalogUnchanged();
    });

    it('(b) takeaway POST /orders override → unit/total_cents = override', async () => {
      await freeTable();
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          type: 'takeaway',
          customerId: CUSTOMER_ID,
          plannedPaymentType: 'cash',
          items: [
            { productId: PRODUCT_ID, quantity: 1, unitPriceOverrideCents: 12345 },
          ],
        });
      expect(res.status).toBe(201);
      const item = res.body.data.items[0];
      expect(item.unitPriceCents).toBe(12345);
      expect(item.lineTotalCents).toBe(12345);
      await assertCatalogUnchanged();
    });

    it('(c) POST /orders/:id/items override → unit/total_cents = override', async () => {
      await freeTable();
      const created = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({ tableId: TABLE_ID, orderType: 'dine_in', items: [] });
      const orderId = created.body.data.order.id as string;

      const res = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          items: [
            { productId: PRODUCT_ID, quantity: 3, unitPriceOverrideCents: 5000 },
          ],
        });
      expect(res.status).toBe(200);
      const item = res.body.data.items.find(
        (it: { product_id: string }) => it.product_id === PRODUCT_ID,
      );
      expect(item.unit_price_cents).toBe(5000);
      expect(item.total_cents).toBe(15000);
      await assertCatalogUnchanged();
    });

    it('replay (idempotencyKey tekrar) → override UYGULANMAZ, ikinci audit YAZILMAZ (security-review bulgusu)', async () => {
      await freeTable();
      const key = randomUUID();
      const first = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          idempotencyKey: key,
          items: [{ productId: PRODUCT_ID, quantity: 1, unitPriceOverrideCents: 4242 }],
        });
      expect(first.status).toBe(201);
      const orderId = first.body.data.order.id as string;

      // Aynı idempotencyKey ile TEKRAR — bu sefer FARKLI (hatta override'sız)
      // bir gövde gönderilse bile replay orijinali döner, YENİ insert/audit yok.
      const second = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          idempotencyKey: key,
          items: [{ productId: PRODUCT_ID, quantity: 1, unitPriceOverrideCents: 9000 }],
        });
      expect(second.status).toBe(200);
      expect(second.body.data.replayed).toBe(true);
      expect(second.body.data.order.id).toBe(orderId);
      // Fiyat İKİNCİ (9000) DEĞİL, İLK (4242) — replay orijinali korur.
      const items = second.body.data.items as Array<{ unit_price_cents: number }>;
      expect(items[0]!.unit_price_cents).toBe(4242);

      // Tam olarak 1 audit kaydı — replay ikinci bir kayıt YARATMAZ.
      const auditRows = await ctx.db!
        .selectFrom('audit_logs')
        .selectAll()
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.created')
        .where('entity_id', '=', orderId)
        .execute();
      expect(auditRows).toHaveLength(1);
    });

    it('(d) override + variant + attributes birlikte → snapshot alanları korunur, fiyat override', async () => {
      await freeTable();
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          items: [
            {
              productId: PRODUCT_ID,
              quantity: 1,
              variantId: VARIANT_ID,
              selectedAttributes: [
                { groupId: ATTR_GROUP_ID, optionId: ATTR_OPTION_ID },
              ],
              // Katalog hesabı: 20000+1000+500=21500 olurdu; override BUNU EZER.
              unitPriceOverrideCents: 18000,
            },
          ],
        });
      expect(res.status).toBe(201);
      const item = res.body.data.items[0];
      expect(item.unit_price_cents).toBe(18000);
      expect(item.total_cents).toBe(18000);
      // K2 — varyant/özellik snapshot'ları DEĞİŞMEZ (fiyat override'a rağmen).
      expect(item.variant_id_snapshot).toBe(VARIANT_ID);
      expect(item.variant_name_snapshot).toBe('Büyük');
      const attrSnaps = await ctx.db!
        .selectFrom('order_item_attributes')
        .selectAll()
        .where('order_item_id', '=', item.id)
        .execute();
      expect(attrSnaps).toHaveLength(1);
      expect(attrSnaps[0]!.attribute_option_id).toBe(ATTR_OPTION_ID);
      await assertCatalogUnchanged();
    });

    it('(e) negatif override → 400 VALIDATION_ERROR', async () => {
      await freeTable();
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          items: [
            { productId: PRODUCT_ID, quantity: 1, unitPriceOverrideCents: -100 },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('(f) override YOK → bugünkü katalog davranışı (regresyon)', async () => {
      await freeTable();
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          items: [{ productId: PRODUCT_ID, quantity: 2 }],
        });
      expect(res.status).toBe(201);
      const item = res.body.data.items[0];
      expect(item.unit_price_cents).toBe(PRODUCT_PRICE);
      expect(item.total_cents).toBe(PRODUCT_PRICE * 2);
    });

    it('audit: dine_in override varsa order.created payload priceOverrides taşır', async () => {
      await freeTable();
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          items: [
            { productId: PRODUCT_ID, quantity: 1, unitPriceOverrideCents: 9999 },
          ],
        });
      const orderId = res.body.data.order.id as string;
      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .selectAll()
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.created')
        .where('entity_id', '=', orderId)
        .executeTakeFirst();
      expect(audit).toBeDefined();
      const payload = audit!.payload as {
        price_overrides?: Array<{
          itemId: string;
          catalogUnitPriceCents: number;
          overrideUnitPriceCents: number;
        }>;
      };
      expect(payload.price_overrides).toHaveLength(1);
      expect(payload.price_overrides![0]!.catalogUnitPriceCents).toBe(PRODUCT_PRICE);
      expect(payload.price_overrides![0]!.overrideUnitPriceCents).toBe(9999);
    });

    it('audit: dine_in override YOKSA order.created HİÇ yazılmaz (bugüne kadarki davranış korunur)', async () => {
      await freeTable();
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          tableId: TABLE_ID,
          orderType: 'dine_in',
          items: [{ productId: PRODUCT_ID, quantity: 1 }],
        });
      const orderId = res.body.data.order.id as string;
      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .selectAll()
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order.created')
        .where('entity_id', '=', orderId)
        .executeTakeFirst();
      expect(audit).toBeUndefined();
    });

    it('audit: add-items override varsa order_item.created payload priceOverrides taşır', async () => {
      await freeTable();
      const created = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({ tableId: TABLE_ID, orderType: 'dine_in', items: [] });
      const orderId = created.body.data.order.id as string;

      await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({
          items: [
            { productId: PRODUCT_ID, quantity: 1, unitPriceOverrideCents: 7777 },
          ],
        });

      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .selectAll()
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order_item.created')
        .where('entity_id', '=', orderId)
        .executeTakeFirst();
      expect(audit).toBeDefined();
      const payload = audit!.payload as {
        price_overrides?: Array<{ overrideUnitPriceCents: number }>;
      };
      expect(payload.price_overrides).toHaveLength(1);
      expect(payload.price_overrides![0]!.overrideUnitPriceCents).toBe(7777);
    });

    it('audit: add-items override YOKSA order_item.created HİÇ yazılmaz', async () => {
      await freeTable();
      const created = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({ tableId: TABLE_ID, orderType: 'dine_in', items: [] });
      const orderId = created.body.data.order.id as string;

      await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.token!}`)
        .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }] });

      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .selectAll()
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'order_item.created')
        .where('entity_id', '=', orderId)
        .executeTakeFirst();
      expect(audit).toBeUndefined();
    });
  },
);
