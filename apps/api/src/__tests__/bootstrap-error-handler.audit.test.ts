import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';
import { logger } from '../logger.js';

/**
 * Deep-audit Blok 4 Hat C — app.ts bootstrap (CORS/helmet) + errorHandler
 * canlı hata-tipi → status/body haritası + logger-gate (DB-SEC-01 log tarafı).
 *
 * PII response-body sızıntısı (API-CORE-01) KASITLI KIRMIZI olarak
 * `error-handler-pii.findings.test.ts`'te. Bu dosya yalnız YEŞİL (mevcut
 * doğru davranışları canlı doğrulayan) senaryoları içerir.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const WEB_ORIGIN = 'http://localhost:5173';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `bootstrap-admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `bootstrap-admin-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `bootstrap-waiter-${randomUUID()}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `bootstrap-waiter-${randomUUID().slice(0, 8)}`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  waiterToken: string;
}
const ctx: Partial<TestCtx> = {};
let prevBypass: string | undefined;
let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 254) + 1}`;
}

async function loginAndGetToken(app: Express, email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .set('X-Forwarded-For', uniqueIp())
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'app.ts bootstrap + errorHandler canlı map (Blok 4 Hat C)',
  () => {
    beforeAll(async () => {
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
        webOrigin: WEB_ORIGIN,
      });

      await db
        .insertInto('tenants')
        .values({ id: TENANT_ID, name: 'Bootstrap Test Tenant', slug: `bootstrap-${TENANT_ID.slice(0, 8)}` })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('users')
        .values([
          {
            id: ADMIN_ID,
            tenant_id: TENANT_ID,
            email: ADMIN_EMAIL,
            username: ADMIN_USERNAME,
            password_hash: await hashPassword(ADMIN_PASSWORD),
            role: 'admin',
          },
          {
            id: WAITER_ID,
            tenant_id: TENANT_ID,
            email: WAITER_EMAIL,
            username: WAITER_USERNAME,
            password_hash: await hashPassword(WAITER_PASSWORD),
            role: 'waiter',
          },
        ])
        .execute();

      ctx.adminToken = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
      ctx.waiterToken = await loginAndGetToken(ctx.app, WAITER_EMAIL, WAITER_PASSWORD);
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
      if (prevBypass === undefined) {
        delete process.env['E2E_BYPASS_LOGIN_LIMIT'];
      } else {
        process.env['E2E_BYPASS_LOGIN_LIMIT'] = prevBypass;
      }
    });

    describe('app.ts bootstrap — CORS / helmet', () => {
      it('CORS: izin verilen origin yansıtılır, WILDCARD (*) DEĞİL', async () => {
        const res = await request(ctx.app!)
          .get('/health')
          .set('Origin', WEB_ORIGIN);
        expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
        expect(res.headers['access-control-allow-origin']).not.toBe('*');
        expect(res.headers['access-control-allow-credentials']).toBe('true');
      });

      it('CORS: saldırgan origin GÖNDERSE de Allow-Origin sabit webOrigin kalır (reflection YOK)', async () => {
        // `cors` paketi `origin` STATIK string ile konfigüre edildiğinde header'ı
        // İSTEĞİN Origin'ine göre DEĞİL, sabit configured değere göre set eder —
        // istekteki Origin ASLA yansıtılmaz (dynamic-origin-reflection açığı yok).
        // Gerçek tarayıcıda koruma ASIL burada devreye girer: sayfa
        // `https://evil-attacker.example`'da çalışıyorsa, header'daki sabit
        // `http://localhost:5173` kendi origin'iyle eşleşmediği için tarayıcı
        // yanıtı sayfa JS'ine OKUTMAZ (same-origin-policy enforcement client-side).
        const res = await request(ctx.app!)
          .get('/health')
          .set('Origin', 'https://evil-attacker.example');
        expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
        expect(res.headers['access-control-allow-origin']).not.toBe(
          'https://evil-attacker.example',
        );
      });

      it('helmet: temel güvenlik header\'ları set edilir (x-content-type-options, x-dns-prefetch-control)', async () => {
        const res = await request(ctx.app!).get('/health');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-powered-by']).toBeUndefined();
      });
    });

    describe('errorHandler canlı hata-tipi → status/body haritası', () => {
      it('ZodError (validateBody) → 400 VALIDATION_ERROR (fields ile)', async () => {
        const res = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ email: 'not-an-email', password: 'short' }); // eksik + geçersiz alanlar
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message_key).toBe('error.validation.failed');
        expect(res.body.error.details.fields).toBeTypeOf('object');
      });

      it('validateParams (bad UUID) → 400 VALIDATION_ERROR', async () => {
        const res = await request(ctx.app!)
          .get('/users/not-a-uuid')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('domainError not_found (RepositoryError-free) → 404 USER_NOT_FOUND + doğru message_key', async () => {
        const res = await request(ctx.app!)
          .get(`/users/${randomUUID()}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('USER_NOT_FOUND');
        expect(res.body.error.message_key).toBe('error.user.notFound');
      });

      it('AuthError (login yanlış şifre) → 401 AUTH_INVALID_CREDENTIALS + message_key', async () => {
        const res = await request(ctx.app!)
          .post('/auth/login')
          .set('X-Forwarded-For', uniqueIp())
          .send({ email: ADMIN_EMAIL, password: 'wrong-password-xyz' });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
        expect(res.body.error.message_key).toBe('error.auth.invalidCredentials');
      });

      it('500 sınıfı hata yok iken logger.error TETİKLENMEZ (409/404/400 log-gate < 500)', async () => {
        const spy = vi.spyOn(logger, 'error');
        spy.mockClear();
        // 404 (USER_NOT_FOUND) + 400 (VALIDATION_ERROR) — ikisi de status < 500.
        await request(ctx.app!)
          .get(`/users/${randomUUID()}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        await request(ctx.app!)
          .get('/users/not-a-uuid')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      });

      it('DB-SEC-01 log-gate: duplicate-email 409 (unique) → logger.error TETİKLENMEZ (status<500)', async () => {
        // Aynı email ile 2. kullanıcı oluşturma denemesi — 23505 → RepositoryError
        // 'unique' → toHttpError 409 (errorHandler.ts `if (status >= 500)` kapısının
        // ALTINDA kalır). PII response-body'de sızıyor mu sorusu AYRI (findings.test.ts,
        // KASITLI KIRMIZI); burada yalnız LOG tarafının tetiklenmediği doğrulanır.
        const spy = vi.spyOn(logger, 'error');
        spy.mockClear();
        const dupEmail = `dup-log-gate-${randomUUID()}@example.com`;
        const first = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ email: dupEmail, password: 'validpass1234', role: 'waiter', name: 'Test Kullanıcı' });
        expect(first.status).toBe(201);
        const second = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ email: dupEmail, password: 'validpass1234', role: 'waiter', name: 'Test Kullanıcı 2' });
        expect(second.status).toBe(409);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      });

      it('authorize (waiter → admin-only route) → 403 AUTH_FORBIDDEN (401/500 DEĞİL)', async () => {
        const res = await request(ctx.app!)
          .get('/users')
          .set('Authorization', `Bearer ${ctx.waiterToken!}`);
        expect(res.status).toBe(403);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(500);
        expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      });
    });
  },
);
