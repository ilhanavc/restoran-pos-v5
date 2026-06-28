import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  createPool,
  createKysely,
  type DB,
} from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const USER_ID = randomUUID();
const USER_EMAIL = `test-${randomUUID()}@example.com`;
const USER_PASSWORD = 'testpass1234';
const USER_USERNAME = `testuser-${randomUUID().slice(0, 8)}`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: ReturnType<typeof buildApp>;
}

const ctx: Partial<TestCtx> = {};
let prevBypass: string | undefined;

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'auth integration',
  () => {
    beforeAll(async () => {
      // Suite tüm testlerde tek `app` (beforeAll) paylaşır; mobil + web akış
      // testleri 10 login yapar → `loginLimiter` limit:5'i aşardı. Bu suite auth
      // AKIŞINI test eder, limiter'ı değil (429 testi yok) → bypass aç; afterAll
      // geri alır (diğer suite'lere sızmasın).
      prevBypass = process.env['E2E_BYPASS_LOGIN_LIMIT'];
      process.env['E2E_BYPASS_LOGIN_LIMIT'] = '1';
      const pool = createPool({ connectionString: DB_URL ?? '' });
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

      // Tenant + user seed.
      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant',
          slug: `test-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('users')
        .values({
          id: USER_ID,
          tenant_id: TENANT_ID,
          email: USER_EMAIL,
          username: USER_USERNAME,
          password_hash: await hashPassword(USER_PASSWORD),
          role: 'admin',
        })
        .execute();
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('user_id', '=', USER_ID)
          .execute();
        await ctx.db
          .deleteFrom('users')
          .where('id', '=', USER_ID)
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', '=', TENANT_ID)
          .execute();
        await ctx.db.destroy(); // PostgresDialect.destroy() closes the pool internally
      }
      if (prevBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = prevBypass;
      }
    });

    it('login → me → refresh → me → logout → me(401)', async () => {
      const app = ctx.app!;

      // 1) Login
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      expect(loginRes.status).toBe(200);
      expect(typeof loginRes.body.accessToken).toBe('string');
      expect(loginRes.body.expiresIn).toBe(1800);
      expect(loginRes.body.user.email).toBe(USER_EMAIL);

      const setCookie = loginRes.headers['set-cookie'];
      const cookies = Array.isArray(setCookie)
        ? setCookie
        : setCookie !== undefined
          ? [setCookie]
          : [];
      const refreshCookie = cookies.find((c: string) =>
        c.startsWith('refresh_token='),
      );
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('SameSite=Strict');
      expect(refreshCookie).toContain('Path=/auth/refresh');

      const access1 = loginRes.body.accessToken as string;

      // 2) /me with access token
      const meRes = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${access1}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user.email).toBe(USER_EMAIL);

      // 3) Refresh — CSRF header eksikse 403
      const noCsrf = await request(app)
        .post('/auth/refresh')
        .set('Cookie', refreshCookie!);
      expect(noCsrf.status).toBe(403);

      // 4) Refresh — başarılı
      const refreshRes = await request(app)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('Cookie', refreshCookie!);
      expect(refreshRes.status).toBe(200);
      expect(typeof refreshRes.body.accessToken).toBe('string');
      expect(refreshRes.body.accessToken).not.toBe(access1);

      const newCookieHeader = refreshRes.headers['set-cookie'];
      const newCookies = Array.isArray(newCookieHeader)
        ? newCookieHeader
        : newCookieHeader !== undefined
          ? [newCookieHeader]
          : [];
      const newRefresh = newCookies.find((c: string) =>
        c.startsWith('refresh_token='),
      );
      expect(newRefresh).toBeDefined();

      // 5) /me with new access token
      const meRes2 = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${refreshRes.body.accessToken as string}`);
      expect(meRes2.status).toBe(200);

      // 6) Eski refresh token tekrar kullanılırsa REUSE → 401 ve family revoke.
      const reuseRes = await request(app)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('Cookie', refreshCookie!);
      expect(reuseRes.status).toBe(401);

      // Family revoke sonrası yeni cookie de invalid olmalı.
      const afterReuse = await request(app)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('Cookie', newRefresh!);
      expect(afterReuse.status).toBe(401);

      // 7) Logout
      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Cookie', newRefresh!);
      expect(logoutRes.status).toBe(200);
    });

    it('wrong password → 401 AUTH_INVALID_CREDENTIALS', async () => {
      const res = await request(ctx.app!)
        .post('/auth/login')
        .send({ email: USER_EMAIL, password: 'wrong-password-9999' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('unknown email → 401 AUTH_INVALID_CREDENTIALS (no user enumeration)', async () => {
      const res = await request(ctx.app!)
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever12345' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('refresh without cookie → 401', async () => {
      const res = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1');
      expect(res.status).toBe(401);
    });

    it('me without token → 401', async () => {
      const res = await request(ctx.app!).get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('me with garbage token → 401', async () => {
      const res = await request(ctx.app!)
        .get('/auth/me')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });

    // ── Mobil body-refresh (ADR-002 §2 amendment) ──────────────────────────

    it('mobil login (X-Client: mobile) → body refreshToken + accessToken + expiresIn', async () => {
      const res = await request(ctx.app!)
        .post('/auth/login')
        .set('X-Client', 'mobile')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.expiresIn).toBe(1800);
      expect(typeof res.body.refreshToken).toBe('string');
      expect((res.body.refreshToken as string).length).toBeGreaterThan(0);
      // Mobil de cookie alır (zararsız) — kritik olan body'de token'ın olması.
    });

    it('web login (X-Client yok) → body refreshToken YOK, Set-Cookie VAR', async () => {
      const res = await request(ctx.app!)
        .post('/auth/login')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.refreshToken).toBeUndefined();
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      expect(
        cookies.some((c: string) => c?.startsWith('refresh_token=')),
      ).toBe(true);
    });

    it('mobil refresh (body token, cookie YOK) → 200 + YENİ refreshToken (rotated)', async () => {
      // Önce mobil login ile body refresh al.
      const login = await request(ctx.app!)
        .post('/auth/login')
        .set('X-Client', 'mobile')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      const refresh1 = login.body.refreshToken as string;
      const access1 = login.body.accessToken as string;

      const res = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('X-Client', 'mobile')
        .send({ refreshToken: refresh1 });
      expect(res.status).toBe(200);
      expect(typeof res.body.refreshToken).toBe('string');
      expect(res.body.refreshToken).not.toBe(refresh1); // rotated
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.accessToken).not.toBe(access1);
      // Mobil cevabında Set-Cookie üzerinden refresh token DÖNMEZ.
      const setCookie = res.headers['set-cookie'];
      const cookies = Array.isArray(setCookie)
        ? setCookie
        : setCookie !== undefined
          ? [setCookie]
          : [];
      const cookieRefresh = cookies.find((c: string) =>
        c.startsWith('refresh_token='),
      );
      // Cookie set edilmemeli (mobil kullanmaz) → ya yok ya boş değer.
      expect(cookieRefresh).toBeUndefined();
    });

    it('web refresh (cookie) → 200, body refreshToken YOK (mevcut davranış)', async () => {
      const login = await request(ctx.app!)
        .post('/auth/login')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      const setCookie = login.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      const refreshCookie = cookies.find((c: string) =>
        c?.startsWith('refresh_token='),
      );

      const res = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('Cookie', refreshCookie!);
      expect(res.status).toBe(200);
      expect(res.body.refreshToken).toBeUndefined();
    });

    // ── GÜVENLİK GATE: token-source (XSS HttpOnly-bypass önlemi) ────────────

    it('GÜVENLİK: cookie + X-Client:mobile → body refreshToken DÖNMEZ (HttpOnly bypass engelli)', async () => {
      const login = await request(ctx.app!)
        .post('/auth/login')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      const setCookie = login.headers['set-cookie'];
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      const refreshCookie = cookies.find((c: string) =>
        c?.startsWith('refresh_token='),
      );

      // Saldırgan senaryosu: HttpOnly cookie otomatik gider + X-Client:mobile
      // header eklenir. Token cookie-kaynaklı olduğundan body'de DÖNMEMELİ.
      const res = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('X-Client', 'mobile')
        .set('Cookie', refreshCookie!);
      expect(res.status).toBe(200);
      expect(res.body.refreshToken).toBeUndefined();
      // Web yolu olduğundan yeni cookie set edilir (rotation devam eder).
      const newSetCookie = res.headers['set-cookie'];
      const newCookies = Array.isArray(newSetCookie)
        ? newSetCookie
        : [newSetCookie];
      expect(
        newCookies.some((c: string) => c?.startsWith('refresh_token=')),
      ).toBe(true);
    });

    it('GÜVENLİK: mobil refresh token reuse → family revoke → 401', async () => {
      const login = await request(ctx.app!)
        .post('/auth/login')
        .set('X-Client', 'mobile')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      const refresh1 = login.body.refreshToken as string;

      // 1. kullanım: başarılı, rotated token döner.
      const first = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('X-Client', 'mobile')
        .send({ refreshToken: refresh1 });
      expect(first.status).toBe(200);
      const refresh2 = first.body.refreshToken as string;

      // 2. kullanım (aynı eski token): REUSE → 401.
      const reuse = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('X-Client', 'mobile')
        .send({ refreshToken: refresh1 });
      expect(reuse.status).toBe(401);

      // Family revoke sonrası rotated token de invalid olmalı.
      const afterReuse = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .set('X-Client', 'mobile')
        .send({ refreshToken: refresh2 });
      expect(afterReuse.status).toBe(401);
    });

    it('mobil refresh X-Refresh-Request header yok → 403', async () => {
      const login = await request(ctx.app!)
        .post('/auth/login')
        .set('X-Client', 'mobile')
        .send({ email: USER_EMAIL, password: USER_PASSWORD });
      const refresh1 = login.body.refreshToken as string;

      const res = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Client', 'mobile')
        .send({ refreshToken: refresh1 });
      expect(res.status).toBe(403);
    });

    it('refresh ne cookie ne body → 401', async () => {
      const res = await request(ctx.app!)
        .post('/auth/refresh')
        .set('X-Refresh-Request', '1')
        .send({});
      expect(res.status).toBe(401);
    });
  },
);
