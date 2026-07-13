import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import {
  createPool,
  createKysely,
  createOrdersRepository,
  RepositoryError,
  type DB,
  type OrdersRepository,
} from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * FAZ 1 fix regresyon testi — MONEY-01 + DB-TX-01 (derin denetim serisi Blok 5).
 *
 * Bu iki test, `packages/db/src/repositories/orders.ts` içindeki fix'ler
 * MERGE OLMADAN ÖNCE (origin/audit/05-orders-payments karakterizasyon
 * testlerinde) KIRMIZI, fix SONRASI (bu branch) YEŞİL dönmesi gereken
 * senaryoları kapsar:
 *
 * - MONEY-01: `insertItemsAndRecalc` recalc subquery'sine
 *   `AND status != 'cancelled' AND is_comped = false` eklendi — iptal
 *   edilmiş bir kalemin tutarı yeni kalem eklenince "dirilmemeli".
 * - DB-TX-01: `addItems` + `updateItemTx` order-SELECT'lerine `.forUpdate()`
 *   eklendi — eşzamanlı addItems/cancelOrder yarışı serialize olmalı;
 *   "cancelled ama total>0 + aktif kalem" tutarsız state ASLA oluşmamalı.
 *
 * Fixture deseni payments-money.findings.test.ts / order-state.findings.test.ts
 * ile birebir aynı (skipIf + izole masa/tenant + FK-cleanup sırası + pool.end).
 * YALNIZ pos_test'e karşı koşulur (DATABASE_URL env ile verilir).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-mi-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRICE = 5000;

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  ordersRepo?: OrdersRepository;
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
      code: `M-MI-${randomUUID().slice(0, 6)}`,
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

async function activeItemsSum(orderId: string): Promise<number> {
  const row = await ctx
    .db!.selectFrom('order_items')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('total_cents'), eb.lit(0)).as('s'))
    .where('tenant_id', '=', TENANT_ID)
    .where('order_id', '=', orderId)
    .where('status', '!=', 'cancelled')
    .executeTakeFirstOrThrow();
  return Number(row.s);
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'FAZ 1 fix regresyonu — orders money integrity (MONEY-01 + DB-TX-01)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.ordersRepo = createOrdersRepository(db);
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
        .values({ id: TENANT_ID, name: 'Money Integrity Tenant', slug: `t-mi-${TENANT_ID.slice(0, 8)}` })
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
          username: `admin-mi-${randomUUID().slice(0, 6)}`,
          password_hash: adminHash,
          role: 'admin',
        })
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

    // ─── MONEY-01 (fix doğrulama) ───────────────────────────────────────────
    it('MONEY-01: cancel-then-add sonrası total_cents === SUM(aktif kalemler) — iptal tutarı dirilmez', async () => {
      const tableId = await insertTable();
      const createRes = await request(ctx.app!)
        .post('/orders')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          tableId,
          orderType: 'dine_in',
          items: [
            { productId: PRODUCT_ID, quantity: 1 }, // A
            { productId: PRODUCT_ID, quantity: 1 }, // B
          ],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.order.id as string;
      const itemAId = createRes.body.data.items[0].id as string;
      expect(createRes.body.data.order.total_cents).toBe(PRICE * 2); // 10000

      // A'yı iptal et → total_cents PRICE'a düşmeli (updateItemTx recalc, filtreli).
      const cancelItem = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemAId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(cancelItem.status).toBe(200);
      const afterCancel = await orderRow(orderId);
      expect(afterCancel.total_cents).toBe(PRICE); // 5000 — kontrol noktası

      // Yeni kalem C ekle (5000) → MONEY-01 fix: insertItemsAndRecalc SUM'ı
      // status != 'cancelled' AND is_comped = false filtresiyle hesaplar —
      // A'nın (cancelled) tutarı yeniden toplama GİRMEMELİ.
      const addItem = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }); // C
      expect(addItem.status).toBe(200);

      // Beklenen (para invariantı): B(5000) + C(5000) = 10000 — A dirilmez.
      const afterAdd = await orderRow(orderId);
      expect(afterAdd.total_cents).toBe(PRICE * 2);

      // Bağımsız SUM ile çapraz doğrulama — gerçek invariant tanımı, repo'nun
      // recalc SQL'inden bağımsız bir sorguyla teyit.
      const activeSum = await activeItemsSum(orderId);
      expect(afterAdd.total_cents).toBe(activeSum);
    });

    // ─── DB-TX-01 (fix doğrulama) ───────────────────────────────────────────
    // NOT (metodoloji): (1) repo.addItems + repo.cancelOrder'ı doğrudan
    // Promise.all ile yarıştırmak GÜVENİLİR bir regresyon testi ÜRETMEDİ —
    // TOCTOU penceresi çok dar, fix GERİ ALINDIĞINDA BİLE rastgele yeşil
    // kaldı (yanlış-güven, deneysel doğrulamada görüldü). (2) İki ucu da ham
    // SQL ile elle yazmak da YANILTICI — o zaman test kendi gömdüğü FOR
    // UPDATE'i sınar, GERÇEK repo kodunu değil (fix geri alınsa da hep
    // yeşil kalır, deneysel doğrulamada görüldü). Bu yüzden: GERÇEK
    // `ordersRepo.addItems` çağrılır; "cancelOrder mid-flight" durumu ham
    // SQL bağlantısıyla kilit tutularak simüle edilir (cancelOrder'ın kendi
    // FOR UPDATE'i bu fix'ten ÖNCE de vardı — test edilen kısım DEĞİL).
    // addItems'ın gerçek çağrısı bu kilit serbest kalana kadar BLOKE olmalı
    // (süre ölçümüyle kanıtlanır) — zamanlamaya değil testin kendi
    // kontrollü sırasına bağlı; flaky değil.
    it('DB-TX-01: gerçek addItems, cancelOrder-benzeri kilit tutulurken bloke olur ve reddeder — kalıcı kalem/total sızıntısı yok', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1); // total PRICE, 1 aktif kalem

      const newItem = {
        id: randomUUID(),
        productId: PRODUCT_ID,
        productName: 'Test Ürün',
        categoryNameSnapshot: 'Yemekler',
        unitPriceCents: PRICE,
        quantity: 1,
        totalCents: PRICE,
        createdByUserId: null,
        createdByName: null,
      };

      const clientHolder = await ctx.pool!.connect();
      const HOLD_MS = 300;
      let result: { status: 'fulfilled' } | { status: 'rejected'; reason: unknown };
      let elapsedMs: number;
      try {
        // ADIM 1 — cancelOrder'ın ilk adımıyla BİREBİR aynı SQL (orders.ts
        // ~969-975, bu fix'ten ÖNCE de FOR UPDATE'liydi): kilidi al, tut,
        // henüz commit etme ("cancelOrder mid-flight").
        await clientHolder.query('BEGIN');
        const seenByHolder = await clientHolder.query(
          'SELECT status FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
          [orderId, TENANT_ID],
        );
        expect(seenByHolder.rows[0].status).toBe('open');

        // ADIM 2 — GERÇEK repo çağrısı: addItems kendi transaction'ında
        // orders.ts ~710-716'daki (FIX: .forUpdate() eklendi) SELECT'i
        // dener. clientHolder kilidi tuttuğu sürece bu BLOKE olmalı —
        // await ETMİYORUZ, promise'i saklıyoruz.
        const startedAt = Date.now();
        const addPromise = ctx.ordersRepo!.addItems(TENANT_ID, orderId, [newItem]).then(
          () => ({ status: 'fulfilled' as const }),
          (reason: unknown) => ({ status: 'rejected' as const, reason }),
        );

        // ADIM 3 — cancelOrder'ın geri kalanı (item cancel + order
        // cancel/total=0), kasıtlı HOLD_MS gecikmeyle COMMIT — addItems'ın
        // GERÇEKTEN bloke olduğunu (tesadüfen sırayla çalışmadığını) süre
        // ölçümüyle ispatlamak için.
        await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
        await clientHolder.query(
          `UPDATE order_items SET status='cancelled'
           WHERE order_id=$1 AND tenant_id=$2 AND status != 'cancelled'`,
          [orderId, TENANT_ID],
        );
        await clientHolder.query(
          `UPDATE orders SET status='cancelled', total_cents=0, updated_at=now()
           WHERE id=$1 AND tenant_id=$2`,
          [orderId, TENANT_ID],
        );
        await clientHolder.query('COMMIT');

        // ADIM 4 — addItems'ın bloke promise'i ANCAK ŞİMDİ çözülmeli. FIX
        // olmasaydı (regresyon) bu çağrı anında (kilitsiz SELECT) dönerdi
        // ve muhtemelen BAŞARIYLA tamamlanırdı (elapsedMs≈0, fulfilled) —
        // fix'in kanıtı: hem blokaj süresi hem taze (post-commit) ret.
        result = await addPromise;
        elapsedMs = Date.now() - startedAt;
      } finally {
        await clientHolder.query('ROLLBACK').catch(() => undefined);
        clientHolder.release();
      }

      expect(elapsedMs!).toBeGreaterThanOrEqual(HOLD_MS - 20);
      // addItems FOR UPDATE ile kilidi bekler, unblock olunca taze
      // status='cancelled' görür → terminal-status guard reddeder.
      expect(result!.status).toBe('rejected');
      if (result!.status === 'rejected') {
        expect(result!.reason).toBeInstanceOf(RepositoryError);
        expect((result!.reason as RepositoryError).messageKey).toBe('ORDER_INVARIANT_VIOLATED');
      }

      // SONUÇ invariant: cancelled + total=0 + aktif kalem yok — addItems
      // reddedildiği için kalem asla kalıcı olmadı, "cancelled ama
      // total>0 + aktif kalem" tutarsız state'i hiç oluşmadı.
      const finalOrder = await orderRow(orderId);
      const activeItems = await ctx
        .db!.selectFrom('order_items')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', orderId)
        .where('status', '!=', 'cancelled')
        .execute();
      expect(finalOrder.status).toBe('cancelled');
      expect(finalOrder.total_cents).toBe(0);
      expect(activeItems.length).toBe(0);
      expect(finalOrder.status === 'cancelled' && finalOrder.total_cents > 0).toBe(false);
    });
  },
);
