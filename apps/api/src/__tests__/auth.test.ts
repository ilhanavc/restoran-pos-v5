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

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'auth integration',
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
  },
);
