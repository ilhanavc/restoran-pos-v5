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
 * ADR-039 — garsonun (`waiter`) müşteri uçlarına kasiyer-paritesiyle erişimi.
 *
 * Kapsam (ADR-039 DoD 16-20):
 *   - 16: K2.2'deki **12 ucun her biri** → waiter 2xx, kitchen 403, anonim 401
 *         (parametrik; uç uç kopyala-yapıştır değil)
 *   - 17: **projeksiyon paritesi** — aynı kaynak için garson yanıtı ile kasiyer
 *         yanıtı BİREBİR aynı JSON. Bu testin işi, ileride birinin "garsona
 *         maskeleyelim" diye sessizce rol-koşullu dallanma eklemesini yakalamak
 *         (S1=(c) kararının regresyon koruması, K3.1)
 *   - 18: **admin-only regresyonu** — 5 toplu-veri/yaptırım ucu garson VE
 *         kasiyer için 403. "Tam erişim" kararının sessizce taşmadığının kanıtı
 *   - 19: cross-tenant izolasyon (garson oturumuyla) + rate limit 429 (K4)
 *   - 20: garson `POST`/`PATCH` doğrulaması kasiyerinkiyle AYNI davranır
 *
 * Testler `pos_test` üzerinde koşar (`pos_dev` DEĞİL) — fixture temizliği
 * `DELETE FROM tenants` zincirine dokunur.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TENANT_B_ID = randomUUID();

type Role = 'admin' | 'cashier' | 'waiter' | 'kitchen';

interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  role: Role;
  tenantId: string;
}

function makeUser(role: Role, tenantId: string = TENANT_ID): TestUser {
  return {
    id: randomUUID(),
    email: `w39-${role}-${randomUUID()}@example.com`,
    username: `w39-${role}-${randomUUID().slice(0, 8)}`,
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

/** Salt-okuma testlerinin ORTAK müşterisi (parite + cross-tenant için). */
const READ_CUSTOMER_ID = randomUUID();
const READ_PHONE_ID = randomUUID();
const READ_ADDRESS_ID = randomUUID();
/** Tenant B'ye ait müşteri — izolasyon assert'i. */
const CUSTOMER_B_ID = randomUUID();
/** Parite testinin sipariş geçmişi için bir sipariş. */
const HISTORY_ORDER_ID = randomUUID();

interface Ctx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  appB: Express;
  /** Rate-limiter AKTİF instance (K4 / DoD 19 ikinci yarısı). */
  appLimited: Express;
  tokens: Record<string, string>;
}
const ctx: Partial<Ctx> = {};

let previousBypass: string | undefined;
let previousDataBypass: string | undefined;

async function login(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app).post('/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

/**
 * `customer_phones` üzerinde UNIQUE (tenant_id, normalized_phone) vardır →
 * fixture telefonları GERÇEKTEN benzersiz olmalı. Rastgele son ekler 23505
 * ile çakışıyordu; monoton sayaç deterministik ve çakışmasızdır.
 */
let phoneSeq = 0;
function nextNormalizedPhone(): string {
  phoneSeq += 1;
  return `9055${String(phoneSeq).padStart(8, '0')}`;
}

/**
 * API üzerinden gönderilecek benzersiz ham telefon. Sunucu bunu normalize
 * ederek aynı UNIQUE kısıtına yazar → rastgele değil, sayaç tabanlı üretilir.
 */
let rawPhoneSeq = 0;
function nextRawPhone(): string {
  rawPhoneSeq += 1;
  return `0536${String(rawPhoneSeq).padStart(7, '0')}`;
}

/** Taze müşteri + telefon + adres — YAZAN uçların her denemesi kendi kaynağını
 *  kullansın (bir testin sildiği satır diğerini 404'e düşürmesin). */
async function seedCustomer(db: Kysely<DB>): Promise<{
  customerId: string;
  phoneId: string;
  addressId: string;
}> {
  const customerId = randomUUID();
  const phoneId = randomUUID();
  const addressId = randomUUID();
  await db
    .insertInto('customers')
    .values({
      id: customerId,
      tenant_id: TENANT_ID,
      full_name: 'Rbac Test Musteri',
    })
    .execute();
  // İKİ telefon: `CUSTOMER_LAST_PHONE_REQUIRED` domain kuralı son telefonun
  // silinmesini 400 ile reddeder (müşteri telefonsuz kalamaz). Silme testi
  // ikinci (birincil OLMAYAN) numarayı hedefler → sınanan şey YETKİdir, iş
  // kuralı değil.
  await db
    .insertInto('customer_phones')
    .values([
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        customer_id: customerId,
        raw_phone: '0532 111 22 33',
        normalized_phone: nextNormalizedPhone(),
        is_primary: true,
      },
      {
        id: phoneId,
        tenant_id: TENANT_ID,
        customer_id: customerId,
        raw_phone: '0532 111 22 34',
        normalized_phone: nextNormalizedPhone(),
        is_primary: false,
      },
    ])
    .execute();
  await db
    .insertInto('customer_addresses')
    .values({
      id: addressId,
      tenant_id: TENANT_ID,
      customer_id: customerId,
      title: 'Ev',
      address_line: 'Test Mahallesi 1. Sokak No 5',
      is_default: true,
    })
    .execute();
  return { customerId, phoneId, addressId };
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-039 — /customers garson (waiter) erişimi',
  () => {
    beforeAll(async () => {
      previousBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';

      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;

      // 1) Limiter AKTİF instance ÖNCE kurulur (limiter env'i KURULUM anında
      //    okur; bypass'ı silmeden inşa edilirse sonsuza dek bypass'lı kalır).
      previousDataBypass = process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'];
      delete process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'];
      const appDeps = {
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        webOrigin: 'http://localhost:5173',
      };
      ctx.appLimited = buildApp({ ...appDeps, tenantId: TENANT_ID });

      // 2) Mantık testlerinin app'leri — limiter BYPASS'lı (bu dosya tek IP'den
      //    60'tan fazla müşteri isteği atar).
      process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'] = '1';
      ctx.app = buildApp({ ...appDeps, tenantId: TENANT_ID });
      ctx.appB = buildApp({ ...appDeps, tenantId: TENANT_B_ID });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_ID,
            name: 'Waiter RBAC A',
            slug: `w39-a-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'Waiter RBAC B',
            slug: `w39-b-${TENANT_B_ID.slice(0, 8)}`,
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
          {
            id: READ_CUSTOMER_ID,
            tenant_id: TENANT_ID,
            full_name: 'Parite Musterisi',
            note: 'Kapida bozuk para istemiyor',
          },
          {
            id: CUSTOMER_B_ID,
            tenant_id: TENANT_B_ID,
            full_name: 'Diger Tenant Musterisi',
          },
        ])
        .execute();
      await db
        .insertInto('customer_phones')
        .values({
          id: READ_PHONE_ID,
          tenant_id: TENANT_ID,
          customer_id: READ_CUSTOMER_ID,
          raw_phone: '0532 987 65 43',
          normalized_phone: '905329876543',
          is_primary: true,
        })
        .execute();
      await db
        .insertInto('customer_addresses')
        .values({
          id: READ_ADDRESS_ID,
          tenant_id: TENANT_ID,
          customer_id: READ_CUSTOMER_ID,
          title: 'Ev',
          address_line: 'Parite Mahallesi 3. Sokak No 7',
          district: 'Sarkoy',
          neighborhood: 'Murefte',
          is_default: true,
        })
        .execute();

      // Sipariş geçmişi paritesi için bir kapalı paket sipariş.
      await db
        .insertInto('orders')
        .values({
          id: HISTORY_ORDER_ID,
          tenant_id: TENANT_ID,
          customer_id: READ_CUSTOMER_ID,
          order_no: 4242,
          store_date: new Date(Date.UTC(2026, 6, 1)),
          created_at: new Date(Date.UTC(2026, 6, 1, 12, 0, 0)),
          order_type: 'takeaway',
          takeaway_stage: 'delivered',
          status: 'paid',
          total_cents: 12500,
        })
        .execute();

      ctx.tokens = {};
      for (const u of ALL_USERS) {
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
      if (previousDataBypass === undefined) {
        delete process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'];
      } else {
        process.env['E2E_BYPASS_CUSTOMER_HISTORY_LIMIT'] = previousDataBypass;
      }
      if (ctx.db === undefined) return;
      // FK zinciri: order_items → orders → customer_* → customers → users →
      // settings → tenant (eksik halka 23503 verir).
      for (const tid of [TENANT_ID, TENANT_B_ID]) {
        await ctx.db
          .deleteFrom('order_items')
          .where('tenant_id', '=', tid)
          .execute();
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
        await ctx.db
          .deleteFrom('customers')
          .where('tenant_id', '=', tid)
          .execute();
        await ctx.db
          .deleteFrom('audit_logs')
          .where('tenant_id', '=', tid)
          .execute();
        await ctx.db.deleteFrom('users').where('tenant_id', '=', tid).execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', tid)
          .execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', tid).execute();
      }
      await ctx.pool?.end();
    });

    // ─────────────────────────────────────────────────────────────────────
    // DoD 16 — K2.2'deki 12 uç: waiter 2xx · kitchen 403 · anonim 401
    // ─────────────────────────────────────────────────────────────────────
    interface EndpointCase {
      name: string;
      method: 'get' | 'post' | 'patch' | 'delete';
      /** Taze fixture id'leriyle yol üretir (yazan uçlar için şart). */
      path: (f: {
        customerId: string;
        phoneId: string;
        addressId: string;
      }) => string;
      body?: () => object;
      /** Garson için beklenen BAŞARI kodu. */
      okStatus: number;
    }

    const OPEN_ENDPOINTS: EndpointCase[] = [
      {
        name: 'GET /customers/search',
        method: 'get',
        path: () => '/customers/search?search=Parite',
        okStatus: 200,
      },
      {
        name: 'GET /customers (sayfalı liste)',
        method: 'get',
        path: () => '/customers?page=1&limit=10',
        okStatus: 200,
      },
      {
        name: 'GET /customers/ids',
        method: 'get',
        path: () => '/customers/ids',
        okStatus: 200,
      },
      {
        name: 'POST /customers (yeni müşteri)',
        method: 'post',
        path: () => '/customers',
        body: () => ({
          fullName: 'Garsonun Actigi Musteri',
          phones: [
            {
              rawPhone: nextRawPhone(),
              isPrimary: true,
            },
          ],
        }),
        okStatus: 201,
      },
      {
        name: 'GET /customers/:id',
        method: 'get',
        path: (f) => `/customers/${f.customerId}`,
        okStatus: 200,
      },
      {
        name: 'PATCH /customers/:id',
        method: 'patch',
        path: (f) => `/customers/${f.customerId}`,
        body: () => ({ fullName: 'Guncellenmis Ad' }),
        okStatus: 200,
      },
      {
        name: 'POST /customers/:id/phones',
        method: 'post',
        path: (f) => `/customers/${f.customerId}/phones`,
        body: () => ({
          rawPhone: nextRawPhone(),
        }),
        okStatus: 201,
      },
      {
        name: 'DELETE /customers/:id/phones/:phoneId',
        method: 'delete',
        path: (f) => `/customers/${f.customerId}/phones/${f.phoneId}`,
        okStatus: 204,
      },
      {
        name: 'POST /customers/:id/addresses',
        method: 'post',
        path: (f) => `/customers/${f.customerId}/addresses`,
        body: () => ({ addressLine: 'Yeni Adres Sokak No 12' }),
        okStatus: 201,
      },
      {
        name: 'PATCH /customers/:id/addresses/:addressId',
        method: 'patch',
        path: (f) => `/customers/${f.customerId}/addresses/${f.addressId}`,
        body: () => ({ addressLine: 'Guncellenmis Adres Sokak No 13' }),
        okStatus: 200,
      },
      {
        name: 'DELETE /customers/:id/addresses/:addressId',
        method: 'delete',
        path: (f) => `/customers/${f.customerId}/addresses/${f.addressId}`,
        okStatus: 204,
      },
      {
        name: 'GET /customers/:id/orders (ADR-038 geçmiş)',
        method: 'get',
        path: (f) => `/customers/${f.customerId}/orders`,
        okStatus: 200,
      },
    ];

    it('K2.2 envanteri 12 uçtan oluşur (ADR ile sayı paritesi)', () => {
      expect(OPEN_ENDPOINTS).toHaveLength(12);
    });

    describe.each(OPEN_ENDPOINTS)('$name', (endpoint) => {
      it('garson → başarı (kasiyer paritesi)', async () => {
        const fixture = await seedCustomer(ctx.db!);
        const req = request(ctx.app!)
          [endpoint.method](endpoint.path(fixture))
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`);
        const res =
          endpoint.body !== undefined ? await req.send(endpoint.body()) : await req;
        expect(res.status).toBe(endpoint.okStatus);
      });

      it('mutfak (kitchen) → 403 (müşteri verisiyle işi yok)', async () => {
        const fixture = await seedCustomer(ctx.db!);
        const req = request(ctx.app!)
          [endpoint.method](endpoint.path(fixture))
          .set('Authorization', `Bearer ${ctx.tokens!['kitchen']}`);
        const res =
          endpoint.body !== undefined ? await req.send(endpoint.body()) : await req;
        expect(res.status).toBe(403);
      });

      it('anonim → 401', async () => {
        const fixture = await seedCustomer(ctx.db!);
        const req = request(ctx.app!)[endpoint.method](endpoint.path(fixture));
        const res =
          endpoint.body !== undefined ? await req.send(endpoint.body()) : await req;
        expect(res.status).toBe(401);
      });
    });

    // ─────────────────────────────────────────────────────────────────────
    // DoD 17 — PROJEKSİYON PARİTESİ (K3.1'in teminatı)
    // ─────────────────────────────────────────────────────────────────────
    describe('projeksiyon paritesi — garson yanıtı = kasiyer yanıtı', () => {
      const READ_PATHS = [
        '/customers/search?search=Parite',
        '/customers?page=1&limit=10',
        '/customers/ids',
        `/customers/${READ_CUSTOMER_ID}`,
        `/customers/${READ_CUSTOMER_ID}/orders`,
      ];

      it.each(READ_PATHS)(
        '%s → iki rol BİREBİR aynı JSON döner',
        async (path) => {
          const asWaiter = await request(ctx.app!)
            .get(path)
            .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`);
          const asCashier = await request(ctx.app!)
            .get(path)
            .set('Authorization', `Bearer ${ctx.tokens!['cashier']}`);

          expect(asWaiter.status).toBe(200);
          expect(asCashier.status).toBe(200);
          // DERİN eşitlik: rol-koşullu bir dallanma (maskeleme, alan kırpma,
          // farklı limit) eklenirse bu assert kırmızıya döner.
          expect(asWaiter.body).toEqual(asCashier.body);
        },
      );

      it('garson TAM telefonu ve açık adresi görür (maskeleme YOK)', async () => {
        const res = await request(ctx.app!)
          .get(`/customers/${READ_CUSTOMER_ID}`)
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`);
        expect(res.status).toBe(200);
        expect(res.body.data.phones[0].rawPhone).toBe('0532 987 65 43');
        expect(res.body.data.phones[0].normalizedPhone).toBe('905329876543');
        expect(res.body.data.addresses[0].addressLine).toBe(
          'Parite Mahallesi 3. Sokak No 7',
        );
        // Müşteri notu da kasiyerdeki gibi açıktır (S1=(c) bilinçli kararı).
        expect(res.body.data.notes).toBe('Kapida bozuk para istemiyor');
      });
    });

    // ─────────────────────────────────────────────────────────────────────
    // DoD 18 — ADMIN-ONLY REGRESYONU (K2.3): garson VE kasiyer 403
    // ─────────────────────────────────────────────────────────────────────
    describe('admin-only uçlar garsona AÇILMADI (sessiz genişletme kontrolü)', () => {
      const ADMIN_ONLY: Array<{
        name: string;
        method: 'get' | 'post' | 'patch' | 'delete';
        path: string;
        body?: object;
      }> = [
        {
          name: 'POST /customers/import/preview',
          method: 'post',
          path: '/customers/import/preview',
          body: {},
        },
        {
          name: 'POST /customers/import/commit',
          method: 'post',
          path: '/customers/import/commit',
          body: { token: randomUUID() },
        },
        {
          name: 'GET /customers/export',
          method: 'get',
          path: '/customers/export',
        },
        {
          name: 'DELETE /customers/bulk',
          method: 'delete',
          path: '/customers/bulk',
          body: { ids: [randomUUID()] },
        },
        {
          name: 'PATCH /customers/:id/blacklist',
          method: 'patch',
          path: `/customers/${READ_CUSTOMER_ID}/blacklist`,
          body: { isBlacklisted: true },
        },
      ];

      it('envanter 5 uçtan oluşur (K2.3 ile sayı paritesi)', () => {
        expect(ADMIN_ONLY).toHaveLength(5);
      });

      // Kasiyeri de sınamak kritik: "garson = kasiyer" kuralının bu uçları
      // KENDİLİĞİNDEN dışarıda bıraktığının kanıtı (K2.4).
      describe.each(ADMIN_ONLY)('$name', (endpoint) => {
        it.each(['waiter', 'cashier'])('%s → 403', async (role) => {
          const req = request(ctx.app!)
            [endpoint.method](endpoint.path)
            .set('Authorization', `Bearer ${ctx.tokens![role]}`);
          const res =
            endpoint.body !== undefined ? await req.send(endpoint.body) : await req;
          expect(res.status).toBe(403);
        });
      });
    });

    // ─────────────────────────────────────────────────────────────────────
    // DoD 19 — cross-tenant izolasyon + rate limit
    // ─────────────────────────────────────────────────────────────────────
    describe('tenant izolasyonu (garson oturumuyla)', () => {
      it('başka tenant müşterisinin detayı → 404', async () => {
        const res = await request(ctx.app!)
          .get(`/customers/${CUSTOMER_B_ID}`)
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`);
        expect(res.status).toBe(404);
      });

      it('liste başka tenant müşterisini İÇERMEZ', async () => {
        const res = await request(ctx.app!)
          .get('/customers?page=1&limit=200')
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`);
        expect(res.status).toBe(200);
        const ids = (res.body.data.customers as Array<{ id: string }>).map(
          (c) => c.id,
        );
        expect(ids).not.toContain(CUSTOMER_B_ID);
      });

      it('başka tenant müşterisinin sipariş geçmişi → 404', async () => {
        const res = await request(ctx.app!)
          .get(`/customers/${CUSTOMER_B_ID}/orders`)
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`);
        expect(res.status).toBe(404);
      });
    });

    describe('rate limit (K4) — rol-bağımsız aynı tavan, TÜM rehber uçları', () => {
      /**
       * Security-review MAJOR-1 regresyonu: throttle ilk turda yalnız
       * `/search`, `GET /` ve `/:id/orders`'a takılıydı; `/ids` (tüm UUID'ler
       * tek istekte) ve `GET /:id` (TAM PII) açıkta kalmıştı. Beşi bir hasat
       * zincirinin halkalarıdır — biri limitsizse diğerlerini sınırlamak
       * anlamsızdır (id'leri bir uçtan topla, PII'yi ötekinden çek).
       *
       * Test bunu, tavanı TEK uçtan tüketip DİĞERLERİNİN de 429 verdiğini
       * doğrulayarak kanıtlar: bu ancak hepsi AYNI limiter örneğine bağlıysa
       * geçer. Uçlardan birinin `customerDataLimiter`'ı düşerse kırmızıya
       * döner.
       */
      it('tavan bir uçtan tükenince rehber uçlarının HEPSİ 429 verir', async () => {
        const token = await login(ctx.appLimited!, WAITER.email, WAITER.password);

        // 1) Tavanı `/search` üzerinden tüket (60/dk; store per-app in-memory).
        let blocked: number | null = null;
        for (let i = 0; i < 70; i++) {
          const res = await request(ctx.appLimited!)
            .get('/customers/search?search=Parite')
            .set('Authorization', `Bearer ${token}`);
          if (res.status === 429) {
            blocked = i;
            expect(res.body.error.code).toBe('CUSTOMER_HISTORY_RATE_LIMITED');
            break;
          }
        }
        expect(blocked).not.toBeNull();

        // 2) Aynı pencerede diğer DÖRT rehber ucu da kapalı olmalı.
        const guardedPaths = [
          '/customers?page=1&limit=10',
          '/customers/ids',
          `/customers/${READ_CUSTOMER_ID}`,
          `/customers/${READ_CUSTOMER_ID}/orders`,
        ];
        for (const path of guardedPaths) {
          const res = await request(ctx.appLimited!)
            .get(path)
            .set('Authorization', `Bearer ${token}`);
          expect(
            res.status,
            `${path} throttle'a bağlı DEĞİL (customerDataLimiter eksik)`,
          ).toBe(429);
        }
      }, 60_000);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Security-review MAJOR-2 — telefon/adres CRUD denetim izi (KVKK m.12)
    // ─────────────────────────────────────────────────────────────────────
    describe('iletişim bilgisi mutasyonları denetleniyor', () => {
      /** Bu müşteriye ait, verilen tipteki denetim kayıtları. */
      async function auditsFor(
        customerId: string,
        eventType: string,
      ): Promise<Array<Record<string, unknown>>> {
        const rows = await ctx.db!
          .selectFrom('audit_logs')
          .select(['payload', 'actor_user_id'])
          .where('tenant_id', '=', TENANT_ID)
          .where('entity_type', '=', 'customer')
          .where('entity_id', '=', customerId)
          .where('event_type', '=', eventType)
          .execute();
        return rows as unknown as Array<Record<string, unknown>>;
      }

      it('POST /:id/phones → customer.phone_added (aktör + phone_id, numara YOK)', async () => {
        const { customerId } = await seedCustomer(ctx.db!);
        const res = await request(ctx.app!)
          .post(`/customers/${customerId}/phones`)
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`)
          .send({ rawPhone: nextRawPhone() });
        expect(res.status).toBe(201);

        const rows = await auditsFor(customerId, 'customer.phone_added');
        expect(rows).toHaveLength(1);
        expect(rows[0]!['actor_user_id']).toBe(WAITER.id);
        const payload = rows[0]!['payload'] as Record<string, unknown>;
        expect(payload['customer_id']).toBe(customerId);
        expect(payload['phone_id']).toBeTruthy();
        // PII sızıntısı kontrolü: numaranın kendisi HİÇBİR anahtarda olmamalı.
        expect(JSON.stringify(payload)).not.toContain('0536');
        expect(payload).not.toHaveProperty('raw_phone');
      });

      it('DELETE /:id/phones/:phoneId → customer.phone_removed + remaining_count', async () => {
        const { customerId, phoneId } = await seedCustomer(ctx.db!);
        const res = await request(ctx.app!)
          .delete(`/customers/${customerId}/phones/${phoneId}`)
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`);
        expect(res.status).toBe(204);

        const rows = await auditsFor(customerId, 'customer.phone_removed');
        expect(rows).toHaveLength(1);
        const payload = rows[0]!['payload'] as Record<string, unknown>;
        expect(payload['phone_id']).toBe(phoneId);
        // Fixture iki telefonla açılır; biri silinince BİR tane kalır.
        expect(payload['remaining_count']).toBe(1);
      });

      it('POST /:id/addresses → customer.address_added (adres METNİ yazılmaz)', async () => {
        const { customerId } = await seedCustomer(ctx.db!);
        const res = await request(ctx.app!)
          .post(`/customers/${customerId}/addresses`)
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`)
          .send({ addressLine: 'Gizli Mahallesi 9. Sokak No 4' });
        expect(res.status).toBe(201);

        const rows = await auditsFor(customerId, 'customer.address_added');
        expect(rows).toHaveLength(1);
        const payload = rows[0]!['payload'] as Record<string, unknown>;
        expect(payload['address_id']).toBeTruthy();
        expect(JSON.stringify(payload)).not.toContain('Gizli Mahallesi');
      });

      it('PATCH /:id/addresses/:addressId → customer.address_updated (yalnız alan ADLARI)', async () => {
        const { customerId, addressId } = await seedCustomer(ctx.db!);
        const res = await request(ctx.app!)
          .patch(`/customers/${customerId}/addresses/${addressId}`)
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`)
          .send({ addressLine: 'Yeni Gizli Sokak No 11' });
        expect(res.status).toBe(200);

        const rows = await auditsFor(customerId, 'customer.address_updated');
        expect(rows).toHaveLength(1);
        const payload = rows[0]!['payload'] as Record<string, unknown>;
        expect(payload['changed_fields']).toEqual(['addressLine']);
        expect(JSON.stringify(payload)).not.toContain('Yeni Gizli Sokak');
      });

      it('DELETE /:id/addresses/:addressId → customer.address_removed + remaining_count', async () => {
        const { customerId, addressId } = await seedCustomer(ctx.db!);
        const res = await request(ctx.app!)
          .delete(`/customers/${customerId}/addresses/${addressId}`)
          .set('Authorization', `Bearer ${ctx.tokens!['waiter']}`);
        expect(res.status).toBe(204);

        const rows = await auditsFor(customerId, 'customer.address_removed');
        expect(rows).toHaveLength(1);
        const payload = rows[0]!['payload'] as Record<string, unknown>;
        expect(payload['address_id']).toBe(addressId);
        // Fixture tek adresle açılır → silmeden sonra sıfır kalır.
        expect(payload['remaining_count']).toBe(0);
      });

      it('kasiyer de aynı izi bırakır (denetim role göre değişmez)', async () => {
        const { customerId } = await seedCustomer(ctx.db!);
        const res = await request(ctx.app!)
          .post(`/customers/${customerId}/phones`)
          .set('Authorization', `Bearer ${ctx.tokens!['cashier']}`)
          .send({ rawPhone: nextRawPhone() });
        expect(res.status).toBe(201);

        const rows = await auditsFor(customerId, 'customer.phone_added');
        expect(rows).toHaveLength(1);
        expect(rows[0]!['actor_user_id']).toBe(CASHIER.id);
      });
    });

    // ─────────────────────────────────────────────────────────────────────
    // DoD 20 — doğrulama paritesi (ek kısıt YOK, gevşetme de YOK)
    // ─────────────────────────────────────────────────────────────────────
    describe('gövde doğrulaması garson ve kasiyer için AYNI', () => {
      it('aynı GEÇERSİZ gövde → iki rolde de 400', async () => {
        const invalid = { fullName: 'X', phones: [] }; // ad < 2, telefon yok
        for (const role of ['waiter', 'cashier']) {
          const res = await request(ctx.app!)
            .post('/customers')
            .set('Authorization', `Bearer ${ctx.tokens![role]}`)
            .send(invalid);
          expect(res.status).toBe(400);
        }
      });

      it('aynı GEÇERLİ gövde → iki rolde de 201 ve aynı yanıt ŞEKLİ', async () => {
        const shapes: string[][] = [];
        for (const role of ['waiter', 'cashier']) {
          const res = await request(ctx.app!)
            .post('/customers')
            .set('Authorization', `Bearer ${ctx.tokens![role]}`)
            .send({
              fullName: `Parite ${role}`,
              phones: [
                {
                  rawPhone: nextRawPhone(),
                  isPrimary: true,
                },
              ],
            });
          expect(res.status).toBe(201);
          shapes.push(Object.keys(res.body.data).sort());
        }
        expect(shapes[0]).toEqual(shapes[1]);
      });

      it('garson PATCH doğrulaması da aynı (geçersiz ad → 400)', async () => {
        const { customerId } = await seedCustomer(ctx.db!);
        for (const role of ['waiter', 'cashier']) {
          const res = await request(ctx.app!)
            .patch(`/customers/${customerId}`)
            .set('Authorization', `Bearer ${ctx.tokens![role]}`)
            .send({ fullName: 'X' });
          expect(res.status).toBe(400);
        }
      });
    });
  },
);
