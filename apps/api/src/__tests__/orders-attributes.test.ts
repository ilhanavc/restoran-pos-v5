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
 * PR-6 (ADR-013 §10) — order item attribute resolution + snapshot tests.
 *
 * Kapsam:
 *   1. Optional grup, hiç seçim → 201, totalCents = product.price (extra=0)
 *   2. Optional grup, 1 option seçimi → 201, unit/total = base + extra; snapshot
 *      satırları order_item_attributes'ta yazılı.
 *   3. Required grup seçilmedi → 400 MISSING_REQUIRED_ATTRIBUTE.
 *   4. Single grupta >1 option → 400 INVALID_ATTRIBUTE_SELECTION.
 *   5. Yabancı groupId (ürünün effective listede yok) → 400 INVALID_ATTRIBUTE_SELECTION.
 *   6. optionId grup id'siyle uyuşmuyor → 400 INVALID_ATTRIBUTE_SELECTION.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-attr-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-attr-${randomUUID().slice(0, 8)}`;

const TABLE_ID = randomUUID();
const TABLE_CODE = `M-A-${randomUUID().slice(0, 6)}`;

const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRODUCT_PRICE = 10000; // 100.00 TL

// Required-single grup: "Boyut" (Küçük 0, Büyük +500)
const REQ_GROUP_ID = randomUUID();
const REQ_OPT_SMALL_ID = randomUUID();
const REQ_OPT_BIG_ID = randomUUID();

// Optional-multi grup: "Ekstra" (Kaşar +200, Sucuk +300)
const OPT_GROUP_ID = randomUUID();
const OPT_OPT_KASAR_ID = randomUUID();
const OPT_OPT_SUCUK_ID = randomUUID();

// Foreign group (ürüne atanmamış) — INVALID_ATTRIBUTE_SELECTION testi
const FOREIGN_GROUP_ID = randomUUID();
const FOREIGN_OPT_ID = randomUUID();

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
  'POST /orders + items[] + selectedAttributes (PR-6, ADR-013 §10)',
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
          name: 'Test Tenant Attrs',
          slug: `t-attrs-${TENANT_ID.slice(0, 8)}`,
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
          name: 'Karışık Pide',
          price_cents: PRODUCT_PRICE,
          is_active: true,
        })
        .execute();

      // Attribute groups
      await db
        .insertInto('attribute_groups')
        .values([
          {
            id: REQ_GROUP_ID,
            tenant_id: TENANT_ID,
            name: 'Boyut',
            selection_type: 'single',
            is_required: true,
          },
          {
            id: OPT_GROUP_ID,
            tenant_id: TENANT_ID,
            name: 'Ekstra',
            selection_type: 'multiple',
            is_required: false,
          },
          {
            id: FOREIGN_GROUP_ID,
            tenant_id: TENANT_ID,
            name: 'Yabancı',
            selection_type: 'single',
            is_required: false,
          },
        ])
        .execute();

      await db
        .insertInto('attribute_options')
        .values([
          {
            id: REQ_OPT_SMALL_ID,
            tenant_id: TENANT_ID,
            group_id: REQ_GROUP_ID,
            name: 'Küçük',
            extra_price_cents: 0,
          },
          {
            id: REQ_OPT_BIG_ID,
            tenant_id: TENANT_ID,
            group_id: REQ_GROUP_ID,
            name: 'Büyük',
            extra_price_cents: 500,
          },
          {
            id: OPT_OPT_KASAR_ID,
            tenant_id: TENANT_ID,
            group_id: OPT_GROUP_ID,
            name: 'Kaşar',
            extra_price_cents: 200,
          },
          {
            id: OPT_OPT_SUCUK_ID,
            tenant_id: TENANT_ID,
            group_id: OPT_GROUP_ID,
            name: 'Sucuk',
            extra_price_cents: 300,
          },
          {
            id: FOREIGN_OPT_ID,
            tenant_id: TENANT_ID,
            group_id: FOREIGN_GROUP_ID,
            name: 'Foo',
            extra_price_cents: 100,
          },
        ])
        .execute();

      // Product → group assignment (REQ + OPT, NOT FOREIGN)
      await db
        .insertInto('product_attribute_groups')
        .values([
          {
            id: randomUUID(),
            tenant_id: TENANT_ID,
            product_id: PRODUCT_ID,
            group_id: REQ_GROUP_ID,
          },
          {
            id: randomUUID(),
            tenant_id: TENANT_ID,
            product_id: PRODUCT_ID,
            group_id: OPT_GROUP_ID,
          },
        ])
        .execute();

      ctx.token = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      const db = ctx.db;
      if (db === undefined) return;
      await db
        .deleteFrom('order_item_attributes')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('order_items')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
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
        .deleteFrom('products')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('categories')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await db
        .deleteFrom('tables')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
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
      await db.destroy();
    });

    async function freeTable(): Promise<void> {
      // FK cleanup order: attributes → items → orders (cascade off, ON DELETE
      // RESTRICT in 017 + default RESTRICT for items).
      await ctx.db!
        .deleteFrom('order_item_attributes')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db!
        .deleteFrom('order_items')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db!
        .deleteFrom('orders')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
    }

    it('required+single seçim, optional yok → 201; unit_price = base + req.extra', async () => {
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
              quantity: 2,
              selectedAttributes: [
                { groupId: REQ_GROUP_ID, optionId: REQ_OPT_BIG_ID },
              ],
            },
          ],
        });
      expect(res.status).toBe(201);
      const item = res.body.data.items[0];
      expect(item.unit_price_cents).toBe(PRODUCT_PRICE + 500);
      expect(item.total_cents).toBe((PRODUCT_PRICE + 500) * 2);
      // Snapshot satırları yazıldı mı?
      const snaps = await ctx.db!
        .selectFrom('order_item_attributes')
        .selectAll()
        .where('order_item_id', '=', item.id)
        .execute();
      expect(snaps).toHaveLength(1);
      expect(snaps[0]!.attribute_group_id).toBe(REQ_GROUP_ID);
      expect(snaps[0]!.attribute_option_id).toBe(REQ_OPT_BIG_ID);
      expect(snaps[0]!.extra_price_cents_snapshot).toBe(500);
      expect(snaps[0]!.group_name_snapshot).toBe('Boyut');
      expect(snaps[0]!.option_name_snapshot).toBe('Büyük');
    });

    it('required+single + multi grup 2 option → 201; unit = base + 0 + 200 + 300', async () => {
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
              selectedAttributes: [
                { groupId: REQ_GROUP_ID, optionId: REQ_OPT_SMALL_ID },
                { groupId: OPT_GROUP_ID, optionId: OPT_OPT_KASAR_ID },
                { groupId: OPT_GROUP_ID, optionId: OPT_OPT_SUCUK_ID },
              ],
            },
          ],
        });
      expect(res.status).toBe(201);
      const item = res.body.data.items[0];
      expect(item.unit_price_cents).toBe(PRODUCT_PRICE + 0 + 200 + 300);
      expect(item.total_cents).toBe(PRODUCT_PRICE + 0 + 200 + 300);
      const snaps = await ctx.db!
        .selectFrom('order_item_attributes')
        .selectAll()
        .where('order_item_id', '=', item.id)
        .execute();
      expect(snaps).toHaveLength(3);
    });

    it('required grup seçilmedi → 400 MISSING_REQUIRED_ATTRIBUTE', async () => {
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
              selectedAttributes: [
                { groupId: OPT_GROUP_ID, optionId: OPT_OPT_KASAR_ID },
              ],
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_REQUIRED_ATTRIBUTE');
      expect(res.body.error.details.groupId).toBe(REQ_GROUP_ID);
      expect(res.body.error.details.groupName).toBe('Boyut');
    });

    it('single grupta 2 option → 400 INVALID_ATTRIBUTE_SELECTION', async () => {
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
              selectedAttributes: [
                { groupId: REQ_GROUP_ID, optionId: REQ_OPT_SMALL_ID },
                { groupId: REQ_GROUP_ID, optionId: REQ_OPT_BIG_ID },
              ],
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ATTRIBUTE_SELECTION');
      expect(res.body.error.details.reason).toBe('SINGLE_GROUP_MULTIPLE_OPTIONS');
    });

    it('ürüne atanmamış grup → 400 INVALID_ATTRIBUTE_SELECTION (GROUP_NOT_ASSIGNED)', async () => {
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
              selectedAttributes: [
                { groupId: REQ_GROUP_ID, optionId: REQ_OPT_SMALL_ID },
                { groupId: FOREIGN_GROUP_ID, optionId: FOREIGN_OPT_ID },
              ],
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ATTRIBUTE_SELECTION');
      expect(res.body.error.details.reason).toBe('GROUP_NOT_ASSIGNED');
    });

    it('optionId yanlış grup id ile → 400 INVALID_ATTRIBUTE_SELECTION (OPTION_NOT_IN_GROUP)', async () => {
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
              selectedAttributes: [
                { groupId: REQ_GROUP_ID, optionId: OPT_OPT_KASAR_ID }, // option Ekstra grubuna ait
              ],
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ATTRIBUTE_SELECTION');
      expect(res.body.error.details.reason).toBe('OPTION_NOT_IN_GROUP');
    });

    it('GET /products/:id/attribute-groups/effective-with-options → groups + options', async () => {
      const res = await request(ctx.app!)
        .get(`/products/${PRODUCT_ID}/attribute-groups/effective-with-options`)
        .set('Authorization', `Bearer ${ctx.token!}`);
      expect(res.status).toBe(200);
      const groups = res.body.data.groups as Array<{
        id: string;
        name: string;
        options: Array<{ id: string; name: string; extra_price_cents: number }>;
      }>;
      expect(groups.length).toBeGreaterThanOrEqual(2);
      const reqGroup = groups.find((g) => g.id === REQ_GROUP_ID);
      expect(reqGroup).toBeDefined();
      expect(reqGroup!.options).toHaveLength(2);
      const optGroup = groups.find((g) => g.id === OPT_GROUP_ID);
      expect(optGroup).toBeDefined();
      expect(optGroup!.options).toHaveLength(2);
      // Foreign group ürüne atanmadı, çıkmaz
      expect(groups.find((g) => g.id === FOREIGN_GROUP_ID)).toBeUndefined();
    });

    it('DELETE /products/:id/attribute-groups/:groupId → 204 + audit entity_id gerçek UUID', async () => {
      // S103 CANLI BUG REGRESYONU: audit kaydına entity_id olarak
      // `${productId}:${groupId}` kompoziti yazılıyordu. `audit_logs.entity_id`
      // UUID tipinde olduğu için HER kaldırma isteği 22P02 ile 500 dönüyordu
      // (ekleme çalışıyordu — o gerçek UUID yazıyor). Bu uç hiç test edilmemişti.
      const assignRes = await request(ctx.app!)
        .post(`/products/${PRODUCT_ID}/attribute-groups/${FOREIGN_GROUP_ID}`)
        .set('Authorization', `Bearer ${ctx.token!}`);
      expect(assignRes.status).toBe(200);

      const delRes = await request(ctx.app!)
        .delete(`/products/${PRODUCT_ID}/attribute-groups/${FOREIGN_GROUP_ID}`)
        .set('Authorization', `Bearer ${ctx.token!}`);
      expect(delRes.status).toBe(204);

      const audit = await ctx
        .db!.selectFrom('audit_logs')
        .select(['entity_id', 'entity_type'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'product_attributes.unassigned')
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      expect(audit).toBeDefined();
      expect(audit!.entity_type).toBe('product_attribute_group');
      expect(audit!.entity_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      // İkinci kaldırma idempotent: satır yok → audit yazılmaz, yine 204.
      const delAgain = await request(ctx.app!)
        .delete(`/products/${PRODUCT_ID}/attribute-groups/${FOREIGN_GROUP_ID}`)
        .set('Authorization', `Bearer ${ctx.token!}`);
      expect(delAgain.status).toBe(204);
    });
  },
);
