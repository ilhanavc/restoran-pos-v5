import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { createAppTenantPool } from './helpers/appTenantPool';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const USER_A_ID = randomUUID();
const USER_A_EMAIL = `a-${randomUUID()}@example.com`;
const USER_B_ID = randomUUID();
const USER_B_EMAIL = `b-${randomUUID()}@example.com`;
const PASSWORD = 'correcthorse1234';
const WRONG = 'wrongpassword9999';

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  appPool: Pool;
  appDb: Kysely<DB>;
}
const ctx: Partial<TestCtx> = {};

/**
 * ⚠️ Her rate-limit testi KENDİ app örneğini kurar. `buildApp` her çağrıda
 * yeni limiter (ve yeni MemoryStore) üretir; tek app paylaşılsaydı taban kova
 * (60/dk, IP başına) testler arasında birikirdi ve testler birbirini kirletirdi
 * — sonraki testler alakasız bir 429'la kırmızıya düşerdi.
 */
function freshApp(): Express {
  return buildApp({
    pool: ctx.appPool!,
    db: ctx.appDb!,
    accessSecret: ACCESS_SECRET,
    agentSecret: 'test-agent-secret-min-32-chars-please-long',
    tenantId: TENANT_ID,
    webOrigin: 'http://localhost:5173',
  });
}

const login = (app: Express, email: string, password: string) =>
  request(app).post('/auth/login').send({ email, password });

/**
 * ADR-002 Amendment 8 — `/auth/*` rate-limit.
 *
 * Üç kova, üç ayrı sorumluluk (§14.3-§14.6):
 *   authBaselineLimiter  → tüm /auth/* (404'ler DAHİL), 60/dk per-IP, HER isteği sayar
 *   loginStrictLimiter   → /login, (IP + normalize e-posta), 5/15dk, yalnız BAŞARISIZ
 *   loginVolumeLimiter   → /login, per-IP, 30/15dk, yalnız BAŞARISIZ
 */
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  '/auth rate-limit (ADR-002 Amd8)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      const appPool = createAppTenantPool(DB_URL ?? '');
      ctx.appPool = appPool;
      ctx.appDb = createKysely(appPool);

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant RateLimit',
          slug: `test-rl-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const hash = await hashPassword(PASSWORD);
      await db
        .insertInto('users')
        .values([
          {
            id: USER_A_ID,
            tenant_id: TENANT_ID,
            email: USER_A_EMAIL,
            username: `a-${randomUUID().slice(0, 8)}`,
            password_hash: hash,
            role: 'admin',
          },
          {
            id: USER_B_ID,
            tenant_id: TENANT_ID,
            email: USER_B_EMAIL,
            username: `b-${randomUUID().slice(0, 8)}`,
            password_hash: hash,
            role: 'cashier',
          },
        ])
        .execute();
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('refresh_tokens')
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
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
      if (ctx.appDb !== undefined) await ctx.appDb.destroy();
    });

    // ── K2: taban kova router GİRİŞİNDE ────────────────────────────────────
    it('K2: taban kova VAR OLMAYAN /auth yolunu da sayar (60 geçer, 61. 429)', async () => {
      const app = freshApp();
      // Prod ölçümünde 10 günde 88 adet `POST /auth/signin` vardı — bizim
      // ucumuz DEĞİL (404). Uç-seviyesi bir limiter bu trafiğe hiç değmezdi;
      // bu test K2'nin asıl iddiasını çivileyen testtir.
      for (let i = 0; i < 60; i += 1) {
        const res = await request(app).post('/auth/signin').send({});
        expect(res.status).toBe(404);
      }
      const limited = await request(app).post('/auth/signin').send({});
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('AUTH_RATE_LIMITED');
    }, 60_000);

    it('taban kova 429 yanıtı standart rate-limit başlığı taşır', async () => {
      const app = freshApp();
      for (let i = 0; i < 60; i += 1) {
        await request(app).post('/auth/signin').send({});
      }
      const limited = await request(app).post('/auth/signin').send({});
      expect(limited.status).toBe(429);
      // draft-7: tek birleşik `RateLimit` başlığı (`limit=..., remaining=..., reset=...`).
      expect(limited.headers['ratelimit']).toBeDefined();
      expect(limited.headers['ratelimit']).toContain('reset=');
    }, 60_000);

    // ── K4: başarı sayılmaz, başarısızlık sayılır ──────────────────────────
    it('K4: 10 BAŞARILI giriş kovayı tüketmez; sonra 5 başarısız → 429', async () => {
      const app = freshApp();
      // ⚠️ Tetiklenen vaka seçimi ([[feedback_test_picked_non_triggering_case]]):
      // yalnız başarısız girişle test edilseydi `skipSuccessfulRequests`
      // sökülüyken de yeşil kalırdı. Önce başarıyı, sonra başarısızlığı ölçer.
      for (let i = 0; i < 10; i += 1) {
        const ok = await login(app, USER_A_EMAIL, PASSWORD);
        expect(ok.status).toBe(200);
      }
      for (let i = 0; i < 5; i += 1) {
        const bad = await login(app, USER_A_EMAIL, WRONG);
        expect(bad.status).toBe(401);
      }
      const limited = await login(app, USER_A_EMAIL, WRONG);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('AUTH_RATE_LIMITED');
    }, 60_000);

    it('K4: kova dolduktan sonra DOĞRU şifre de 429 alır (kova tahmini durdurur)', async () => {
      const app = freshApp();
      for (let i = 0; i < 5; i += 1) {
        expect((await login(app, USER_A_EMAIL, WRONG)).status).toBe(401);
      }
      const correctButLimited = await login(app, USER_A_EMAIL, PASSWORD);
      expect(correctButLimited.status).toBe(429);
    }, 60_000);

    // ── K1: (IP + e-posta) anahtarı ────────────────────────────────────────
    it('K1: A kilitlenince AYNI IP\'den B giriş yapabilir (e-posta izolasyonu)', async () => {
      const app = freshApp();
      for (let i = 0; i < 5; i += 1) {
        expect((await login(app, USER_A_EMAIL, WRONG)).status).toBe(401);
      }
      expect((await login(app, USER_A_EMAIL, WRONG)).status).toBe(429);

      // Asıl iddia: saf per-IP olsaydı B de kilitlenirdi (vardiya-başı senaryo).
      const b = await login(app, USER_B_EMAIL, PASSWORD);
      expect(b.status).toBe(200);
    }, 60_000);

    it('K1: e-posta büyük/küçük harf NORMALİZE edilir (harf oyunuyla bypass yok)', async () => {
      const app = freshApp();
      for (let i = 0; i < 5; i += 1) {
        expect((await login(app, USER_A_EMAIL, WRONG)).status).toBe(401);
      }
      // Aynı e-posta, farklı harf kalıbı → AYNI kovaya düşmeli.
      const upper = await login(app, USER_A_EMAIL.toUpperCase(), WRONG);
      expect(upper.status).toBe(429);
    }, 60_000);

    // ── K5: zayıf bypass guard'ı ───────────────────────────────────────────
    it('K5: NODE_ENV=production iken E2E_BYPASS_LOGIN_LIMIT bypass ETMEZ', async () => {
      const prevNodeEnv = process.env['NODE_ENV'];
      const prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['NODE_ENV'] = 'production';
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';
      try {
        const app = freshApp();
        for (let i = 0; i < 5; i += 1) {
          expect((await login(app, USER_A_EMAIL, WRONG)).status).toBe(401);
        }
        // Guard olmasaydı bypass devreye girer ve bu 401 dönerdi.
        const limited = await login(app, USER_A_EMAIL, WRONG);
        expect(limited.status).toBe(429);
      } finally {
        if (prevNodeEnv === undefined) delete process.env['NODE_ENV'];
        else process.env['NODE_ENV'] = prevNodeEnv;
        if (prevBypass === undefined) delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
        else process.env['E2E_BYPASS_LOGIN_LIMIT'] = prevBypass;
      }
    }, 60_000);

    it('K5: NODE_ENV=test iken bypass ÇALIŞIR (CI E2E akışı korunur)', async () => {
      const prevNodeEnv = process.env['NODE_ENV'];
      const prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['NODE_ENV'] = 'test';
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';
      try {
        const app = freshApp();
        for (let i = 0; i < 8; i += 1) {
          expect((await login(app, USER_A_EMAIL, WRONG)).status).toBe(401);
        }
      } finally {
        if (prevNodeEnv === undefined) delete process.env['NODE_ENV'];
        else process.env['NODE_ENV'] = prevNodeEnv;
        if (prevBypass === undefined) delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
        else process.env['E2E_BYPASS_LOGIN_LIMIT'] = prevBypass;
      }
    }, 60_000);

    // ── Anahtarın saldırgan tarafından şişirilememesi (güvenlik kapısı C-1) ─
    it('C-1: AŞIRI UZUN e-posta kova anahtarını şişiremez (kırpılır)', async () => {
      const app = freshApp();
      // `express.json({limit:'10mb'})` altında gövde megabaytlarca olabilir ve
      // `validateBody` (zod) anahtar ÜRETİLDİKTEN SONRA koşar → kırpma
      // yapılmazsa her istek dev bir MemoryStore anahtarı doğurur (15-30 dk
      // yaşar). Aynı önekten türeyen iki uzun e-posta AYNI kovaya düşmeli:
      // kırpma yoksa ayrı kovalara düşer ve 6. istek 429 YERİNE 401 döner.
      // NOT: bu e-postalar zod'a takılıp 400 döner (401 değil) — ama limiter
      // `validateBody`'den ÖNCE koştuğu için anahtar yine üretilir ve 400
      // `skipSuccessfulRequests` altında SAYILIR. Testin ölçtüğü şey 401/400
      // ayrımı değil, 300+ karakterlik iki FARKLI e-postanın AYNI kovaya
      // düşmesi: kırpma olmasaydı ayrı kovalara düşer, 6. istek 429 yerine
      // 400 dönerdi.
      const prefix = `${'x'.repeat(300)}@example.com`;
      for (let i = 0; i < 5; i += 1) {
        const res = await login(app, `${prefix}${i}`, WRONG);
        expect(res.status).toBe(400);
      }
      const limited = await login(app, `${prefix}999`, WRONG);
      expect(limited.status).toBe(429);
    }, 60_000);

    // ── XFF spoof regresyonu (ADR §14.10, güvenlik kapısı C-5) ─────────────
    it('C-5: uydurulmuş X-Forwarded-For yeni kova anahtarı ÜRETEMEZ', async () => {
      const app = freshApp();
      // Prod zinciri taklit edilir: Nginx `$proxy_add_x_forwarded_for`
      // istemcinin gönderdiği değeri SİLMEZ, sonuna gerçek `$remote_addr`'i
      // EKLER; `trust proxy=1` ile Express sağdan birinci güvenilmeyen adresi
      // alır. Dolayısıyla saldırgan XFF'in soluna ne yazarsa yazsın anahtar
      // SON eleman = gerçek IP olur ve hepsi AYNI kovaya düşer.
      //
      // ⚠️ Bu güvence iki dış koşula bağlıdır, ikisi de kodda DEĞİL:
      //   1. Nginx `$proxy_add_x_forwarded_for` kullanmaya devam etmeli
      //      (`$http_x_forwarded_for`'a çevrilirse üç kova da anlamsızlaşır).
      //   2. API'ye DOĞRUDAN ulaşılamamalı. Prod'da süreç `*:3001` dinliyor
      //      (yalnız loopback değil); koruma ufw'nin yalnız 22/80/443'e izin
      //      vermesinden geliyor. ufw gevşetilirse saldırgan Nginx'i atlayıp
      //      XFF'i tek başına yazabilir ve her istek için taze kova üretir.
      const NGINX_APPENDED_REAL_IP = '203.0.113.9';
      const spoofed = (fake: string) => `${fake}, ${NGINX_APPENDED_REAL_IP}`;
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', spoofed(`10.0.0.${i}`))
          .send({ email: USER_A_EMAIL, password: WRONG });
        expect(res.status).toBe(401);
      }
      const limited = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', spoofed('10.0.0.250'))
        .send({ email: USER_A_EMAIL, password: WRONG });
      expect(limited.status).toBe(429);
    }, 60_000);

    // ── /refresh ve /me: AYRI limiter YOK, taban kova altındalar ───────────
    it('/refresh ve /me ayrı kovaya tabi değil ama taban kovayı tüketir', async () => {
      const app = freshApp();
      // Ölçülen meşru tepe 4/dk; 20 istek tavanın (60) çok altında → akmalı.
      for (let i = 0; i < 20; i += 1) {
        const res = await request(app).post('/auth/refresh').send({});
        expect(res.status).not.toBe(429);
      }
      for (let i = 0; i < 20; i += 1) {
        const res = await request(app).get('/auth/me');
        expect(res.status).not.toBe(429);
      }
      // 40 + 21 = 61 > 60 → taban kova devreye girer.
      for (let i = 0; i < 20; i += 1) {
        await request(app).get('/auth/me');
      }
      const limited = await request(app).get('/auth/me');
      expect(limited.status).toBe(429);
    }, 60_000);
  },
);
