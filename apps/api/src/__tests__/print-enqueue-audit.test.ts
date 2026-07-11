import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { signAccessToken } from '../auth/jwt';

/**
 * DERİN DENETİM Blok 8 — HAT A: print enqueue (kitchen + bill) — AUDIT (YEŞİL).
 *
 * Kapsam: `enqueueKitchenJob` / `enqueueBillJob` (apps/api/src/print/*.ts) —
 * ADR-032 (iş-türü routing: kitchen vs bill), idempotency, kısmi başarısızlık
 * (boş/çok-kalemli sipariş), payload doğruluğu (snapshot/tenant), tenant scope.
 *
 * Bu dosya CANLI (geçen) davranışı belgeler/kilitler. Bulunan gerçek hatalar
 * `print-enqueue-findings.test.ts` (KIRMIZI) dosyasındadır — orada AYRI rapor
 * edilir, burada TEKRAR EDİLMEZ.
 *
 * Desen: `print-jobs-enqueue.test.ts` ile birebir aynı (skipIf + izole tenant +
 * FK-sıralı cleanup + pool.end). Mevcut testler DEĞİŞTİRİLMEDİ.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `p8a-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `p8a-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

// Gerçekçi Türk lokanta menüsü: Pideler (mutfak) + İçecekler (bar/kasa).
let KITCHEN_CATEGORY_ID: string;
let BAR_CATEGORY_ID: string;
let PIDE_PRODUCT_ID: string;
let AYRAN_PRODUCT_ID: string;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
}
const ctx: Partial<TestCtx> = {};

interface PrintJobPayload {
  kind: string;
  bytesBase64: string;
  meta: Record<string, unknown>;
}

async function loginAndGetToken(
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

/** Bağımsız masa + dine_in sipariş oluşturur (masa çakışmasını önlemek için her çağrı kendi masasını açar). */
async function createDineInOrder(
  items: Array<{ productId: string; quantity: number }>,
): Promise<{ orderId: string; order: Record<string, unknown> }> {
  const tableId = randomUUID();
  await ctx.db!
    .insertInto('tables')
    .values({
      id: tableId,
      tenant_id: TENANT_ID,
      code: `M-${randomUUID().slice(0, 6)}`,
      capacity: 4,
    })
    .execute();
  const res = await request(ctx.app!)
    .post('/orders')
    .set('Authorization', `Bearer ${ctx.adminToken!}`)
    .send({ tableId, orderType: 'dine_in', items });
  if (res.status !== 201) {
    throw new Error(`order create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { orderId: res.body.data.order.id as string, order: res.body.data.order };
}

/** `print_jobs`'u meta.orderId (+ opsiyonel kind) ile filtreler. */
async function findJobs(
  orderId: string,
  kind?: 'kitchen' | 'bill',
): Promise<Array<{ status: string; attempts: number; retry_at: Date | null; payload: PrintJobPayload }>> {
  const jobs = await ctx.db!
    .selectFrom('print_jobs')
    .selectAll()
    .where('tenant_id', '=', TENANT_ID)
    .execute();
  return jobs
    .filter((j) => {
      const p = j.payload as unknown as PrintJobPayload;
      return p.meta?.['orderId'] === orderId && (kind === undefined || p.kind === kind);
    })
    .map((j) => ({
      status: j.status,
      attempts: j.attempts,
      retry_at: j.retry_at,
      payload: j.payload as unknown as PrintJobPayload,
    }));
}

function decodeBytes(payload: PrintJobPayload): string {
  // CP857, ASCII aralığında (0x00-0x7F) latin1 ile birebir örtüşür — ASCII-safe
  // alt-dizeler (örn. "Pide", "Ayran") için güvenli substring kontrolü.
  return Buffer.from(payload.bytesBase64, 'base64').toString('latin1');
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Blok 8 HAT A — print enqueue audit (ADR-032 routing + idempotency)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.app = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: AGENT_SECRET,
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({ id: TENANT_ID, name: 'P8 Enqueue Audit Tenant', slug: `p8a-${TENANT_ID.slice(0, 8)}` })
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

      KITCHEN_CATEGORY_ID = randomUUID();
      BAR_CATEGORY_ID = randomUUID();
      await db
        .insertInto('categories')
        .values([
          { id: KITCHEN_CATEGORY_ID, tenant_id: TENANT_ID, name: 'Pideler', sort_order: 1, kitchen_print: true },
          { id: BAR_CATEGORY_ID, tenant_id: TENANT_ID, name: 'İçecekler', sort_order: 2, kitchen_print: false },
        ])
        .execute();

      PIDE_PRODUCT_ID = randomUUID();
      AYRAN_PRODUCT_ID = randomUUID();
      await db
        .insertInto('products')
        .values([
          { id: PIDE_PRODUCT_ID, tenant_id: TENANT_ID, category_id: KITCHEN_CATEGORY_ID, name: 'Kuşbaşılı Pide', price_cents: 14000, is_active: true },
          { id: AYRAN_PRODUCT_ID, tenant_id: TENANT_ID, category_id: BAR_CATEGORY_ID, name: 'Ayran', price_cents: 3000, is_active: true },
        ])
        .execute();

      ctx.adminToken = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('payments').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_item_attributes').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_items').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('orders').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('products').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('categories').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tables').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    // ------------------------------------------------------------------
    // P8-ENQ-01 — Routing: karışık sipariş (Pide+Ayran) → kitchen job'a
    // YALNIZ kitchen_print=true kalem girer.
    // ------------------------------------------------------------------
    it('P8-ENQ-01: mixed order (Pide+Ayran) → kitchen job routes ONLY kitchen_print=true item', async () => {
      const { orderId } = await createDineInOrder([
        { productId: PIDE_PRODUCT_ID, quantity: 2 },
        { productId: AYRAN_PRODUCT_ID, quantity: 1 },
      ]);

      const kitchenJobs = await findJobs(orderId, 'kitchen');
      expect(kitchenJobs.length).toBe(1);
      const job = kitchenJobs[0]!;
      expect(job.status).toBe('queued');
      // Migration 036/039 kontratı: taze queued job attempts=0, retry_at=null.
      expect(job.attempts).toBe(0);
      expect(job.retry_at).toBeNull();
      expect(job.payload.meta['itemCount']).toBe(1); // yalnız Pide

      const decoded = decodeBytes(job.payload);
      expect(decoded).toContain('Pide');
      expect(decoded).not.toContain('Ayran');

      const items = await ctx.db!
        .selectFrom('order_items')
        .select(['product_name', 'status'])
        .where('order_id', '=', orderId)
        .execute();
      const pide = items.find((i) => i.product_name.includes('Pide'));
      const ayran = items.find((i) => i.product_name === 'Ayran');
      expect(pide?.status).toBe('sent'); // mutfağa gönderildi
      expect(ayran?.status).toBe('new'); // asla mutfağa gitmedi (kitchen_print=false)
    });

    // ------------------------------------------------------------------
    // P8-ENQ-02 — Bill (adisyon) job: kategori farketmeksizin TÜM kalemler.
    // ------------------------------------------------------------------
    it('P8-ENQ-02: print-bill → bill job includes ALL items regardless of category', async () => {
      const { orderId } = await createDineInOrder([
        { productId: PIDE_PRODUCT_ID, quantity: 1 },
        { productId: AYRAN_PRODUCT_ID, quantity: 2 },
      ]);

      const billRes = await request(ctx.app!)
        .post(`/orders/${orderId}/print-bill`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send();
      expect(billRes.status).toBe(202);

      const billJobs = await findJobs(orderId, 'bill');
      expect(billJobs.length).toBe(1);
      const job = billJobs[0]!;
      expect(job.payload.meta['itemCount']).toBe(2); // Pide + Ayran ikisi de

      const decoded = decodeBytes(job.payload);
      expect(decoded).toContain('Pide');
      expect(decoded).toContain('Ayran');
    });

    // ------------------------------------------------------------------
    // P8-ENQ-03 — Boş (0 kalem) header-only sipariş → kitchen job YOK, çökme YOK.
    // ------------------------------------------------------------------
    it('P8-ENQ-03: header-only (0 item) dine_in order → 0 kitchen jobs, no crash', async () => {
      const { orderId } = await createDineInOrder([]);
      const kitchenJobs = await findJobs(orderId, 'kitchen');
      expect(kitchenJobs.length).toBe(0);
    });

    // ------------------------------------------------------------------
    // P8-ENQ-04 — Aynı boş sipariş için adisyon bastır → yine de zarifçe kuyruğa girer.
    // ------------------------------------------------------------------
    it('P8-ENQ-04: print-bill on 0-item order → still enqueues gracefully (itemCount=0)', async () => {
      const { orderId } = await createDineInOrder([]);
      const billRes = await request(ctx.app!)
        .post(`/orders/${orderId}/print-bill`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send();
      expect(billRes.status).toBe(202);
      expect(billRes.body.data.enqueued).toBe(true);

      const billJobs = await findJobs(orderId, 'bill');
      expect(billJobs.length).toBe(1);
      const job = billJobs[0]!;
      expect(job.payload.meta['itemCount']).toBe(0);
      expect(job.payload.meta['totalCents']).toBe(0);
      const decoded = decodeBytes(job.payload);
      expect(decoded.length).toBeGreaterThan(0);
      expect(decoded).toContain('TUTAR'); // boş da olsa geçerli fiş gövdesi render edilir
    });

    // ------------------------------------------------------------------
    // P8-ENQ-05 — Çok-kalemli (45) sipariş → tek kitchen job, itemCount=45, kırpılma yok.
    // ------------------------------------------------------------------
    it('P8-ENQ-05: 45-item bulk order → 1 kitchen job, itemCount=45, no truncation', async () => {
      const items = Array.from({ length: 45 }, () => ({ productId: PIDE_PRODUCT_ID, quantity: 1 }));
      const { orderId } = await createDineInOrder(items);

      const kitchenJobs = await findJobs(orderId, 'kitchen');
      expect(kitchenJobs.length).toBe(1);
      const job = kitchenJobs[0]!;
      expect(job.payload.meta['itemCount']).toBe(45);
      const decoded = decodeBytes(job.payload);
      // 45 satır Pide + başlık/toplam bloğu; kaba alt-sınır kırpılma olmadığını kanıtlar.
      expect(decoded.length).toBeGreaterThan(45 * 10);
      expect((decoded.match(/Pide/g) ?? []).length).toBeGreaterThanOrEqual(45);
    }, 20_000);

    // ------------------------------------------------------------------
    // P8-ENQ-06 — SEC: çapraz-tenant print-bill → 404, yanlış tenant'a job YAZILMAZ.
    // ------------------------------------------------------------------
    it('P8-ENQ-06: cross-tenant print-bill → 404 ORDER_NOT_FOUND, no job leaks across tenants', async () => {
      const TENANT_B_ID = randomUUID();
      const ADMIN_B_EMAIL = `p8a-b-admin-${randomUUID()}@example.com`;
      const ADMIN_B_USERNAME = `p8a-b-${randomUUID().slice(0, 8)}`;
      await ctx.db!
        .insertInto('tenants')
        .values({ id: TENANT_B_ID, name: 'P8 Enqueue Audit Tenant B', slug: `p8a-b-${TENANT_B_ID.slice(0, 8)}` })
        .execute();
      await ctx.db!.insertInto('tenant_settings').values({ tenant_id: TENANT_B_ID }).execute();
      const bHash = await hashPassword(ADMIN_PASSWORD);
      const adminBId = randomUUID();
      await ctx.db!
        .insertInto('users')
        .values({
          id: adminBId,
          tenant_id: TENANT_B_ID,
          email: ADMIN_B_EMAIL,
          username: ADMIN_B_USERNAME,
          password_hash: bHash,
          role: 'admin',
        })
        .execute();
      const catBId = randomUUID();
      await ctx.db!
        .insertInto('categories')
        .values({ id: catBId, tenant_id: TENANT_B_ID, name: 'Pideler B', sort_order: 1, kitchen_print: true })
        .execute();
      const prodBId = randomUUID();
      await ctx.db!
        .insertInto('products')
        .values({ id: prodBId, tenant_id: TENANT_B_ID, category_id: catBId, name: 'Lahmacun', price_cents: 6000, is_active: true })
        .execute();
      const tableBId = randomUUID();
      await ctx.db!
        .insertInto('tables')
        .values({ id: tableBId, tenant_id: TENANT_B_ID, code: `MB-${randomUUID().slice(0, 6)}`, capacity: 4 })
        .execute();
      // NOT: `buildApp({ tenantId: TENANT_ID })` — /auth/login yalnız O SABİT
      // tenant içinde arar (tek-tenant-per-deployment kısayolu); Tenant B
      // admin'i bu app instance'ında GERÇEK login ile alınamaz (401 üretir).
      // Route katmanı ise `req.user.tenantId` (JWT claim) ile scope eder —
      // bu yüzden token'ı doğrudan aynı ACCESS_SECRET ile mint ediyoruz
      // (login akışını bypass, route-level tenant izolasyonunu test eder).
      const tokenB = signAccessToken(
        { sub: adminBId, tenant_id: TENANT_B_ID, role: 'admin' },
        ACCESS_SECRET,
      );
      try {
        const orderBRes = await request(ctx.app!)
          .post('/orders')
          .set('Authorization', `Bearer ${tokenB}`)
          .send({ tableId: tableBId, orderType: 'dine_in', items: [{ productId: prodBId, quantity: 1 }] });
        expect(orderBRes.status).toBe(201);
        const orderBId = orderBRes.body.data.order.id as string;

        // Tenant A admin token'ı ile Tenant B'nin siparişini bastırmayı dene.
        const crossRes = await request(ctx.app!)
          .post(`/orders/${orderBId}/print-bill`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send();
        expect(crossRes.status).toBe(404);
        expect(crossRes.body.error?.code).toBe('ORDER_NOT_FOUND');

        // Tenant A adına hiçbir job yazılmadı (yanlış-tenant sızıntısı yok).
        const leakedUnderA = await ctx.db!
          .selectFrom('print_jobs')
          .selectAll()
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        const leaked = leakedUnderA.find(
          (j) => (j.payload as unknown as PrintJobPayload).meta?.['orderId'] === orderBId,
        );
        expect(leaked).toBeUndefined();
      } finally {
        // Cleanup (Tenant B, FK sırası) — assertion başarısız olsa bile çalışır
        // (izole debris pos_test'te kalmasın).
        await ctx.db!.deleteFrom('print_jobs').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('order_items').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('orders').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('order_no_counters').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('products').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('categories').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('tables').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('users').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('tenant_settings').where('tenant_id', '=', TENANT_B_ID).execute();
        await ctx.db!.deleteFrom('tenants').where('id', '=', TENANT_B_ID).execute();
      }
    });

    // ------------------------------------------------------------------
    // P8-ENQ-07 — Kasıtlı reprint: aynı adisyonu 2 kez bastır → 2 bağımsız,
    // doğru biçimli bill job (istenen davranış — reprint özelliği; dedup YOK).
    // ------------------------------------------------------------------
    it('P8-ENQ-07: explicit reprint (print-bill x2) → 2 independent well-formed bill jobs (by design)', async () => {
      const { orderId } = await createDineInOrder([{ productId: PIDE_PRODUCT_ID, quantity: 1 }]);

      const first = await request(ctx.app!)
        .post(`/orders/${orderId}/print-bill`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send();
      const second = await request(ctx.app!)
        .post(`/orders/${orderId}/print-bill`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send();
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);

      const billJobs = await findJobs(orderId, 'bill');
      expect(billJobs.length).toBe(2);
      for (const job of billJobs) {
        expect(job.status).toBe('queued');
        expect(job.payload.kind).toBe('bill');
        expect(job.payload.meta['itemCount']).toBe(1);
      }
    });
  },
);
