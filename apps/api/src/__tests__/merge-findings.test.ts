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
 * Blok 5 (Hat C) derin denetim — KASITLI KIRMIZI regresyon kilidi.
 *
 * PAY-04 / DB-TX-02 [HIGH] — `packages/db/src/repositories/orders.ts:1578-1586`
 * `mergeInto()` içindeki `ORDER_HAS_PAYMENTS` guard'ı (K3, ADR-029 Karar C):
 *
 *   const paymentRow = await tx
 *     .selectFrom('payments')
 *     .select(({ fn }) => fn.countAll<string>().as('cnt'))
 *     .where('tenant_id', '=', tenantId)
 *     .where('order_id', 'in', [source.id, target.id])
 *     .executeTakeFirst();
 *
 * `voided_at IS NULL` filtresi YOK (Migration 044 / ADR-033 soft-void —
 * `payments.ts:401`, `orders.ts:927` total_cents recalc ve `tables.ts:186`
 * doluluk sorgusu bu filtreyi UYGULARKEN, merge guard'ı UYGULAMIYOR). Sonuç:
 * kaynak veya hedef siparişte SADECE void edilmiş (geçersiz) bir ödeme kaydı
 * olsa bile COUNT > 0 olur → meşru (temiz) bir birleştirme 409
 * `ORDER_HAS_PAYMENTS` ile reddedilir. ADR-029 K3'ün amacı "ödemesi olan
 * adisyonu birleştirme" idi — void edilmiş (iptal edilmiş) bir ödeme adisyonu
 * artık "ödemeli" saymamalı; kasiyer void'ledikten sonra masaları birleştirmek
 * isterse bug'a takılır.
 *
 * Bu dosya İKİ testi de "doğru davranış" olarak yazar (200 bekler) — bugün
 * KIRMIZI (fail, gerçek yanıt 409). Implementer `voided_at IS NULL` filtresini
 * ekleyince testler yeşile döner ve regresyon paketinde kalır.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-pay04-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_USERNAME = `admin-pay04-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();

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

/** Fresh empty table with a real area (snapshot area_name non-null). */
async function insertTable(): Promise<string> {
  const id = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id,
      tenant_id: TENANT_ID,
      code: `M-P4-${randomUUID().slice(0, 6)}`,
      capacity: 4,
      area_id: AREA_ID,
    })
    .execute();
  return id;
}

/** Dine-in sipariş oluşturur; `qty` kalem miktarı (total = qty * 5000). */
async function createDineInOrder(
  token: string,
  tableId: string,
  qty = 1,
): Promise<string> {
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      tableId,
      orderType: 'dine_in',
      items: [{ productId: PRODUCT_ID, quantity: qty }],
    });
  if (res.status !== 201) {
    throw new Error(
      `dine-in POST failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.order.id as string;
}

/**
 * VOID edilmiş ödeme kaydı — Migration 044 (ADR-033) soft-void kolonları
 * dolu: `voided_at` + `void_reason_code` + `voided_by_user_id` (all-or-none
 * CHECK `payments_void_all_or_none`). "Kasiyer önce ödeme aldı, yanlış girdi
 * fark edip void'ledi" senaryosunun DB izdüşümü.
 */
async function insertVoidedPayment(
  orderId: string,
  amountCents: number,
): Promise<void> {
  await ctx.db!
    .insertInto('payments')
    .values({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      order_id: orderId,
      payment_type: 'cash',
      payment_scope: 'full',
      amount_cents: amountCents,
      idempotency_key: randomUUID(),
      created_by_user_id: ADMIN_ID,
      voided_at: new Date(),
      void_reason_code: 'other',
      voided_by_user_id: ADMIN_ID,
    })
    .execute();
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'PAY-04 [HIGH] — mergeInto ORDER_HAS_PAYMENTS guard void ödemeyi dışlamıyor (KASITLI KIRMIZI)',
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
          name: `PAY-04 Tenant ${TENANT_ID.slice(0, 8)}`,
          slug: `t-pay04-${TENANT_ID.slice(0, 8)}`,
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
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Adana Kebap',
          price_cents: 5000,
          is_active: true,
        })
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

    it('PAY-04: kaynakta SADECE void edilmiş ödeme varken merge YASAKLANMAMALI (bugün 409 — KIRMIZI)', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 1);
      const targetOrderId = await createDineInOrder(ctx.adminToken!, targetTableId, 1);

      // Kaynakta tek ödeme kaydı var ve VOID edilmiş — aktif ödeme YOK.
      await insertVoidedPayment(sourceOrderId, 5000);

      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });

      // BEKLENEN (doğru davranış, ADR-029 K3 niyeti): void ödeme aktif
      // sayılmamalı → merge başarılı olmalı (200). GERÇEK (PAY-04 bug):
      // `mergeInto` count sorgusu `voided_at IS NULL` filtrelemediği için
      // void satırı da sayılır → 409 ORDER_HAS_PAYMENTS. Bu blok bugün
      // KIRMIZI; implementer filtreyi ekleyince yeşile döner ve kalıcı
      // regresyon testi olarak kalır.
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(targetOrderId);
      expect(res.body.data.totalCents).toBe(10000);

      const sourceRow = await ctx
        .db!.selectFrom('orders')
        .select(['status', 'merged_into_order_id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('id', '=', sourceOrderId)
        .executeTakeFirstOrThrow();
      expect(sourceRow.status).toBe('merged');
      expect(sourceRow.merged_into_order_id).toBe(targetOrderId);
    });

    it('PAY-04 (hedef simetri): hedefte SADECE void edilmiş ödeme varken merge YASAKLANMAMALI (bugün 409 — KIRMIZI)', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(ctx.adminToken!, sourceTableId, 1);
      const targetOrderId = await createDineInOrder(ctx.adminToken!, targetTableId, 1);

      // Hedefte tek ödeme kaydı var ve VOID edilmiş — guard `IN (source,
      // target)` iki tarafı da aynı (filtresiz) sorguyla saydığı için simetrik
      // olarak kırılır.
      await insertVoidedPayment(targetOrderId, 5000);

      const res = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(targetOrderId);
    });
  },
);
