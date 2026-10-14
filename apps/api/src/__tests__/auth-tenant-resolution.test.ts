import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { createAppTenantPool } from './helpers/appTenantPool';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * ADR-042 — çoklu-tenant kimlik ve tenant çözümü (v5.1 Faz 1, sunucu tarafı).
 *
 * Kilitlenen davranışlar:
 *   K1 — tenant **işletme kodundan** (`tenants.slug`) çözülür; alan opsiyonel,
 *        yoksa varsayılan tenant (geriye uyumluluk: canlı web + App Store sürümü).
 *   K1 — bilinmeyen slug, "kullanıcı yok" ile **AYNI** 401'i döner (enumeration).
 *   K2 — refresh token kendini tanımlar: `rt1_<32hex tenant>_<secret>`; öneksiz
 *        (cutover öncesi) token'lar varsayılan tenant'ta çalışmaya devam eder.
 *   K2 — öneki kurcalanmış token 401 verir ama **reuse SAYILMAZ** (aile iptal
 *        edilmez) — bugünkü "tanınmayan token" davranışıyla aynı.
 *   rate-limit — sıkı kova anahtarına slug girer; girmezse A işletmesindeki
 *        denemeler B'deki aynı e-postalı kullanıcıyı kilitler (çapraz-tenant DoS).
 *
 * ⚠️ Testler **app_tenant** rolüyle koşar (prod-sadık). Süperuser havuzla koşsalardı
 * RLS yüklemleri atlanır ve sahte-yeşil verirlerdi.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `tr-a-${TENANT_A.slice(0, 8)}`;
const SLUG_B = `tr-b-${TENANT_B.slice(0, 8)}`;

/** 🔑 AYNI e-posta iki tenant'ta — ADR-042 S2 kararının test ettiği asıl şey. */
const SHARED_EMAIL = `shared-${randomUUID().slice(0, 8)}@example.com`;
const PASSWORD_A = 'tenantApass1234';
const PASSWORD_B = 'tenantBpass5678';

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  appPool: Pool;
  appDb: Kysely<DB>;
}
const ctx: Partial<TestCtx> = {};

/** Her test kendi app'ini kurar — paylaşılan MemoryStore kovaları birikirdi. */
function freshApp(): Express {
  return buildApp({
    pool: ctx.appPool!,
    db: ctx.appDb!,
    accessSecret: ACCESS_SECRET,
    agentSecret: 'test-agent-secret-min-32-chars-please-long',
    // Varsayılan (legacy) tenant = A. Slug göndermeyen istemci buraya düşer.
    tenantId: TENANT_A,
    webOrigin: 'http://localhost:5173',
  });
}

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

function extractRefreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const cookie = list.find((c) => c.startsWith('refresh_token='));
  if (cookie === undefined) throw new Error('refresh cookie yok');
  return cookie.split(';')[0]!.split('=').slice(1).join('=');
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-042 tenant çözümü',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      ctx.pool = pool;
      ctx.db = createKysely(pool);
      const appPool = createAppTenantPool(DB_URL ?? '');
      ctx.appPool = appPool;
      ctx.appDb = createKysely(appPool);

      await ctx.db
        .insertInto('tenants')
        .values([
          { id: TENANT_A, name: 'Tenant A', slug: SLUG_A },
          { id: TENANT_B, name: 'Tenant B', slug: SLUG_B },
        ])
        .execute();
      await ctx.db
        .insertInto('tenant_settings')
        .values([{ tenant_id: TENANT_A }, { tenant_id: TENANT_B }])
        .execute();

      await ctx.db
        .insertInto('users')
        .values([
          {
            id: randomUUID(),
            tenant_id: TENANT_A,
            email: SHARED_EMAIL,
            username: `ua-${randomUUID().slice(0, 8)}`,
            password_hash: await hashPassword(PASSWORD_A),
            role: 'admin',
          },
          {
            id: randomUUID(),
            tenant_id: TENANT_B,
            email: SHARED_EMAIL,
            username: `ub-${randomUUID().slice(0, 8)}`,
            password_hash: await hashPassword(PASSWORD_B),
            role: 'admin',
          },
        ])
        .execute();
    });

    afterAll(async () => {
      // ⚠️ FK sırası bağlayıcı (23503): `tenants` doğrudan silinemez —
      // `tenant_settings`/`users`/`refresh_tokens` ona referans veriyor ve
      // CASCADE yok. Önceki hâli teardown'da patlıyordu: 10 test geçiyor ama
      // DOSYA fail sayılıyordu (tek başına koştururken grep'le kaçırılmıştı).
      const ids = [TENANT_A, TENANT_B];
      await ctx.db?.deleteFrom('refresh_tokens').where('tenant_id', 'in', ids).execute();
      await ctx.db?.deleteFrom('users').where('tenant_id', 'in', ids).execute();
      await ctx.db?.deleteFrom('tenant_settings').where('tenant_id', 'in', ids).execute();
      await ctx.db?.deleteFrom('tenants').where('id', 'in', ids).execute();
      await ctx.pool?.end();
      await ctx.appPool?.end();
    });

    it('slug YOKSA varsayılan tenant — canlı istemciler kırılmaz', async () => {
      const res = await request(freshApp())
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_A });
      expect(res.status).toBe(200);
    });

    it('slug VARSA o tenant çözülür — aynı e-posta, B şifresiyle B girişi', async () => {
      const res = await request(freshApp())
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_B, tenantSlug: SLUG_B });
      expect(res.status).toBe(200);
    });

    it('🔑 tenant GERÇEKTEN kapsam seçiyor: A slug + B şifresi = 401', async () => {
      // Bu iddia olmadan yukarıdaki iki test, tenant hiç çözülmese de yeşil kalırdı.
      const res = await request(freshApp())
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_B, tenantSlug: SLUG_A });
      expect(res.status).toBe(401);
    });

    it('bilinmeyen slug, yanlış şifreyle AYNI 401 kodunu verir (enumeration)', async () => {
      const unknown = await request(freshApp())
        .post('/auth/login')
        .send({
          email: SHARED_EMAIL,
          password: PASSWORD_A,
          tenantSlug: `tr-yok-${randomUUID().slice(0, 8)}`,
        });
      const wrongPw = await request(freshApp())
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: 'yanlissifre123', tenantSlug: SLUG_A });

      expect(unknown.status).toBe(401);
      expect(wrongPw.status).toBe(401);
      // Ayırt edici bir kod ÜRETİLMEMELİ — "işletme yok" bilgisi sızmamalı.
      expect(unknown.body.error.code).toBe(wrongPw.body.error.code);
    });

    it('🔴 string OLMAYAN tenantSlug 500 DEĞİL — kimlik öncesi çökme yok', async () => {
      // Güvenlik kapısı BLOCKER'ı: rate-limit `keyGenerator` HAM GÖVDEYİ okur ve
      // zod `validateBody`'den ÖNCE koşar. `as string` cast'i varken
      // {"tenantSlug": 123} → `raw.trim is not a function` → errorHandler → 500
      // + Sentry. Taban kova 60/dk × dağıtık IP = Sentry kotası yakma.
      for (const bad of [123, true, {}, []]) {
        const res = await request(freshApp())
          .post('/auth/login')
          .send({ email: SHARED_EMAIL, password: PASSWORD_A, tenantSlug: bad });
        expect(res.status, `tenantSlug=${JSON.stringify(bad)} → ${res.status}`).not.toBe(500);
        // Sözleşme: geçersiz tip zod'a düşer → 400.
        expect(res.status).toBe(400);
      }
    });

    it('tireyle biten slug reddedilir (ayırt edilemez 401 tuzağı)', async () => {
      // `dilan-pide-` ile `dilan-pide` operatör gözüyle aynı görünür; biçim
      // kilidi olmasa yanlış olanı yazan kullanıcı sebebi bulunamayan 401 alırdı.
      const res = await request(freshApp())
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_A, tenantSlug: `${SLUG_A}-` });
      expect(res.status).toBe(400);
    });

    it('refresh token kendini tanımlar: rt1_<tenant hex>_…', async () => {
      const res = await request(freshApp())
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_B, tenantSlug: SLUG_B });
      const token = extractRefreshCookie(res);
      const m = /^rt1_([0-9a-f]{32})_/.exec(token);
      expect(m, `önek yok: ${token.slice(0, 12)}…`).not.toBeNull();
      // Önek GERÇEKTEN B'nin tenant'ı olmalı — A olsaydı test yine geçerdi ama
      // rotasyon yanlış tenant'ta arama yapardı.
      expect(m![1]).toBe(TENANT_B.replace(/-/g, ''));
    });

    it('önekli token ile rotasyon çalışır', async () => {
      const app = freshApp();
      const login = await request(app)
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_B, tenantSlug: SLUG_B });
      const token = extractRefreshCookie(login);

      const res = await request(app)
        .post('/auth/refresh')
        // CSRF-lite (ADR-002): cookie tek başına yetmez, custom header şart.
        .set('X-Refresh-Request', '1')
        .set('Cookie', `refresh_token=${token}`);
      expect(res.status).toBe(200);
    });

    it('ÖNEKSİZ (cutover öncesi) token varsayılan tenant\'ta çalışmaya devam eder', async () => {
      // Geriye uyumluluk ZORUNLU: bu yol kapanırsa cutover anında tüm açık
      // oturumlar düşerdi (token ömrü azami 37 gün).
      const legacyPlain = randomBytes(32).toString('base64url'); // 43 karakter, öneksiz
      const userId = (
        await ctx.db!
          .selectFrom('users')
          .select('id')
          .where('tenant_id', '=', TENANT_A)
          .where('email', '=', SHARED_EMAIL)
          .executeTakeFirstOrThrow()
      ).id;
      await ctx.db!
        .insertInto('refresh_tokens')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_A,
          user_id: userId,
          token_hash: sha256(legacyPlain),
          family_id: randomUUID(),
          expires_at: new Date(Date.now() + 86_400_000),
        })
        .execute();

      const res = await request(freshApp())
        .post('/auth/refresh')
        // CSRF-lite (ADR-002): cookie tek başına yetmez, custom header şart.
        .set('X-Refresh-Request', '1')
        .set('Cookie', `refresh_token=${legacyPlain}`);
      expect(res.status).toBe(200);
    });

    it('öneki kurcalanmış token 401 verir ve aileyi İPTAL ETMEZ (reuse değil)', async () => {
      const app = freshApp();
      const login = await request(app)
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_B, tenantSlug: SLUG_B });
      const token = extractRefreshCookie(login);
      // Öneki A'ya çevir: hash artık A'da aranır ve bulunamaz.
      const tampered = token.replace(
        /^rt1_[0-9a-f]{32}_/,
        `rt1_${TENANT_A.replace(/-/g, '')}_`,
      );

      const res = await request(app)
        .post('/auth/refresh')
        // CSRF-lite (ADR-002): cookie tek başına yetmez, custom header şart.
        .set('X-Refresh-Request', '1')
        .set('Cookie', `refresh_token=${tampered}`);
      expect(res.status).toBe(401);

      // Aile iptal EDİLMEMELİ — tanınmayan token bugün de reuse saymaz.
      const row = await ctx.db!
        .selectFrom('refresh_tokens')
        .select('revoked_reason')
        .where('tenant_id', '=', TENANT_B)
        .where('token_hash', '=', sha256(token))
        .executeTakeFirstOrThrow();
      expect(row.revoked_reason).toBeNull();
    });

    it('logout önekli token\'ı DB\'de gerçekten iptal eder', async () => {
      // S137 dersi: 200 yanıtı kanıt değildir, DB'de sayılır.
      const app = freshApp();
      const login = await request(app)
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_B, tenantSlug: SLUG_B });
      const token = extractRefreshCookie(login);

      await request(app)
        .post('/auth/logout')
        .set('Cookie', `refresh_token=${token}`)
        .expect(200);

      const row = await ctx.db!
        .selectFrom('refresh_tokens')
        .select('revoked_reason')
        .where('tenant_id', '=', TENANT_B)
        .where('token_hash', '=', sha256(token))
        .executeTakeFirstOrThrow();
      expect(row.revoked_reason).toBe('logout');
    });

    it('🔴 çapraz-tenant DoS yok: A\'daki kilit B\'yi kilitlemez', async () => {
      const app = freshApp();
      // Sıkı kova 5/15dk. A'da 5 kez yanlış şifre → A kilitlenir.
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/auth/login')
          .send({ email: SHARED_EMAIL, password: 'yanlis0000', tenantSlug: SLUG_A });
      }
      const aLocked = await request(app)
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_A, tenantSlug: SLUG_A });
      expect(aLocked.status, 'A kilitlenmeliydi (kova tetiklenmedi)').toBe(429);

      // AYNI e-posta, B işletmesi → kilitlenmemeli.
      const bOk = await request(app)
        .post('/auth/login')
        .send({ email: SHARED_EMAIL, password: PASSWORD_B, tenantSlug: SLUG_B });
      expect(bOk.status).toBe(200);
    });
  },
);
