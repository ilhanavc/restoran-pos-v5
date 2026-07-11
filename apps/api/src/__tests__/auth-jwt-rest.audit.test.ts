import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Deep-audit Blok 4 Hat C — REST katmanı JWT reddi + login rate-limit.
 *
 * `auth.test.ts` (DEĞİŞTİRİLMEDİ) login/refresh/logout akışını kapsıyor ve
 * `E2E_BYPASS_LOGIN_LIMIT=1` ile limiter'ı bilerek atlıyor. Bu dosya ADDITIVE:
 * (a) `/auth/me` üzerinde klasik JWT saldırı vektörleri (tampered/alg=none/
 *     yanlış-secret/expired) → 401 (403/500 DEĞİL) kanıtı,
 * (b) gerçek `loginLimiter`'ı (bypass YOK) canlı tetikleyip 429 + reset-penceresi
 *     header'ını doğrular.
 *
 * `buildApp()` her test dosyasında YENİ bir Express app + YENİ bir `loginLimiter`
 * instance'ı üretir (authRouter içinde module-level değil, closure-scoped) —
 * bu nedenle rate-limit sayaçları diğer test dosyalarından İZOLE.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const WRONG_SECRET = 'wrong-secret-min-32-chars-attacker-does-not-know';
const TOKEN_AUDIENCE = 'restoran-pos-v5';
const TOKEN_ISSUER = 'restoran-pos-v5-api';

const TENANT_ID = randomUUID();
const USER_ID = randomUUID();
const USER_EMAIL = `jwt-rest-${randomUUID()}@example.com`;
const USER_PASSWORD = 'testpass1234';
const USER_USERNAME = `jwtrest-${randomUUID().slice(0, 8)}`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
}
const ctx: Partial<TestCtx> = {};

/** RFC 5737 TEST-NET-3 — her çağrı benzersiz IP, rate-limit bucket çakışmaz. */
function uniqueIp(): string {
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  return `203.0.113.${(a + b) % 254}`;
}

/** Rate-limit testi için SABİT, dosya-içi çakışmasız ayrı subnet. */
let rateLimitIpCounter = 0;
function rateLimitIp(): string {
  rateLimitIpCounter += 1;
  return `198.51.100.${((rateLimitIpCounter - 1) % 254) + 1}`;
}

function signToken(opts: { secret: string; expiresInSec?: number }): string {
  return jwt.sign(
    {
      sub: USER_ID,
      tenant_id: TENANT_ID,
      role: 'admin',
      jti: randomUUID(),
      type: 'access',
    },
    opts.secret,
    {
      algorithm: 'HS256',
      expiresIn: opts.expiresInSec ?? 900,
      audience: TOKEN_AUDIENCE,
      issuer: TOKEN_ISSUER,
    },
  );
}

function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function craftAlgNoneToken(): string {
  const header = base64url({ alg: 'none', typ: 'JWT' });
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = base64url({
    sub: USER_ID,
    tenant_id: TENANT_ID,
    role: 'admin',
    jti: randomUUID(),
    type: 'access',
    aud: TOKEN_AUDIENCE,
    iss: TOKEN_ISSUER,
    iat: nowSec,
    exp: nowSec + 900,
  });
  return `${header}.${payload}.`;
}

function tamperSignature(token: string): string {
  const parts = token.split('.');
  const sig = parts[2] ?? '';
  const flippedChar = sig.startsWith('A') ? 'B' : 'A';
  const flipped = sig.length > 0 ? flippedChar + sig.slice(1) : 'AAAA';
  return `${parts[0]}.${parts[1]}.${flipped}`;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'REST /auth/me — JWT sahtecilik reddi (Blok 4 Hat C)',
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
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({ id: TENANT_ID, name: 'JWT REST Test Tenant', slug: `jwt-rest-${TENANT_ID.slice(0, 8)}` })
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
        await ctx.db.deleteFrom('refresh_tokens').where('user_id', '=', USER_ID).execute();
        await ctx.db.deleteFrom('users').where('id', '=', USER_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    it('API-CORE-AUDIT: imza kurcalanmış (tampered) token → 401 (403/500 DEĞİL)', async () => {
      const valid = signToken({ secret: ACCESS_SECRET });
      const tampered = tamperSignature(valid);
      const res = await request(ctx.app!)
        .get('/auth/me')
        .set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(500);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('API-CORE-AUDIT: süresi dolmuş (expired) token → 401', async () => {
      const expired = signToken({ secret: ACCESS_SECRET, expiresInSec: -10 });
      const res = await request(ctx.app!)
        .get('/auth/me')
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('API-CORE-AUDIT: alg=none (imzasız, elle inşa edilmiş) token → 401', async () => {
      const forged = craftAlgNoneToken();
      const res = await request(ctx.app!)
        .get('/auth/me')
        .set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('API-CORE-AUDIT: yanlış secret ile imzalanmış token → 401', async () => {
      const wrongSigned = signToken({ secret: WRONG_SECRET });
      const res = await request(ctx.app!)
        .get('/auth/me')
        .set('Authorization', `Bearer ${wrongSigned}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('kontrol: geçerli token → 200 (reddedilenlerin gerçekten reddedildiğini kanıtlar)', async () => {
      const valid = signToken({ secret: ACCESS_SECRET });
      const res = await request(ctx.app!)
        .get('/auth/me')
        .set('Authorization', `Bearer ${valid}`)
        .set('X-Forwarded-For', uniqueIp());
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(USER_EMAIL);
    });
  },
);

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'POST /auth/login rate-limit — bypass YOK, gerçek limiter (Blok 4 Hat C)',
  () => {
    beforeAll(() => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      // Bilerek E2E_BYPASS_LOGIN_LIMIT SET EDİLMEZ — gerçek 5/15dk limiter'ı
      // canlı tetiklemek bu suite'in amacı.
      ctx.app = buildApp({
        pool,
        db,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });
    });

    afterAll(async () => {
      if (ctx.db !== undefined) await ctx.db.destroy();
    });

    it('API-CORE-AUDIT: 5 başarısız + 6. deneme → 429 AUTH_RATE_LIMITED + reset-penceresi header', async () => {
      const ip = rateLimitIp();
      for (let i = 0; i < 5; i++) {
        const res = await request(ctx.app!)
          .post('/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: 'nobody-rl@example.com', password: 'wrongpass1234' });
        expect(res.status).not.toBe(429);
      }
      const blocked = await request(ctx.app!)
        .post('/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'nobody-rl@example.com', password: 'wrongpass1234' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('AUTH_RATE_LIMITED');
      expect(blocked.body.error.message_key).toBe('error.auth.rateLimited');

      // "Reset penceresi" kanıtı: draft-7 combined RateLimit header
      // (`limit=5, remaining=0, reset=<saniye>`). Gerçek 15dk beklemek
      // pratik değil — header'daki reset-saniye sayısının 0 < x <= 900
      // aralığında olduğunu doğrulamak, limiter'ın gerçek bir zaman
      // penceresi taşıdığının canlı kanıtıdır.
      const rateLimitHeader = blocked.headers['ratelimit'];
      expect(rateLimitHeader).toBeDefined();
      const resetMatch = /reset=(\d+)/.exec(rateLimitHeader ?? '');
      expect(resetMatch).not.toBeNull();
      const resetSeconds = Number(resetMatch?.[1] ?? NaN);
      expect(resetSeconds).toBeGreaterThan(0);
      expect(resetSeconds).toBeLessThanOrEqual(15 * 60);
    });

    it('API-CORE-AUDIT: farklı IP → limiter etkilenmez (bucket IP-bazlı)', async () => {
      const res = await request(ctx.app!)
        .post('/auth/login')
        .set('X-Forwarded-For', rateLimitIp())
        .send({ email: 'nobody-rl-2@example.com', password: 'wrongpass1234' });
      expect(res.status).not.toBe(429);
    });
  },
);
