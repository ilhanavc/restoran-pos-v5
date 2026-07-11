import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { enqueueKitchenJob } from '../print/enqueue-kitchen-job.js';

/**
 * DERİN DENETİM Blok 8 — HAT A: print enqueue (kitchen + bill) — FINDINGS (KIRMIZI).
 *
 * Bu dosyadaki testler BİLİNÇLİ OLARAK KIRMIZI — her biri gerçek bir bulguyu
 * yeniden üretir. Prod kod DEĞİŞTİRİLMEDİ (kural gereği); implementer bu
 * testleri yeşile çevirene kadar kırmızı kalmalı. Severity + öneri
 * `qa-8A-report.md`'de.
 *
 * P8-ENQ-09 önemli nüans: `enqueueKitchenJob`'un dedup'suz olması YENİ bir
 * keşif DEĞİL — kod içi yorum (`enqueue-kitchen-job.ts:6-10`) ve Migration 039
 * yorumu ("order_id / unique index YOK — idempotent enqueue v5.1'e ertelendi,
 * ADR-004 §A3.4") bunu zaten belgeliyor. Bu test riski SOMUTLAŞTIRIR (gerçek
 * DB'de kanıtlanmış hâle getirir); mimari kararı geçersiz kılmaz — architect'in
 * "v5.1 backlog hâlâ doğru mu?" sorusunu canlı prod bağlamında yeniden
 * değerlendirmesi için kanıt sağlar.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `p8f-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `p8f-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

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

async function createDineInOrder(
  items: Array<{ productId: string; quantity: number }>,
): Promise<{ orderId: string; order: Record<string, unknown>; items: Array<Record<string, unknown>> }> {
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
  return {
    orderId: res.body.data.order.id as string,
    order: res.body.data.order as Record<string, unknown>,
    items: res.body.data.items as Array<Record<string, unknown>>,
  };
}

async function findJobs(
  orderId: string,
  kind?: 'kitchen' | 'bill',
): Promise<Array<{ payload: PrintJobPayload }>> {
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
    .map((j) => ({ payload: j.payload as unknown as PrintJobPayload }));
}

function decodeBytes(payload: PrintJobPayload): string {
  return Buffer.from(payload.bytesBase64, 'base64').toString('latin1');
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Blok 8 HAT A — print enqueue findings (KIRMIZI — implementer devri)',
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
        .values({ id: TENANT_ID, name: 'P8 Enqueue Findings Tenant', slug: `p8f-${TENANT_ID.slice(0, 8)}` })
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
    // P8-ENQ-08 [BUG] — Voided (status='cancelled') kalem, adisyon toplamından
    // dışlanmasına rağmen fişte SATIR olarak basılmaya devam ediyor.
    // ------------------------------------------------------------------
    it('P8-ENQ-08 [BUG]: voided item still printed on bill despite being excluded from total', async () => {
      const { orderId, items } = await createDineInOrder([
        { productId: PIDE_PRODUCT_ID, quantity: 2 }, // 28000
        { productId: AYRAN_PRODUCT_ID, quantity: 1 }, // 3000
      ]);
      const ayranItem = items.find((i) => i['product_name'] === 'Ayran')!;

      const voidRes = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${ayranItem['id'] as string}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(voidRes.status).toBe(200);
      // Sanity — total_cents void sonrası doğru dışlıyor (bug o katmanda DEĞİL).
      expect(voidRes.body.data.order.total_cents).toBe(28000);

      const billRes = await request(ctx.app!)
        .post(`/orders/${orderId}/print-bill`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send();
      expect(billRes.status).toBe(202);

      const billJobs = await findJobs(orderId, 'bill');
      const job = billJobs[0]!;

      // BEKLENEN (düzeltme sonrası): yalnız aktif kalem sayılır → 1.
      // GERÇEK (bugün): 2 — voided Ayran hâlâ sayılıyor. Bu satır KIRMIZI.
      expect(job.payload.meta['itemCount']).toBe(1);

      // BEKLENEN (düzeltme sonrası): "Ayran" fiş baytlarında GÖRÜNMEMELİ.
      // GERÇEK (bugün): görünüyor — TUTAR (28000) ile kalem listesi (31000
      // görünümü) uyuşmuyor, müşteri adisyonu yanıltıcı.
      const decoded = decodeBytes(job.payload);
      expect(decoded).not.toContain('Ayran');
    });

    // ------------------------------------------------------------------
    // P8-ENQ-09 [ROB] — `enqueueKitchenJob` aynı gönderim için ikinci kez
    // çağrılırsa dedup YOK → 2. fiziksel mutfak fişi (ADR-004 §A3.4 açık risk).
    // ------------------------------------------------------------------
    it('P8-ENQ-09 [ROB]: duplicate enqueueKitchenJob call for same send → duplicate print_jobs row', async () => {
      const { orderId, order } = await createDineInOrder([
        { productId: PIDE_PRODUCT_ID, quantity: 1 },
      ]);

      const baseline = await findJobs(orderId, 'kitchen');
      expect(baseline.length).toBe(1); // POST /orders zaten 1 kez enqueue etti.

      // Aynı "gönderim"i (aynı orderId, aynı hâlâ status='sent' kalemler)
      // ikinci kez tetikle — network retry / çağıran-hatası senaryosu.
      await enqueueKitchenJob(ctx.db!, {
        orderId,
        tenantId: TENANT_ID,
        orderNo: order['order_no'] as number,
        tableCodeSnapshot: order['table_code_snapshot'] as string | null,
        areaNameSnapshot: order['area_name_snapshot'] as string | null,
        waiterUserId: order['waiter_user_id'] as string | null,
      });

      const afterDuplicate = await findJobs(orderId, 'kitchen');
      // BEKLENEN (dedup eklenirse): 1. GERÇEK (bugün): 2 — bu satır KIRMIZI.
      expect(afterDuplicate.length).toBe(1);
    });
  },
);
