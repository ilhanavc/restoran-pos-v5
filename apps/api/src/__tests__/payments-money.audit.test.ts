import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Derin Denetim Blok 5 (Hat B) — PARA-KRİTİK YEŞİL invariant/regresyon
 * kilidi. Bu dosyadaki testler BUGÜN GEÇER (temiz alanları kanıtlar) ve
 * gelecekte regresyona karşı kilit görevi görür. Kırmızı (bug) bulgular
 * `payments-money.findings.test.ts` içinde. Prod kod DEĞİŞTİRİLMEDİ.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-ma-${randomUUID().slice(0, 8)}@example.com`;
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
      code: `M-MA-${randomUUID().slice(0, 6)}`,
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

function payRequest(body: Record<string, unknown>) {
  return request(ctx.app!)
    .post('/payments')
    .set('Authorization', `Bearer ${ctx.adminToken!}`)
    .send(body);
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
  'PARA-KRİTİK temiz alanlar — payments-money.audit (YEŞİL — regresyon kilidi)',
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
        .values({ id: TENANT_ID, name: 'Audit Tenant', slug: `t-ma-${TENANT_ID.slice(0, 8)}` })
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
          { id: ADMIN_ID, tenant_id: TENANT_ID, email: ADMIN_EMAIL, username: `admin-ma-${randomUUID().slice(0, 6)}`, password_hash: adminHash, role: 'admin' },
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

    // ─── A: statik float-sızıntı guard ─────────────────────────────────────
    it('A: para-kritik kaynak dosyalarında parseFloat/toFixed/float-bölme YOK (statik regresyon kilidi)', () => {
      const files = [
        '../routes/payments.ts',
        '../routes/orders.ts',
        '../../../../packages/db/src/repositories/payments.ts',
        '../../../../packages/db/src/repositories/orders.ts',
        '../../../../packages/shared-domain/src/payment.ts',
      ];
      const forbidden = [/parseFloat\s*\(/, /\.toFixed\s*\(/, /\bNumber\s*\([^)]*\)\s*\/\s*100\b/];
      for (const rel of files) {
        const abs = fileURLToPath(new URL(rel, import.meta.url));
        const src = readFileSync(abs, 'utf-8');
        for (const pattern of forbidden) {
          expect(pattern.test(src), `${rel} ${pattern} eşleşmemeli (para integer-kuruş olmalı)`).toBe(false);
        }
      }
    });

    // ─── B: cancel-only kontrol (MONEY-01'in "bozuk OLMAYAN" yarısı) ───────
    it('B: tek kalem iptali (sonrasında EKLEME yok) → total_cents doğru düşer (updateItemTx recalc filtreli)', async () => {
      const tableId = await insertTable();
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [
            { productId: PRODUCT_ID, quantity: 1 },
            { productId: PRODUCT_ID, quantity: 1 },
          ],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.order.id as string;
      const itemAId = createRes.body.data.items[0].id as string;

      const cancelItem = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemAId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(cancelItem.status).toBe(200);

      const order = await orderRow(orderId);
      expect(order.total_cents).toBe(PRICE); // yalnız aktif kalan kalem sayılır
    });

    // ─── C: çoklu partial ödeme tam-toplam kapatma — float drift yok ───────
    it('C: 3 partial ödeme tam total\'a eşitlenip pay_and_close ile kapanır (tam integer toplam, drift yok)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 3); // total 15000

      const amounts = [5000, 5000, 5000];
      for (const amountCents of amounts.slice(0, -1)) {
        const r = await payRequest({
          orderId,
          paymentType: 'cash',
          paymentScope: 'partial',
          amountCents,
          idempotencyKey: randomUUID(),
          operation: 'pay',
        });
        expect(r.status).toBe(201);
      }
      // Son dilim close ile birlikte (scope=full zorunlu close için) — kalan
      // tutarı 'full' scope ile kapatıyoruz (ADR-014 close-path her zaman
      // canCloseOrder ile tam-eşitlik arar).
      const closePay = await payRequest({
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: amounts[amounts.length - 1]!,
        idempotencyKey: randomUUID(),
        operation: 'pay_and_close',
      });
      expect(closePay.status).toBe(201);
      const order = await orderRow(orderId);
      expect(order.status).toBe('paid');

      const sum = await ctx
        .db!.selectFrom('payments')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('amount_cents'), eb.lit(0)).as('s'))
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', orderId)
        .where('voided_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(Number(sum.s)).toBe(15000); // tam integer eşitlik — kuruş drift yok
    });

    // ─── D: TEK-adımda overpay+close güvenli reddedilir (PAY-03/MONEY-02 kontrastı) ─
    it('D: pay_and_close TEK istekte overpay → 400 PAYMENT_EXCEEDS_TOTAL + TAM rollback (phantom ödeme YOK)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1); // total 5000

      const res = await payRequest({
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRICE * 3,
        idempotencyKey: randomUUID(),
        operation: 'pay_and_close',
      });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('PAYMENT_EXCEEDS_TOTAL');

      // Tek-transaction rollback — canCloseOrder reddi tüm tx'i geri alır;
      // PAY-03/MONEY-02'nin aksine burada phantom ödeme KALMAZ.
      const order = await orderRow(orderId);
      expect(order.status).toBe('open');
      const count = await ctx
        .db!.selectFrom('payments')
        .select((eb) => eb.fn.countAll<number>().as('c'))
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(Number(count.c)).toBe(0);
    });

    // ─── E: cancelled order → /payments reddi (paid-only değil) ────────────
    it('E: cancelled order\'a POST /payments → 409 ORDER_INVARIANT_VIOLATED (terminal-check\'in \'paid\' dışı üyesi de doğru çalışıyor)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1);
      const cancelRes = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(cancelRes.status).toBe(200);

      const res = await payRequest({
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
      });
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('ORDER_INVARIANT_VIOLATED');
    });

    // ─── F: HTTP-seviyesi N-eşzamanlı idempotency — bu ortamda doğal koruma ─
    it('F: N=8 eşzamanlı HTTP POST /payments (aynı key) → route ön-kontrolü bu ortamda çakışmayı emiyor (1×201+7×200, 0×500)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1);
      const key = randomUUID();
      const body = {
        orderId,
        paymentType: 'cash' as const,
        paymentScope: 'partial' as const,
        amountCents: 2500,
        idempotencyKey: key,
        operation: 'pay' as const,
      };
      const N = 8;
      const results = await Promise.all(Array.from({ length: N }, () => payRequest(body)));
      const counts: Record<number, number> = {};
      for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;

      // Bu BULGU DEĞİL — DOĞRULANMIŞ gözlem: aynı makine + düşük gecikmede
      // route-seviyesi ön-kontrol (routes/payments.ts:81-88) kaybedenleri
      // HER SEFERİNDE temiz 200 replay'e yönlendiriyor. PAY-01'in kök nedeni
      // (repo createTx catch'inde 25P02) hâlâ GERÇEK ve KANITLI — bkz.
      // payments-money.findings.test.ts PAY-01 (DB-seviyesi deterministik
      // kanıt). Bu test yalnız HTTP yüzeyinde bu spesifik ortamda gözlenen
      // "doğal emme" davranışını regresyona karşı belgeler.
      expect(counts[201] ?? 0).toBe(1);
      expect(counts[200] ?? 0).toBe(N - 1);
      expect(counts[500] ?? 0).toBe(0);
    });
  },
);
