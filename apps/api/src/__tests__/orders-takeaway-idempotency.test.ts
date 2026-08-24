import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import request from 'supertest';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * ADR-039 K1 — paket sipariş oluşturma idempotency'si + rol hattı.
 *
 * Kapsam (ADR-039 DoD 21, 22, 23c):
 *   - 21: garsonun oluşturduğu takeaway ADR-017 CHECK'lerini karşılar ve
 *         mutfak + paket fişi işleri DOĞRU kuyruğa girer (ADR-032 Amd3)
 *   - 22: **aynı idempotency key ile iki istek → TEK sipariş, TEK fiş seti.**
 *         Mobil ağı kararsızdır; bu olmadan retry = çift fiş = çift para.
 *         Fiş sayısı asserti kritiktir: basılan kâğıt geri alınamaz, dolayısıyla
 *         "sipariş tek ama fiş iki" da bir BAŞARISIZLIKTIR
 *   - 23c: `kitchen` rolü `POST /orders` (takeaway) → 403 (K10.3'ün sunucu
 *          hattı; FAB'ın gizlenmesi bir UX kararıdır, koruma BURADADIR)
 *
 * Testler `pos_test` üzerinde koşar (`pos_dev` DEĞİL).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const TENANT_ID = randomUUID();

interface Ctx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  waiterToken: string;
  kitchenToken: string;
}
const ctx: Partial<Ctx> = {};

const WAITER = {
  id: randomUUID(),
  email: `ta-waiter-${randomUUID()}@example.com`,
  username: `ta-waiter-${randomUUID().slice(0, 8)}`,
  password: 'waiterpass12345',
};
const KITCHEN = {
  id: randomUUID(),
  email: `ta-kitchen-${randomUUID()}@example.com`,
  username: `ta-kitchen-${randomUUID().slice(0, 8)}`,
  password: 'kitchenpass12345',
};

const CUSTOMER_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();

let previousBypass: string | undefined;

async function login(email: string, password: string): Promise<string> {
  const res = await request(ctx.app!)
    .post('/auth/login')
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-039 K1 — POST /orders (takeaway) idempotency + rol hattı',
  () => {
    beforeAll(async () => {
      previousBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';

      const pool = createPool({ connectionString: DB_URL ?? '' });
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
          name: 'Takeaway Idem',
          slug: `ta-idem-${TENANT_ID.slice(0, 8)}`,
        })
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('users')
        .values([
          {
            id: WAITER.id,
            tenant_id: TENANT_ID,
            email: WAITER.email,
            username: WAITER.username,
            password_hash: await hashPassword(WAITER.password),
            role: 'waiter',
          },
          {
            id: KITCHEN.id,
            tenant_id: TENANT_ID,
            email: KITCHEN.email,
            username: KITCHEN.username,
            password_hash: await hashPassword(KITCHEN.password),
            role: 'kitchen',
          },
        ])
        .execute();

      // `kitchen_print: true` → mutfak fişi kuyruğa girer (ADR-020 K2).
      await db
        .insertInto('categories')
        .values({
          id: CATEGORY_ID,
          tenant_id: TENANT_ID,
          name: 'Pideler',
          sort_order: 1,
          kitchen_print: true,
        })
        .execute();
      await db
        .insertInto('products')
        .values({
          id: PRODUCT_ID,
          tenant_id: TENANT_ID,
          category_id: CATEGORY_ID,
          name: 'Kusbasili Pide',
          price_cents: 14000,
          is_active: true,
        })
        .execute();
      await db
        .insertInto('customers')
        .values({
          id: CUSTOMER_ID,
          tenant_id: TENANT_ID,
          full_name: 'Idem Musteri',
        })
        .execute();
      await db
        .insertInto('customer_phones')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          customer_id: CUSTOMER_ID,
          raw_phone: '05321234599',
          normalized_phone: '905321234599',
          is_primary: true,
        })
        .execute();

      ctx.waiterToken = await login(WAITER.email, WAITER.password);
      ctx.kitchenToken = await login(KITCHEN.email, KITCHEN.password);
    });

    afterAll(async () => {
      if (previousBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = previousBypass;
      }
      if (ctx.db === undefined) return;
      await ctx.db
        .deleteFrom('print_jobs')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('order_items')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('orders')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('refresh_tokens')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('customer_phones')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('customers')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('product_variants')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('products')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('categories')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('audit_logs')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('users')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db
        .deleteFrom('tenant_settings')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      // Sipariş numarası sayacı `tenants`'a FK'lidir ve CASCADE DEĞİLDİR →
      // silinmezse `DELETE FROM tenants` 23503 verir (cross-FK cleanup zinciri
      // dersi). Sipariş OLUŞTURAN her test dosyasının kapatması gereken halka.
      await ctx.db
        .deleteFrom('order_no_counters')
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
      await ctx.pool?.end();
    });

    /**
     * Bir siparişe ait fiş işleri. `print_jobs` tablosunda `order_id`/`kind`
     * KOLONU YOKTUR — ikisi de `payload` JSON'ının içindedir
     * (`payload.kind`, `payload.meta.orderId`). Paket fişi `kind='bill'` +
     * `meta.variant='packing'` ile ayrılır (ADR-032 Amd3 K4: kasa agent'ı
     * zaten `bill` claim ettiği için yeni bir kind icat EDİLMEDİ).
     */
    async function printJobsOf(orderId: string): Promise<{
      kitchen: number;
      packing: number;
    }> {
      const rows = await ctx.db!
        .selectFrom('print_jobs')
        .select(['payload'])
        .where('tenant_id', '=', TENANT_ID)
        .execute();
      let kitchen = 0;
      let packing = 0;
      for (const row of rows) {
        const payload = row.payload as {
          kind?: string;
          meta?: { orderId?: string; variant?: string };
        };
        if (payload.meta?.orderId !== orderId) continue;
        if (payload.meta?.variant === 'packing') packing += 1;
        else if (payload.kind !== 'bill') kitchen += 1;
      }
      return { kitchen, packing };
    }

    function body(idempotencyKey?: string): object {
      return {
        type: 'takeaway',
        customerId: CUSTOMER_ID,
        plannedPaymentType: 'cash',
        items: [{ productId: PRODUCT_ID, quantity: 2 }],
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      };
    }

    // ─── DoD 23c — sunucu hattı (FAB gizleme YETKİ DEĞİLDİR) ──────────────
    it('mutfak (kitchen) rolü paket sipariş OLUŞTURAMAZ → 403', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send(body(randomUUID()));
      expect(res.status).toBe(403);
    });

    // ─── DoD 21 — garson siparişi + fiş kuyruğu ───────────────────────────
    it('garson siparişi ADR-017 invaryantlarını karşılar ve İKİ fiş kuyruğa girer', async () => {
      const res = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send(body(randomUUID()));

      expect(res.status).toBe(201);
      // Yanıt DÜZ DTO'dur (`{data:{order,items}}` DEĞİL) — mobil parser bunu
      // okur; şekil kayarsa yalnız canlı cihazda patlar.
      expect(res.body.data.id).toBeTruthy();
      expect(res.body.data.items).toBeDefined();

      const orderId = res.body.data.id as string;
      const row = await ctx.db!
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();
      // ADR-017 CHECK'leri: takeaway ⇒ customer_id NOT NULL, stage/planned set.
      expect(row.order_type).toBe('takeaway');
      expect(row.status).toBe('open');
      expect(row.takeaway_stage).toBe('preparing');
      expect(row.customer_id).toBe(CUSTOMER_ID);
      expect(row.planned_payment_type).toBe('cash');
      // ADR-008 §4.1 — actor garson; ABAC scope'u buna dayanır.
      expect(row.waiter_user_id).toBe(WAITER.id);

      // ADR-032 Amd3 — mutfak fişi + paket (kasa) fişi.
      const jobs = await printJobsOf(orderId);
      expect(jobs.kitchen).toBe(1);
      expect(jobs.packing).toBe(1);
    });

    // ─── DoD 22 — idempotency (K1, pazarlığa açık değil) ──────────────────
    it('aynı key ile İKİ istek → TEK sipariş, TEK fiş seti', async () => {
      const key = randomUUID();

      const first = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send(body(key));
      expect(first.status).toBe(201);
      const orderId = first.body.data.id as string;

      // Retry — mobilde timeout sonrası "Tekrar Dene" AYNI key'i taşır.
      const second = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send(body(key));
      // Replay 200 döner (201 DEĞİL): yeni kaynak yaratılmadı.
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(orderId);

      const orders = await ctx.db!
        .selectFrom('orders')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('idempotency_key', '=', key)
        .execute();
      expect(orders).toHaveLength(1);

      // Kalemler de duplike olmamalı (2 adet TEK satır).
      const items = await ctx.db!
        .selectFrom('order_items')
        .select(['id'])
        .where('order_id', '=', orderId)
        .execute();
      expect(items).toHaveLength(1);

      // EN KRİTİK ASSERT: fiş sayısı. Basılan kâğıt geri alınamaz; "sipariş
      // tek ama mutfak fişi iki" de bir başarısızlıktır.
      const jobs = await printJobsOf(orderId);
      expect(jobs.kitchen).toBe(1);
      expect(jobs.packing).toBe(1);

      // Denetim izi de tek kalır (replay ikinci `order.created` yazmaz).
      const audits = await ctx.db!
        .selectFrom('audit_logs')
        .select(['id'])
        .where('entity_id', '=', orderId)
        .where('event_type', '=', 'order.created')
        .execute();
      expect(audits).toHaveLength(1);
    });

    it('`Idempotency-Key` HEADER de kabul edilir (gövde alanı paritesi)', async () => {
      const key = randomUUID();
      const first = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .set('Idempotency-Key', key)
        .send(body());
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .set('Idempotency-Key', key)
        .send(body());
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);
    });

    it('key GÖNDERİLMEZSE eski davranış korunur (iki ayrı sipariş)', async () => {
      // Karar 5 "opsiyonel-başla": eski istemci guard'sız yolda çalışır.
      const first = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send(body());
      const second = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send(body());
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.id).not.toBe(first.body.data.id);
    });
  },
);
