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
 * ADR-038 — `GET /customers/:id/orders` entegrasyon testleri.
 *
 * Kapsam (ADR-038 DoD 16-20, 23):
 *   - keyset sayfalama: limit sınırı, nextCursor round-trip, AYNI `created_at`
 *     çakışmasında tekrar/atlama yok
 *   - bozuk cursor → 400
 *   - RBAC: admin/cashier/waiter 200, kitchen 403, anonim 401
 *   - cross-tenant müşteri → 404 + başka tenant'ın siparişi listede yok
 *   - sıralama en-yeni-önce, cancelled/void listede, soft-delete müşteri → 404
 *   - yanıt PII taşımıyor
 *   - rate-limit (60/dk-IP) gerçekten bağlı (security-reviewer HIGH)
 *   - `customer.history_viewed` audit izi yazılıyor (KVKK m.12, HIGH)
 *
 * Testler `pos_test` üzerinde koşar (`pos_dev` DEĞİL) — fixture temizliği
 * `DELETE FROM tenants` zincirine dokunduğu için dev verisi riske atılmaz.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TENANT_B_ID = randomUUID();

interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  role: 'admin' | 'cashier' | 'waiter' | 'kitchen';
  tenantId: string;
}

function makeUser(
  role: TestUser['role'],
  tenantId: string = TENANT_ID,
): TestUser {
  return {
    id: randomUUID(),
    email: `${role}-${randomUUID()}@example.com`,
    username: `${role}-${randomUUID().slice(0, 8)}`,
    password: `${role}pass12345`,
    role,
    tenantId,
  };
}

const ADMIN = makeUser('admin');
const CASHIER = makeUser('cashier');
const WAITER = makeUser('waiter');
const KITCHEN = makeUser('kitchen');
const ADMIN_B = makeUser('admin', TENANT_B_ID);
const ALL_USERS = [ADMIN, CASHIER, WAITER, KITCHEN, ADMIN_B];

// Müşteriler
const CUSTOMER_ID = randomUUID();
const SOFT_DELETED_CUSTOMER_ID = randomUUID();
const EMPTY_CUSTOMER_ID = randomUUID();
const CUSTOMER_B_ID = randomUUID(); // TENANT_B'ye ait

/** Sıralama/sayfalama testleri için 25 sipariş + 2 özel durum siparişi. */
const ORDER_COUNT = 25;
/** Aynı `created_at`'e sahip iki sipariş (deterministik sıra testi). */
const TIE_CREATED_AT = new Date('2026-05-05T12:00:00.000Z');

/** ADR-038 K5.1 — KAPALI + müşteri-bağlantılı sipariş (garson GÖRMELİ). */
let CUSTOMER_LINKED_CLOSED_ORDER_ID = '';
/** ADR-038 K5.1 — KAPALI + müşterisiz salon adisyonu (garsona KAPALI kalmalı). */
let CLOSED_NO_CUSTOMER_ORDER_ID = '';

interface Ctx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  /**
   * TENANT_B'ye bağlı AYRI app instance'ı. `POST /auth/login` kullanıcıyı
   * `deps.tenantId` ile scope'layarak arar; tenant B kullanıcısı tenant A
   * app'inden giriş YAPAMAZ. İzolasyon testinin gerçekten iki tenant'ı
   * karşılaştırması için ikinci instance şart.
   */
  appB: Express;
  /**
   * `customerHistoryLimiter` AKTİF olan üçüncü instance. Limiter env'i
   * KURULUM anında okur → bypass'ı silip önce bunu, sonra bypass'lı `app`'i
   * kurarız. Store per-app in-memory olduğundan sayaçlar karışmaz.
   */
  appLimited: Express;
  tokens: Record<string, string>;
}
const ctx: Partial<Ctx> = {};

/**
 * `loginLimiter` 15 dakikada 5 giriş ile sınırlı; bu dosya 5 kullanıcı ile
 * giriş yapıyor → limit ISIRIR ve hata 429 olarak gelir (yanıltıcı biçimde
 * "login failed" görünür). Router limiter'ı KURULUM anında okuduğu için env
 * `buildApp`'ten ÖNCE set edilmeli.
 */
let previousBypass: string | undefined;
/** `E2E_BYPASS_CUSTOMER_HISTORY_LIMIT` — bu dosya tek IP'den 60+ istek atar. */
let previousHistoryBypass: string | undefined;

async function login(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(
      `login failed: ${res.status} ${JSON.stringify(res.body)} [${email}]`,
    );
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'GET /customers/:id/orders (ADR-038)',
  () => {
    beforeAll(async () => {
      previousBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';

      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;

      // 1) Limiter AKTİF instance (bypass env'i silinmiş hâlde kurulur).
      previousHistoryBypass = process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'];
      delete process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'];
      ctx.appLimited = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      // 2) Mantık testlerinin app'leri — limiter BYPASS'lı.
      process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'] = '1';
      ctx.app = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });
      ctx.appB = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_B_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_ID,
            name: 'History Tenant A',
            slug: `hist-a-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'History Tenant B',
            slug: `hist-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .execute();

      await db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_ID }, { tenant_id: TENANT_B_ID }])
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('users')
        .values(
          await Promise.all(
            ALL_USERS.map(async (u) => ({
              id: u.id,
              tenant_id: u.tenantId,
              email: u.email,
              username: u.username,
              password_hash: await hashPassword(u.password),
              role: u.role,
            })),
          ),
        )
        .execute();

      await db
        .insertInto('customers')
        .values([
          { id: CUSTOMER_ID, tenant_id: TENANT_ID, full_name: 'Gecmis Musteri' },
          {
            id: EMPTY_CUSTOMER_ID,
            tenant_id: TENANT_ID,
            full_name: 'Siparissiz Musteri',
          },
          {
            id: SOFT_DELETED_CUSTOMER_ID,
            tenant_id: TENANT_ID,
            full_name: 'Silinmis Musteri',
            deleted_at: new Date(),
          },
          {
            id: CUSTOMER_B_ID,
            tenant_id: TENANT_B_ID,
            full_name: 'Diger Tenant Musterisi',
          },
        ])
        .execute();

      // 25 normal sipariş — created_at artan; en yenisi en son.
      const orders = Array.from({ length: ORDER_COUNT }, (_, i) => ({
        id: randomUUID(),
        tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        order_no: 5000 + i,
        store_date: new Date(Date.UTC(2026, 0, 1 + i)),
        created_at: new Date(Date.UTC(2026, 0, 1 + i, 10, 0, 0)),
        order_type: 'takeaway' as const,
        takeaway_stage: 'delivered' as const,
        status: 'paid' as const,
        total_cents: 1000 + i,
      }));

      // Aynı created_at'e sahip İKİ sipariş — deterministik sıra (created_at,
      // id) DESC ile çözülür; cursor bunlarda tekrar/atlama üretmemeli.
      const tieOrders = [
        {
          id: randomUUID(),
          tenant_id: TENANT_ID,
          customer_id: CUSTOMER_ID,
          order_no: 6001,
          store_date: new Date(Date.UTC(2026, 4, 5)),
          created_at: TIE_CREATED_AT,
          order_type: 'takeaway' as const,
          takeaway_stage: 'delivered' as const,
          status: 'paid' as const,
          total_cents: 7777,
        },
        {
          id: randomUUID(),
          tenant_id: TENANT_ID,
          customer_id: CUSTOMER_ID,
          order_no: 6002,
          store_date: new Date(Date.UTC(2026, 4, 5)),
          created_at: TIE_CREATED_AT,
          order_type: 'takeaway' as const,
          takeaway_stage: 'delivered' as const,
          status: 'paid' as const,
          total_cents: 8888,
        },
      ];

      // İptal edilmiş sipariş — K4: listede KALIR, işaretli döner.
      const cancelledOrder = {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        customer_id: CUSTOMER_ID,
        order_no: 7001,
        store_date: new Date(Date.UTC(2026, 5, 1)),
        created_at: new Date(Date.UTC(2026, 5, 1, 10, 0, 0)),
        order_type: 'dine_in' as const,
        takeaway_stage: null,
        status: 'cancelled' as const,
        total_cents: 4242,
      };

      // ADR-038 K5.1 negatif kutbu: KAPALI + müşteri bağlantısı OLMAYAN salon
      // adisyonu. Garson bunu geçmiş listesinde göremez → detayı da 404 KALMALI.
      const closedNoCustomerOrder = {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        customer_id: null,
        order_no: 7002,
        store_date: new Date(Date.UTC(2026, 5, 3)),
        created_at: new Date(Date.UTC(2026, 5, 3, 10, 0, 0)),
        order_type: 'dine_in' as const,
        takeaway_stage: null,
        status: 'paid' as const,
        total_cents: 5555,
      };
      CLOSED_NO_CUSTOMER_ORDER_ID = closedNoCustomerOrder.id;

      // Başka tenant'ın siparişi — izolasyon assert'i için.
      const otherTenantOrder = {
        id: randomUUID(),
        tenant_id: TENANT_B_ID,
        customer_id: CUSTOMER_B_ID,
        order_no: 9001,
        store_date: new Date(Date.UTC(2026, 5, 2)),
        created_at: new Date(Date.UTC(2026, 5, 2, 10, 0, 0)),
        order_type: 'takeaway' as const,
        takeaway_stage: 'delivered' as const,
        status: 'paid' as const,
        total_cents: 9999,
      };

      await ctx
        .db!.insertInto('orders')
        .values([
          ...orders,
          ...tieOrders,
          cancelledOrder,
          closedNoCustomerOrder,
          otherTenantOrder,
        ])
        .execute();
      CUSTOMER_LINKED_CLOSED_ORDER_ID = cancelledOrder.id;

      // En yeni siparişe (cancelledOrder) 4 kalem: 3'ü aktif, 1'i iptal.
      // itemCount iptal edilmemişleri sayar → 3; preview ilk 3 addır.
      await ctx
        .db!.insertInto('order_items')
        .values([
          {
            id: randomUUID(),
            tenant_id: TENANT_ID,
            order_id: cancelledOrder.id,
            product_name: 'Kiymali Pide',
            category_name_snapshot: 'Pideler',
            unit_price_cents: 1000,
            total_cents: 1000,
            quantity: 1,
            status: 'served',
            created_at: new Date(Date.UTC(2026, 5, 1, 10, 0, 1)),
          },
          {
            id: randomUUID(),
            tenant_id: TENANT_ID,
            order_id: cancelledOrder.id,
            product_name: 'Ayran',
            category_name_snapshot: 'Icecekler',
            unit_price_cents: 500,
            total_cents: 500,
            quantity: 1,
            status: 'served',
            created_at: new Date(Date.UTC(2026, 5, 1, 10, 0, 2)),
          },
          {
            id: randomUUID(),
            tenant_id: TENANT_ID,
            order_id: cancelledOrder.id,
            product_name: 'Kunefe',
            category_name_snapshot: 'Tatlilar',
            unit_price_cents: 800,
            total_cents: 800,
            quantity: 1,
            status: 'served',
            created_at: new Date(Date.UTC(2026, 5, 1, 10, 0, 3)),
          },
          {
            id: randomUUID(),
            tenant_id: TENANT_ID,
            order_id: cancelledOrder.id,
            product_name: 'Iptal Edilen Urun',
            category_name_snapshot: 'Pideler',
            unit_price_cents: 900,
            total_cents: 900,
            quantity: 1,
            status: 'cancelled',
            created_at: new Date(Date.UTC(2026, 5, 1, 10, 0, 4)),
          },
        ])
        .execute();

      ctx.tokens = {};
      for (const u of ALL_USERS) {
        // Tenant B kullanıcısı yalnız kendi tenant'ına bağlı app üzerinden
        // giriş yapabilir (login `deps.tenantId` ile scope'lu).
        const app = u.tenantId === TENANT_B_ID ? ctx.appB! : ctx.app!;
        ctx.tokens[u.role + (u.tenantId === TENANT_B_ID ? '_b' : '')] =
          await login(app, u.email, u.password);
      }
    });

    afterAll(async () => {
      if (previousBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = previousBypass;
      }
      if (previousHistoryBypass === undefined) {
        delete process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'];
      } else {
        process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'] =
          previousHistoryBypass;
      }
      if (ctx.db === undefined) return;
      // FK zinciri: order_items → orders → customers → users → settings → tenant
      for (const tid of [TENANT_ID, TENANT_B_ID]) {
        await ctx.db.deleteFrom('order_items').where('tenant_id', '=', tid).execute();
        await ctx.db.deleteFrom('orders').where('tenant_id', '=', tid).execute();
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', tid)
          .execute();
        await ctx.db
          .deleteFrom('customer_phones')
          .where('tenant_id', '=', tid)
          .execute();
        await ctx.db
          .deleteFrom('customer_addresses')
          .where('tenant_id', '=', tid)
          .execute();
        await ctx.db.deleteFrom('customers').where('tenant_id', '=', tid).execute();
        await ctx.db.deleteFrom('audit_logs').where('tenant_id', '=', tid).execute();
        await ctx.db.deleteFrom('users').where('tenant_id', '=', tid).execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', tid)
          .execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await ctx.db.destroy();
    });

    function get(path: string, token?: string, app?: Express) {
      const req = request(app ?? ctx.app!).get(path);
      return token === undefined
        ? req
        : req.set('Authorization', `Bearer ${token}`);
    }

    // ─── RBAC (DoD 17) ────────────────────────────────────────────────────

    it('anonim istek → 401', async () => {
      const res = await get(`/customers/${CUSTOMER_ID}/orders`);
      expect(res.status).toBe(401);
    });

    it('kitchen → 403 (mutfak müşteri verisi görmez)', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders`,
        ctx.tokens!['kitchen'],
      );
      expect(res.status).toBe(403);
    });

    it.each(['admin', 'cashier', 'waiter'])('%s → 200', async (role) => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders`,
        ctx.tokens![role],
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });

    it('waiter yanıtı admin yanıtıyla BİREBİR aynı (ayrı projeksiyon yok)', async () => {
      const adminRes = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=10`,
        ctx.tokens!['admin'],
      );
      const waiterRes = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=10`,
        ctx.tokens!['waiter'],
      );
      expect(waiterRes.status).toBe(200);
      expect(waiterRes.body).toEqual(adminRes.body);
    });

    // ─── 404 yolları (DoD 18, 19) ─────────────────────────────────────────

    it('cross-tenant müşteri → 404', async () => {
      const res = await get(
        `/customers/${CUSTOMER_B_ID}/orders`,
        ctx.tokens!['admin'],
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('soft-delete edilmiş müşteri → 404', async () => {
      const res = await get(
        `/customers/${SOFT_DELETED_CUSTOMER_ID}/orders`,
        ctx.tokens!['admin'],
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('başka tenant siparişi listede YOK (izolasyon)', async () => {
      // Tenant B admini kendi müşterisini sorgular: yalnız kendi siparişi.
      const res = await get(
        `/customers/${CUSTOMER_B_ID}/orders`,
        ctx.tokens!['admin_b'],
        ctx.appB!,
      );
      expect(res.status).toBe(200);
      const orderNos = res.body.data.items.map(
        (i: { orderNo: number }) => i.orderNo,
      );
      expect(orderNos).toEqual([9001]);
    });

    it('siparişi olmayan müşteri → 200 + boş liste', async () => {
      const res = await get(
        `/customers/${EMPTY_CUSTOMER_ID}/orders`,
        ctx.tokens!['admin'],
      );
      expect(res.status).toBe(200);
      expect(res.body.data.items).toEqual([]);
      expect(res.body.data.nextCursor).toBeNull();
    });

    // ─── Sayfalama (DoD 16) ───────────────────────────────────────────────

    it('varsayılan limit 10 + nextCursor dolu', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders`,
        ctx.tokens!['admin'],
      );
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(10);
      expect(typeof res.body.data.nextCursor).toBe('string');
    });

    it('limit > 50 → 400 (üst sınır)', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=51`,
        ctx.tokens!['admin'],
      );
      expect(res.status).toBe(400);
    });

    it('bozuk cursor → 400 VALIDATION_ERROR (sessiz başa-sarma YOK)', async () => {
      for (const bad of ['not-base64!!', 'YWJjZGVm', 'x']) {
        const res = await get(
          `/customers/${CUSTOMER_ID}/orders?cursor=${encodeURIComponent(bad)}`,
          ctx.tokens!['admin'],
        );
        expect(res.status, `cursor=${bad}`).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('cursor round-trip: tüm sayfalar tekrarsız + atlamasız gezilir', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;

      do {
        const url: string =
          cursor === null
            ? `/customers/${CUSTOMER_ID}/orders?limit=7`
            : `/customers/${CUSTOMER_ID}/orders?limit=7&cursor=${encodeURIComponent(cursor)}`;
        const res = await get(url, ctx.tokens!['admin']);
        expect(res.status).toBe(200);
        for (const item of res.body.data.items as { id: string }[]) {
          seen.push(item.id);
        }
        cursor = res.body.data.nextCursor as string | null;
        guard += 1;
      } while (cursor !== null && guard < 20);

      // 25 normal + 2 tie + 1 cancelled = 28 sipariş
      const expectedTotal = ORDER_COUNT + 3;
      expect(seen).toHaveLength(expectedTotal);
      // Tekrar YOK
      expect(new Set(seen).size).toBe(expectedTotal);
    });

    it('aynı created_at çakışmasında tekrar/atlama yok (id ikinci anahtar)', async () => {
      // Tie'lı iki siparişin ortasından geçen bir sayfa boyu seç: limit=1 ile
      // tüm listeyi gez; tie satırları ardışık ve tekrarsız gelmeli.
      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;

      do {
        const url: string =
          cursor === null
            ? `/customers/${CUSTOMER_ID}/orders?limit=1`
            : `/customers/${CUSTOMER_ID}/orders?limit=1&cursor=${encodeURIComponent(cursor)}`;
        const res = await get(url, ctx.tokens!['admin']);
        expect(res.status).toBe(200);
        for (const item of res.body.data.items as { id: string }[]) {
          seen.push(item.id);
        }
        cursor = res.body.data.nextCursor as string | null;
        guard += 1;
      } while (cursor !== null && guard < 60);

      expect(seen).toHaveLength(ORDER_COUNT + 3);
      expect(new Set(seen).size).toBe(ORDER_COUNT + 3);
    });

    // ─── Sıralama + projeksiyon (DoD 19, 20) ──────────────────────────────

    it('sıralama en-yeni-önce (created_at DESC)', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=50`,
        ctx.tokens!['admin'],
      );
      expect(res.status).toBe(200);
      const times = (res.body.data.items as { createdAt: string }[]).map((i) =>
        new Date(i.createdAt).getTime(),
      );
      const sortedDesc = [...times].sort((a, b) => b - a);
      expect(times).toEqual(sortedDesc);
    });

    it('cancelled sipariş listede ve doğru işaretli (K4)', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=50`,
        ctx.tokens!['admin'],
      );
      const cancelled = (
        res.body.data.items as { orderNo: number; status: string }[]
      ).find((i) => i.orderNo === 7001);
      expect(cancelled).toBeDefined();
      expect(cancelled!.status).toBe('cancelled');
    });

    it('itemCount iptal kalemleri saymaz; itemsPreview ilk 3 addır', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=50`,
        ctx.tokens!['admin'],
      );
      const row = (
        res.body.data.items as {
          orderNo: number;
          itemCount: number;
          itemsPreview: string[];
        }[]
      ).find((i) => i.orderNo === 7001);
      expect(row).toBeDefined();
      expect(row!.itemCount).toBe(3);
      expect(row!.itemsPreview).toEqual(['Kiymali Pide', 'Ayran', 'Kunefe']);
      expect(row!.itemsPreview).not.toContain('Iptal Edilen Urun');
    });

    it('kalemsiz sipariş → itemCount 0, itemsPreview []', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=50`,
        ctx.tokens!['admin'],
      );
      const row = (
        res.body.data.items as {
          orderNo: number;
          itemCount: number;
          itemsPreview: string[];
        }[]
      ).find((i) => i.orderNo === 5000);
      expect(row).toBeDefined();
      expect(row!.itemCount).toBe(0);
      expect(row!.itemsPreview).toEqual([]);
    });

    it('yanıt PII TAŞIMAZ (telefon/adres/isim alanı yok)', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=50`,
        ctx.tokens!['admin'],
      );
      const allowed = new Set([
        'id',
        'orderNo',
        'createdAt',
        'storeDate',
        'orderType',
        'status',
        'takeawayStage',
        'totalCents',
        'itemCount',
        'itemsPreview',
      ]);
      for (const item of res.body.data.items as Record<string, unknown>[]) {
        for (const key of Object.keys(item)) {
          expect(allowed.has(key), `beklenmeyen alan: ${key}`).toBe(true);
        }
      }
      // Ham gövdede müşteri adı/telefonu geçmemeli.
      expect(JSON.stringify(res.body)).not.toContain('Gecmis Musteri');
    });

    it('totalCents integer kuruş (float değil) + storeDate YYYY-MM-DD', async () => {
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=50`,
        ctx.tokens!['admin'],
      );
      for (const item of res.body.data.items as {
        totalCents: number;
        storeDate: string;
      }[]) {
        expect(Number.isInteger(item.totalCents)).toBe(true);
        expect(item.storeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    // ─── Rate-limit (security-reviewer HIGH) ──────────────────────────────

    it('61. istek → 429 CUSTOMER_HISTORY_RATE_LIMITED (toplu hasat kapanır)', async () => {
      // Limiter authenticate'ten ÖNCE → token'sız istekle ucuz sayılır:
      // limiter geçer (count++) → authenticate 401 (DB'ye dokunmadan).
      // Sabit X-Forwarded-For (trust proxy=1) → tek limiter key'i.
      const CLIENT_IP = '203.0.113.38';
      for (let i = 0; i < 60; i++) {
        const res = await request(ctx.appLimited!)
          .get(`/customers/${CUSTOMER_ID}/orders`)
          .set('X-Forwarded-For', CLIENT_IP);
        expect(res.status, `istek #${i + 1}`).not.toBe(429);
      }
      const blocked = await request(ctx.appLimited!)
        .get(`/customers/${CUSTOMER_ID}/orders`)
        .set('X-Forwarded-For', CLIENT_IP);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('CUSTOMER_HISTORY_RATE_LIMITED');
      expect(blocked.body.error.message_key).toBe(
        'error.customer.historyRateLimited',
      );
    });

    /**
     * ADR-039 K4 — bu testin beklentisi BİLİNÇLİ OLARAK TERSİNE ÇEVRİLDİ.
     *
     * ADR-038'de throttle yalnız geçmiş ucundaydı ve bu test "diğer
     * /customers uçları etkilenmez" diyordu. ADR-039 ile müşteri verisi
     * `waiter`'a açılınca (S1=(c)) throttle müşteri REHBERİNİN tamamına
     * yayıldı: arama, sayfalı liste, `/ids`, detay ve geçmiş **tek bütçeyi**
     * paylaşır. Gerekçe security-review MAJOR bulgusudur: beşi bir hasat
     * zincirinin halkalarıdır — `/ids` ile UUID'leri toplayıp `GET /:id` ile
     * PII'yi çeken bir betik, yalnız geçmiş ucu sınırlıyken hiç
     * yavaşlamıyordu.
     *
     * Korunan asıl davranış hâlâ sınanıyor: limiter `router.use` DEĞİL,
     * uç-bazlı takılıdır ve **IP başınadır** → tükenmiş bir istemci diğer
     * istemcileri kilitlemez.
     */
    it('ADR-039 K4: rehber uçları AYNI bütçeyi paylaşır (detay da 429)', async () => {
      const res = await request(ctx.appLimited!)
        .get(`/customers/${CUSTOMER_ID}`)
        .set('X-Forwarded-For', '203.0.113.38')
        .set('Authorization', `Bearer ${ctx.tokens!['admin']}`);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('CUSTOMER_HISTORY_RATE_LIMITED');
    });

    it('limiter IP başınadır: BAŞKA istemci etkilenmez (global kill-switch değil)', async () => {
      const res = await request(ctx.appLimited!)
        .get(`/customers/${CUSTOMER_ID}`)
        .set('X-Forwarded-For', '198.51.100.77')
        .set('Authorization', `Bearer ${ctx.tokens!['admin']}`);
      expect(res.status).toBe(200);
    });

    // ─── PII okuma denetimi (KVKK m.12, security-reviewer HIGH) ───────────

    it('başarılı okuma `customer.history_viewed` audit izi yazar', async () => {
      const before = new Date();
      const res = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=5`,
        ctx.tokens!['waiter'],
      );
      expect(res.status).toBe(200);

      // Audit yanıt gönderildikten SONRA yazılır (fire-after-respond) →
      // kısa bir kararlılık penceresi tanı.
      let row:
        | {
            actor_user_id: string | null;
            entity_id: string | null;
            payload: unknown;
          }
        | undefined;
      for (let attempt = 0; attempt < 20 && row === undefined; attempt++) {
        row = await ctx
          .db!.selectFrom('audit_logs')
          .select(['actor_user_id', 'entity_id', 'payload'])
          .where('tenant_id', '=', TENANT_ID)
          .where('event_type', '=', 'customer.history_viewed')
          .where('actor_user_id', '=', WAITER.id)
          .where('created_at', '>=', before)
          .orderBy('created_at', 'desc')
          .executeTakeFirst();
        if (row === undefined) await new Promise((r) => setTimeout(r, 25));
      }

      expect(row, 'customer.history_viewed audit kaydı yok').toBeDefined();
      expect(row!.entity_id).toBe(CUSTOMER_ID);
      // ALLOWED_KEYS üçlü kontratı (ADR-024): whitelist eksikse anahtarlar
      // SESSİZCE düşer ve burası kırmızıya döner.
      expect(row!.payload).toEqual({
        customer_id: CUSTOMER_ID,
        items_count: 5,
        paged: false,
      });
    });

    it('cursor ile okuma `paged: true` yazar', async () => {
      const before = new Date();
      const first = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=5`,
        ctx.tokens!['cashier'],
      );
      const cursor = first.body.data.nextCursor as string;
      expect(typeof cursor).toBe('string');

      const second = await get(
        `/customers/${CUSTOMER_ID}/orders?limit=5&cursor=${encodeURIComponent(cursor)}`,
        ctx.tokens!['cashier'],
      );
      expect(second.status).toBe(200);

      let rows: { payload: unknown }[] = [];
      for (let attempt = 0; attempt < 20 && rows.length < 2; attempt++) {
        rows = await ctx
          .db!.selectFrom('audit_logs')
          .select(['payload'])
          .where('tenant_id', '=', TENANT_ID)
          .where('event_type', '=', 'customer.history_viewed')
          .where('actor_user_id', '=', CASHIER.id)
          .where('created_at', '>=', before)
          .orderBy('created_at', 'asc')
          .execute();
        if (rows.length < 2) await new Promise((r) => setTimeout(r, 25));
      }
      expect(rows).toHaveLength(2);
      expect((rows[0]!.payload as { paged: boolean }).paged).toBe(false);
      expect((rows[1]!.payload as { paged: boolean }).paged).toBe(true);
    });

    // ─── K5.1 — `GET /orders/:id` garson ABAC genişlemesi ─────────────────

    it('garson KAPALI + müşteri-bağlantılı siparişin detayını görür (K5.1)', async () => {
      // Fix'siz bu istek 404 dönerdi: sipariş terminal (`cancelled`) ve garsona
      // ait değil → liste satırı görünüp detayı "bulunamadı" derdi.
      const res = await get(
        `/orders/${CUSTOMER_LINKED_CLOSED_ORDER_ID}`,
        ctx.tokens!['waiter'],
      );
      expect(res.status).toBe(200);
      expect(res.body.data.order.id).toBe(CUSTOMER_LINKED_CLOSED_ORDER_ID);
    });

    it('garson KAPALI + müşterisiz salon adisyonunu HÂLÂ göremez → 404 (K5.1 sınırı)', async () => {
      const res = await get(
        `/orders/${CLOSED_NO_CUSTOMER_ORDER_ID}`,
        ctx.tokens!['waiter'],
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('admin aynı iki siparişin ikisini de görür (genişleme role özgü)', async () => {
      for (const id of [
        CUSTOMER_LINKED_CLOSED_ORDER_ID,
        CLOSED_NO_CUSTOMER_ORDER_ID,
      ]) {
        const res = await get(`/orders/${id}`, ctx.tokens!['admin']);
        expect(res.status, `order ${id}`).toBe(200);
      }
    });

    it('404 (cross-tenant) okuma audit yazmaz — sahte iz üretilmez', async () => {
      const before = new Date();
      const res = await get(
        `/customers/${CUSTOMER_B_ID}/orders`,
        ctx.tokens!['admin'],
      );
      expect(res.status).toBe(404);
      await new Promise((r) => setTimeout(r, 100));

      const rows = await ctx
        .db!.selectFrom('audit_logs')
        .select(['id'])
        .where('event_type', '=', 'customer.history_viewed')
        .where('entity_id', '=', CUSTOMER_B_ID)
        .where('created_at', '>=', before)
        .execute();
      expect(rows).toHaveLength(0);
    });
  },
);
