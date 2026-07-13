import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { Kysely } from 'kysely';
import {
  createPool,
  createKysely,
  createPaymentsRepository,
  type DB,
  type PaymentsRepository,
} from '@restoran-pos/db';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * FAZ 1 fix regresyon testi — DB-TX-05 (derin denetim serisi Blok 5,
 * PAY-01 karakterizasyonunun DB-seviyesi kardeşi).
 *
 * `packages/db/src/repositories/payments.ts` `createTx` — eski desen aynı
 * idempotency-key ile çakışan INSERT'in 23505'ini catch'leyip recovery
 * SELECT'i ABORTED transaction'da çalıştırıyordu (Postgres kuralı: 23505
 * sonrası ROLLBACK TO SAVEPOINT olmadan sıradaki komut reddedilir) →
 * 25P02 (in_failed_sql_transaction) → mapPgError'da case yok → yarışı
 * kaybeden istek 500 alıyordu (replay-200 yerine).
 *
 * Fix: `INSERT ... ON CONFLICT (tenant_id, idempotency_key) DO NOTHING` +
 * `executeTakeFirst()`. 0 satır dönerse (yarış kaybedildi) tx SAĞLIKLI
 * kaldığı için replay SELECT güvenle çalışır → `{replayed: true}`.
 *
 * Bu dosya iki senaryoyu kilitler:
 *   1. Ana yarış — GERÇEK repo.createTx çağrısı, ham pg bağlantısıyla
 *      tutulan uncommitted çakışan satırın COMMIT'ine kadar BLOKE olur,
 *      sonra hatasız replay döner (fix'in kanıtı — eski davranışta bu yol
 *      25P02/500'dü).
 *   2. Sıradan (yarışsız) ardışık create — pre-check yolunun davranışı
 *      DEĞİŞMEDİ kanıtı: ikinci çağrı aynı satırı döner, yeni satır YOK.
 *
 * Fixture deseni payments-money.findings.test.ts / orders-money-integrity
 * ile birebir aynı (skipIf + izole tenant/masa + FK-cleanup sırası +
 * pool.end). YALNIZ pos_test'e karşı koşulur (DATABASE_URL env ile verilir).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-pir-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRICE = 5000;

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  paymentsRepo?: PaymentsRepository;
  adminToken?: string;
}

const ctx: Ctx = {};

/** Test 1'in ham pg bağlantısı — çekirdek senaryo bir assertion'da
 *  patlarsa afterEach ROLLBACK+release ile süiti kirletmeden temizler. */
let rawClient: PoolClient | undefined;

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
      code: `M-PIR-${randomUUID().slice(0, 6)}`,
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

async function paymentsCount(orderId: string): Promise<number> {
  const row = await ctx
    .db!.selectFrom('payments')
    .select((eb) => eb.fn.countAll<number>().as('c'))
    .where('tenant_id', '=', TENANT_ID)
    .where('order_id', '=', orderId)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'FAZ 1 fix regresyonu — payments idempotency race (DB-TX-05)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL! });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      ctx.paymentsRepo = createPaymentsRepository(db);
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
        .values({ id: TENANT_ID, name: 'Idempotency Race Tenant', slug: `t-pir-${TENANT_ID.slice(0, 8)}` })
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
          username: `admin-pir-${randomUUID().slice(0, 6)}`,
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

    afterEach(async () => {
      // Güvenlik ağı: senaryo assertion'ı yarıda patlarsa ham bağlantı
      // idle-in-transaction takılıp kalmasın — süiti kirletmesin.
      if (rawClient !== undefined) {
        await rawClient.query('ROLLBACK').catch(() => undefined);
        rawClient.release();
        rawClient = undefined;
      }
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

    // ─── DB-TX-05 (fix doğrulama — ana yarış) ──────────────────────────────
    // NOT (metodoloji): PAY-01 (payments-money.findings.test.ts) ile aynı
    // gerekçe — route-seviyesi Promise.all HTTP yarışı bu ortamda (aynı
    // makine, düşük gecikme) güvenilir tetiklemedi (kaybeden her zaman
    // route ön-kontrolüne (routes/payments.ts:81-88) yakalanıp temiz 200
    // aldı). Bu yüzden GERÇEK `paymentsRepo.createTx` doğrudan çağrılır;
    // "yarışı kazanan" taraf ham pg bağlantısıyla (aynı key'li satırın
    // uncommitted INSERT'i) simüle edilir — Postgres'in kendi unique-index
    // MVCC kuralı (uncommitted çakışan satır → rakip INSERT o tx
    // sonuçlanana kadar bekler) devreye girer. Zamanlamaya değil testin
    // kendi kontrollü sırasına (BEGIN→INSERT→[repo çağrısı beklemede]→
    // COMMIT→[repo çağrısı çözülür]) bağlı; flaky değil.
    it('DB-TX-05: uncommitted çakışan idempotency-key satırı commit olunca, bloke kalan gerçek createTx hatasız replay döner (payment.id=kazananın satırı)', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1); // total PRICE
      const key = randomUUID();
      const winningId = randomUUID(); // conn2 (uncommitted → sonra commit)
      const losingId = randomUUID(); // gerçek repo çağrısının denediği id (asla yazılmaz)

      rawClient = await ctx.pool!.connect();
      await rawClient.query('BEGIN');
      await rawClient.query(
        `INSERT INTO payments (id, tenant_id, order_id, payment_type, payment_scope, amount_cents, idempotency_key)
         VALUES ($1,$2,$3,'cash','full',$4,$5)`,
        [winningId, TENANT_ID, orderId, PRICE, key],
      );
      // COMMIT ETME — satır kasıtlı uncommitted kalıyor.

      let settled = false;
      const startedAt = Date.now();
      const tracked = ctx
        .db!.transaction()
        .execute((trx) =>
          ctx.paymentsRepo!.createTx(trx, TENANT_ID, {
            id: losingId,
            orderId,
            paymentType: 'cash',
            paymentScope: 'full',
            amountCents: PRICE,
            idempotencyKey: key,
            createdByUserId: ADMIN_ID,
          }),
        )
        .then(
          (value) => {
            settled = true;
            return { status: 'fulfilled' as const, value };
          },
          (reason: unknown) => {
            settled = true;
            return { status: 'rejected' as const, reason };
          },
        );

      // ~150ms bekle — repo çağrısı conn2'nin uncommitted INSERT'ini
      // beklediği için bu noktada HÂLÂ pending olmalı (bloklandı = doğru).
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(settled).toBe(false);

      await rawClient.query('COMMIT');
      rawClient.release();
      rawClient = undefined;

      const result = await tracked;
      const elapsedMs = Date.now() - startedAt;

      // Repo çağrısı en az bloklandığı süre kadar sürmüş olmalı (tesadüfen
      // hızlı dönmedi kanıtı) — kesin eşik değil, gevşek alt sınır.
      expect(elapsedMs).toBeGreaterThanOrEqual(130);

      // BEKLENEN (fix): hata YOK, replay — kazananın satırı döner.
      // ESKİ davranışta bu yol 25P02 → 500'dü (recovery SELECT aborted tx'te).
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect(result.value.payment.id).toBe(winningId);
        expect(result.value.replayed).toBe(true);
        expect(result.value.orderClosed).toBe(false);
      }

      // Para-güvenlik: yalnız 1 satır COMMIT oldu (losingId ASLA yazılmadı).
      expect(await paymentsCount(orderId)).toBe(1);
    });

    // ─── replay sanity (pre-check yolu — davranış DEĞİŞMEDİ) ───────────────
    it("replay sanity: yarışsız ardışık aynı idempotency-key create çağrısı — ikincisi aynı payment'ı döner, yeni satır yazılmaz", async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1);
      const key = randomUUID();

      const first = await ctx.paymentsRepo!.create(TENANT_ID, {
        id: randomUUID(),
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRICE,
        idempotencyKey: key,
        createdByUserId: ADMIN_ID,
      });

      const second = await ctx.paymentsRepo!.create(TENANT_ID, {
        id: randomUUID(),
        orderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRICE,
        idempotencyKey: key,
        createdByUserId: ADMIN_ID,
      });

      expect(second.id).toBe(first.id);
      expect(await paymentsCount(orderId)).toBe(1);
    });
  },
);
