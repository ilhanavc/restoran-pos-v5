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
 * Derin Denetim Blok 5 (Hat B) — PARA-KRİTİK KASITLI KIRMIZI karakterizasyon
 * testleri. Bu dosyadaki testler BUGÜNKÜ (buggy) davranışla ÇALIŞIR — yani
 * DOĞRU/beklenen davranışı assert eder ve BUGÜN KIRMIZI (fail) döner. Fix
 * geldiğinde yeşile döner ve regresyon kilidi olarak kalır.
 *
 * Kapsam: Hat A (security-reviewer) bulguları PAY-01/02/03/05 route
 * seviyesinde canlı karakterize edilir + Hat B'nin kendi para-invariant
 * bulguları (MONEY-01, MONEY-02).
 *
 * Prod kod DEĞİŞTİRİLMEDİ. Fixture deseni payments-void.test.ts ile birebir
 * aynı (skipIf + FK-cleanup sırası + pool.end).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-mf-${randomUUID().slice(0, 8)}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-mf-${randomUUID().slice(0, 8)}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';

const AREA_ID = randomUUID();
const CATEGORY_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const PRICE = 5000;

interface Ctx {
  pool?: Pool;
  db?: Kysely<DB>;
  app?: Express;
  adminToken?: string;
  cashierToken?: string;
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
      code: `M-MF-${randomUUID().slice(0, 6)}`,
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
  'PARA-KRİTİK bulgular — payments-money.findings (KASITLI KIRMIZI)',
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
        .values({ id: TENANT_ID, name: 'Findings Tenant', slug: `t-mf-${TENANT_ID.slice(0, 8)}` })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const [adminHash, cashierHash] = await Promise.all([
        hashPassword(ADMIN_PASSWORD),
        hashPassword(CASHIER_PASSWORD),
      ]);
      await db
        .insertInto('users')
        .values([
          { id: ADMIN_ID, tenant_id: TENANT_ID, email: ADMIN_EMAIL, username: `admin-mf-${randomUUID().slice(0, 6)}`, password_hash: adminHash, role: 'admin' },
          { id: CASHIER_ID, tenant_id: TENANT_ID, email: CASHIER_EMAIL, username: `cashier-mf-${randomUUID().slice(0, 6)}`, password_hash: cashierHash, role: 'cashier' },
        ])
        .execute();

      await db.insertInto('areas').values({ id: AREA_ID, tenant_id: TENANT_ID, name: 'Salon' }).execute();
      await db.insertInto('categories').values({ id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Yemekler' }).execute();
      await db
        .insertInto('products')
        .values({ id: PRODUCT_ID, tenant_id: TENANT_ID, category_id: CATEGORY_ID, name: 'Test Ürün', price_cents: PRICE, is_active: true })
        .execute();

      ctx.adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      ctx.cashierToken = await login(CASHIER_EMAIL, CASHIER_PASSWORD);
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

    // ─── PAY-02 [HIGH] ──────────────────────────────────────────────────────
    it('PAY-02: merged order\'a POST /payments (scope=full,pay) → BEKLENEN 409 ama BUGÜN 201 phantom ödeme', async () => {
      const sourceTableId = await insertTable();
      const targetTableId = await insertTable();
      const sourceOrderId = await createDineInOrder(sourceTableId, 1);
      await createDineInOrder(targetTableId, 1);

      const merge = await request(ctx.app!)
        .post(`/orders/${sourceOrderId}/merge`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ targetTableId });
      expect(merge.status).toBe(200);

      // Kaynak artık status='merged', total_cents=0, kalemsiz (ADR-029).
      const merged = await orderRow(sourceOrderId);
      expect(merged.status).toBe('merged');
      expect(merged.total_cents).toBe(0);

      const res = await payRequest({
        orderId: sourceOrderId,
        paymentType: 'cash',
        paymentScope: 'full',
        amountCents: PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
      });

      // BEKLENEN: createTx terminal-status reddi paid|cancelled|void ile aynı
      // ailede 'merged'i de kapsamalı → 409 ORDER_INVARIANT_VIOLATED.
      // BUGÜN: repo createTx yalnız paid|cancelled|void kontrol eder (merged
      // YOK) → 201 phantom ödeme (order total=0 iken amount_cents=5000 kayıt).
      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('ORDER_INVARIANT_VIOLATED');
    });

    // ─── PAY-03 [HIGH] ──────────────────────────────────────────────────────
    it('PAY-03: partial scope aşırı-ödeme (operation=pay, close DEĞİL) → BEKLENEN 400 PAYMENT_EXCEEDS_TOTAL ama BUGÜN 201', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1); // total 5000

      const res = await payRequest({
        orderId,
        paymentType: 'cash',
        paymentScope: 'partial',
        amountCents: 999_999_900, // ~9.999.999 TL — order.total_cents'in ÇOK üstü
        idempotencyKey: randomUUID(),
        operation: 'pay',
      });

      // BEKLENEN: close-path'teki (canCloseOrder) overpay guard'ının bir
      // benzeri non-close scope='partial'/'full' yolunda da olmalı.
      // BUGÜN: createTx yalnız closeOrder===true dalında SUM≤total kontrol
      // eder; 'pay' (close değil) için hiç guard yok → 201.
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('PAYMENT_EXCEEDS_TOTAL');

      const order = await orderRow(orderId);
      expect(order.total_cents).toBe(PRICE); // order.total ASLA aşırı ödemeyle değişmemeli
    });

    // ─── MONEY-01 [BLOCKER] ─────────────────────────────────────────────────
    it('MONEY-01: addItems recalc iptal edilmiş kalemi DIŞLAMIYOR → yeni kalem eklenince iptal tutarı dirilir', async () => {
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

      // A'yı iptal et → total_cents 5000'e düşmeli (updateItemTx recalc — filtreli, DOĞRU).
      const cancelItem = await request(ctx.app!)
        .patch(`/orders/${orderId}/items/${itemAId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'cancelled' });
      expect(cancelItem.status).toBe(200);
      const afterCancel = await orderRow(orderId);
      expect(afterCancel.total_cents).toBe(PRICE); // 5000 — kontrol noktası (bu adım DOĞRU çalışıyor)

      // Yeni kalem C ekle (5000) → insertItemsAndRecalc SUM'ı status filtresi
      // OLMADAN hesaplıyor (repo satır ~588-599) → A (cancelled, 5000) yeniden
      // toplama girer.
      const addItem = await request(ctx.app!)
        .post(`/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ items: [{ productId: PRODUCT_ID, quantity: 1 }] }); // C
      expect(addItem.status).toBe(200);

      // BEKLENEN (para invariantı — order.total_cents === SUM(aktif kalemler)):
      // B(5000) + C(5000) = 10000.
      // BUGÜN: A(cancelled,5000) + B(5000) + C(5000) = 15000 (KIRMIZI).
      const afterAdd = await orderRow(orderId);
      expect(afterAdd.total_cents).toBe(PRICE * 2);

      // Bağımsız SUM ile çapraz doğrulama — gerçek invariant tanımı.
      const activeSum = await ctx
        .db!.selectFrom('order_items')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('total_cents'), eb.lit(0)).as('s'))
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', orderId)
        .where('status', '!=', 'cancelled')
        .executeTakeFirstOrThrow();
      expect(afterAdd.total_cents).toBe(Number(activeSum.s));
    });

    // ─── PAY-01 [HIGH] ──────────────────────────────────────────────────────
    // NOT (metodoloji): 2-yollu VE 8-yollu Promise.all ile route seviyesinde
    // (POST /payments HTTP) deneme yapıldı — bu ortamda (aynı makine, düşük
    // gecikme) kaybeden HER SEFERİNDE routes/payments.ts:81-88'deki
    // transaction-DIŞI ön-kontrole (Express/JWT-verify overhead'i kazanan
    // transaction'ın toplam süresinden HER ZAMAN yavaş olduğu için) yakalanıp
    // temiz 200 replay aldı — repo-içi asıl açık HTTP üzerinden CANLI tetik
    // LENEMEDİ (bkz. payments-money.audit.test.ts "concurrent HTTP N=8"
    // yeşil testi — bu ortamda route ön-kontrolü koruyucu). Bu nedenle asıl
    // hatalı kod yolu (repo `createTx` catch bloğu, payments.ts:265-283)
    // DETERMİNİSTİK olarak — ham SQL ile repo'nun BİREBİR uyguladığı adımları
    // (idempotency SELECT → order FOR UPDATE → INSERT → 23505 → recovery
    // SELECT) iki elle-yönetilen bağlantı ile — kanıtlanır. Zamanlamaya bağlı
    // DEĞİL (sıralama testin kendisi tarafından garanti edilir); flaky değil.
    it('PAY-01: aynı idempotency-key ile çakışan INSERT sonrası recovery SELECT aborted-tx\'te 25P02 alır (mapPgError case yok) — DB-seviyesi deterministik kanıt', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1);
      const key = randomUUID();
      const clientA = await ctx.pool!.connect();
      const clientB = await ctx.pool!.connect();
      try {
        await clientA.query('BEGIN');
        await clientB.query('BEGIN');

        // Adım 1 (repo createTx step 1) — ikisi de idempotency key'i henüz
        // GÖRMÜYOR (repo'daki gerçek "iki istek fast-path'i geçti" hali).
        const seenByA = await clientA.query(
          'SELECT id FROM payments WHERE tenant_id=$1 AND idempotency_key=$2',
          [TENANT_ID, key],
        );
        const seenByB = await clientB.query(
          'SELECT id FROM payments WHERE tenant_id=$1 AND idempotency_key=$2',
          [TENANT_ID, key],
        );
        expect(seenByA.rowCount).toBe(0);
        expect(seenByB.rowCount).toBe(0);

        // A "kazanan": order kilidi + INSERT + COMMIT (repo step 2-3).
        await clientA.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
        await clientA.query(
          `INSERT INTO payments (id, tenant_id, order_id, payment_type, payment_scope, amount_cents, idempotency_key)
           VALUES ($1,$2,$3,'cash','full',$4,$5)`,
          [randomUUID(), TENANT_ID, orderId, PRICE, key],
        );
        await clientA.query('COMMIT');

        // B "kaybeden": kendi order kilidini (artık serbest) alır, AYNI key
        // ile INSERT dener → 23505 (repo aynı davranış).
        await clientB.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
        let insertErrCode: string | undefined;
        try {
          await clientB.query(
            `INSERT INTO payments (id, tenant_id, order_id, payment_type, payment_scope, amount_cents, idempotency_key)
             VALUES ($1,$2,$3,'cash','full',$4,$5)`,
            [randomUUID(), TENANT_ID, orderId, PRICE, key],
          );
        } catch (err) {
          insertErrCode = (err as { code?: string }).code;
        }
        expect(insertErrCode).toBe('23505'); // unique_violation — repo mapPgError('unique') dalına girer

        // Repo catch bloğu TAM BURADA — AYNI (B'nin) transaction/connection'ında
        // recovery SELECT dener (payments.ts repo ~270-275).
        let recoveryErrCode: string | undefined;
        try {
          await clientB.query(
            'SELECT id FROM payments WHERE tenant_id=$1 AND idempotency_key=$2',
            [TENANT_ID, key],
          );
        } catch (recErr) {
          recoveryErrCode = (recErr as { code?: string }).code;
        }

        // BEKLENEN (repo'nun kendi yorumu "replay safety" sözünü tutması
        // için): recovery SELECT BAŞARILI olmalı (A'nın satırını bulup
        // replay dönebilmeli) → recoveryErrCode tanımsız kalmalı.
        // BUGÜN: B'nin transaction'ı 23505 sonrası "aborted" durumda
        // (Postgres kuralı — ROLLBACK TO SAVEPOINT olmadan bir sonraki komut
        // reddedilir) → recovery SELECT KENDİSİ 25P02 (in_failed_sql_transaction)
        // ile patlar. mapPgError (packages/db/src/errors.ts) switch'inde
        // '25P02' case'i YOK → route'a ham pg hatası sızar → next(err) → 500.
        expect(recoveryErrCode).toBeUndefined();
      } finally {
        await clientA.query('ROLLBACK').catch(() => undefined);
        await clientB.query('ROLLBACK').catch(() => undefined);
        clientA.release();
        clientB.release();
      }

      // Para-güvenlik: mekanizma ne olursa olsun ÇİFT ödeme asla COMMIT
      // olmadı (A commit, B'nin her şeyi rollback edildi) — bu her zaman
      // doğru olmalı, bugün de doğru (Migration 022 unique + FOR UPDATE).
      const count = await ctx
        .db!.selectFrom('payments')
        .select((eb) => eb.fn.countAll<number>().as('c'))
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(Number(count.c)).toBe(1);
    });

    // ─── PAY-05 [MEDIUM] ────────────────────────────────────────────────────
    it('PAY-05: eşzamanlı aynı idempotency-key POST /payments (operation=pay_and_close) → BEKLENEN [200,201] ama BUGÜN kaybeden 409 ORDER_INVARIANT_VIOLATED', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1); // total 5000
      const key = randomUUID();
      const body = {
        orderId,
        paymentType: 'cash' as const,
        paymentScope: 'full' as const,
        amountCents: PRICE,
        idempotencyKey: key,
        operation: 'pay_and_close' as const,
      };

      const [r1, r2] = await Promise.all([payRequest(body), payRequest(body)]);
      const statuses = [r1.status, r2.status].sort((a, b) => a - b);

      // BEKLENEN: idempotency-key sözleşmesi close operasyonunda da aynı —
      // kaybeden 200 replay almalı (para-güvenli, yalnız yanlış HTTP kodu).
      // BUGÜN: kaybeden order-lock'u kazanandan SONRA alır, order zaten
      // status='paid' → terminal-check'e takılır → 409 (replay-200 DEĞİL).
      expect(statuses).toEqual([200, 201]);

      const order = await orderRow(orderId);
      expect(order.status).toBe('paid'); // para-güvenlik: order doğru kapandı
      const count = await ctx
        .db!.selectFrom('payments')
        .select((eb) => eb.fn.countAll<number>().as('c'))
        .where('tenant_id', '=', TENANT_ID)
        .where('order_id', '=', orderId)
        .executeTakeFirstOrThrow();
      expect(Number(count.c)).toBe(1); // çift-ödeme YOK — mekanizma para-güvenli
    });

    // ─── MONEY-02 [BLOCKER] ─────────────────────────────────────────────────
    it('MONEY-02: Mod B (PATCH /orders/:id status=paid) overpay guard YOK → SUM(payments)>total_cents iken de kapanır', async () => {
      const tableId = await insertTable();
      const orderId = await createDineInOrder(tableId, 1); // total 5000

      // İki ayrı partial 'pay' (close değil) — PAY-03 boşluğu sayesinde ikisi
      // de 201 döner (SUM=10000, total_cents=5000).
      const p1 = await payRequest({
        orderId,
        paymentType: 'cash',
        paymentScope: 'partial',
        amountCents: PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
      });
      expect(p1.status).toBe(201);
      const p2 = await payRequest({
        orderId,
        paymentType: 'cash',
        paymentScope: 'partial',
        amountCents: PRICE,
        idempotencyKey: randomUUID(),
        operation: 'pay',
      });
      expect(p2.status).toBe(201);

      const closeRes = await request(ctx.app!)
        .patch(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ status: 'paid' });

      // BEKLENEN: payOrderTx (orders repo) canCloseOrder ile aynı simetrik
      // overpay reddini uygulamalı (/payments close-path paritesi) → 400.
      // BUGÜN: payOrderTx yalnız `paidTotal < total_cents` (underpaid)
      // kontrol eder, overpaid kontrolü YOK → 200, order 'paid' olur.
      expect(closeRes.status).toBe(400);
      expect(closeRes.body.error?.code).toBe('PAYMENT_EXCEEDS_TOTAL');
    });
  },
);
