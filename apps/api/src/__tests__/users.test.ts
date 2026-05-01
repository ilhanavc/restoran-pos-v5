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
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * Görev 17 — Users CRUD integration test (ADR-002 §10 lifecycle).
 *
 * Test matrisi:
 *  • POST/GET/GET-by-id/PATCH/DELETE × 4 rol = baseline ABAC
 *  • PATCH /users/:id/password — kendi şifresi (her rol) + admin reset
 *  • Lifecycle: son admin guard, self-delete guard, soft delete sonrası login,
 *    soft delete sonrası refresh, atomicity (paralel DELETE), cross-tenant izolasyon
 *
 * Fixture pattern: orders.test.ts ile aynı (tenant + tenant_settings + 4 rol seed).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TENANT_B_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;

const ADMIN2_ID = randomUUID();
const ADMIN2_EMAIL = `admin2-${randomUUID()}@example.com`;
const ADMIN2_PASSWORD = 'admin2pass1234';
const ADMIN2_USERNAME = `admin2-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-${randomUUID()}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-${randomUUID().slice(0, 8)}`;

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-${randomUUID()}@example.com`;
const KITCHEN_PASSWORD = 'kitchenpass1234';
const KITCHEN_USERNAME = `kitchen-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-${randomUUID()}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-${randomUUID().slice(0, 8)}`;

// Tenant B isolation kullanıcısı
const TENANT_B_USER_ID = randomUUID();
const TENANT_B_USER_EMAIL = `t-b-${randomUUID()}@example.com`;
const TENANT_B_USER_USERNAME = `t-b-${randomUUID().slice(0, 8)}`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  kitchenToken: string;
  waiterToken: string;
}

const ctx: Partial<TestCtx> = {};

/**
 * Test helper. `trust proxy` aktif olduğu için her çağrıya unique X-Forwarded-For
 * yollarız → rate-limit IP başına bucketli; testler arası 5 req/15dk capine
 * takılmaz. Production'da CDN/Load balancer IP'yi set eder, test'te biz manuel.
 */
function uniqueIp(): string {
  // RFC 5737 TEST-NET-3 (203.0.113.0/24) — documentation range, prod trafiğiyle
  // asla çakışmaz. Her test fixture'ı kendi 'IP'sinden istek atar → rate-limit
  // bucket'ı ayrı.
  const a = Math.floor(Math.random() * 254) + 1;
  const b = Math.floor(Math.random() * 254) + 1;
  return `203.0.113.${(a + b) % 254}`;
}

async function loginAndGetToken(
  app: Express,
  email: string,
  password: string,
): Promise<string> {
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
  'Users CRUD integration (ADR-002 §10)',
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

      // Tenant A
      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant Users A',
          slug: `test-users-a-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      // Tenant B (cross-tenant isolation testi için)
      await db
        .insertInto('tenants')
        .values({
          id: TENANT_B_ID,
          name: 'Test Tenant Users B',
          slug: `test-users-b-${TENANT_B_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_B_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const [
        adminHash,
        admin2Hash,
        cashierHash,
        kitchenHash,
        waiterHash,
        tenantBHash,
      ] = await Promise.all([
        hashPassword(ADMIN_PASSWORD),
        hashPassword(ADMIN2_PASSWORD),
        hashPassword(CASHIER_PASSWORD),
        hashPassword(KITCHEN_PASSWORD),
        hashPassword(WAITER_PASSWORD),
        hashPassword('tenant-b-pass-1234'),
      ]);

      await db
        .insertInto('users')
        .values([
          {
            id: ADMIN_ID,
            tenant_id: TENANT_ID,
            email: ADMIN_EMAIL,
            username: ADMIN_USERNAME,
            password_hash: adminHash,
            role: 'admin',
          },
          {
            id: ADMIN2_ID,
            tenant_id: TENANT_ID,
            email: ADMIN2_EMAIL,
            username: ADMIN2_USERNAME,
            password_hash: admin2Hash,
            role: 'admin',
          },
          {
            id: CASHIER_ID,
            tenant_id: TENANT_ID,
            email: CASHIER_EMAIL,
            username: CASHIER_USERNAME,
            password_hash: cashierHash,
            role: 'cashier',
          },
          {
            id: KITCHEN_ID,
            tenant_id: TENANT_ID,
            email: KITCHEN_EMAIL,
            username: KITCHEN_USERNAME,
            password_hash: kitchenHash,
            role: 'kitchen',
          },
          {
            id: WAITER_ID,
            tenant_id: TENANT_ID,
            email: WAITER_EMAIL,
            username: WAITER_USERNAME,
            password_hash: waiterHash,
            role: 'waiter',
          },
          {
            id: TENANT_B_USER_ID,
            tenant_id: TENANT_B_ID,
            email: TENANT_B_USER_EMAIL,
            username: TENANT_B_USER_USERNAME,
            password_hash: tenantBHash,
            role: 'cashier',
          },
        ])
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
      ctx.cashierToken = await loginAndGetToken(
        ctx.app,
        CASHIER_EMAIL,
        CASHIER_PASSWORD,
      );
      ctx.kitchenToken = await loginAndGetToken(
        ctx.app,
        KITCHEN_EMAIL,
        KITCHEN_PASSWORD,
      );
      ctx.waiterToken = await loginAndGetToken(
        ctx.app,
        WAITER_EMAIL,
        WAITER_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('audit_logs')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('refresh_tokens')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('users')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', 'in', [TENANT_ID, TENANT_B_ID])
          .execute();
        await ctx.db.destroy();
      }
    });

    // ────────────────────────────────────────────────────────────────────
    // POST /users — admin only
    // ────────────────────────────────────────────────────────────────────
    describe('POST /users', () => {
      it('admin → 201 + UserPublic (password_hash leak yok)', async () => {
        const res = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            email: `new-${randomUUID()}@example.com`,
            password: 'newuserpass1234',
            role: 'cashier',
            name: 'Yeni Kasiyer',
          });
        expect(res.status).toBe(201);
        expect(res.body.data.user.role).toBe('cashier');
        expect(res.body.data.user).not.toHaveProperty('password_hash');
        expect(res.body.data.user).not.toHaveProperty('passwordHash');
        // cleanup
        await ctx.db!
          .deleteFrom('users')
          .where('id', '=', res.body.data.user.id)
          .execute();
      });

      it('cashier → 403', async () => {
        const res = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.cashierToken!}`)
          .send({
            email: `x-${randomUUID()}@example.com`,
            password: 'pass1234567',
            role: 'cashier',
            name: 'X',
          });
        expect(res.status).toBe(403);
      });

      it('waiter → 403', async () => {
        const res = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.waiterToken!}`)
          .send({
            email: `x-${randomUUID()}@example.com`,
            password: 'pass1234567',
            role: 'cashier',
            name: 'X',
          });
        expect(res.status).toBe(403);
      });

      it('kitchen → 403', async () => {
        const res = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
          .send({
            email: `x-${randomUUID()}@example.com`,
            password: 'pass1234567',
            role: 'cashier',
            name: 'X',
          });
        expect(res.status).toBe(403);
      });

      it('admin + invalid email → 400 VALIDATION_ERROR', async () => {
        const res = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            email: 'not-an-email',
            password: 'pass1234567',
            role: 'cashier',
            name: 'X',
          });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('admin + weak password (<10) → 400 VALIDATION_ERROR', async () => {
        const res = await request(ctx.app!)
          .post('/users')
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            email: `weak-${randomUUID()}@example.com`,
            password: 'short',
            role: 'cashier',
            name: 'X',
          });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // GET /users — list
    // ────────────────────────────────────────────────────────────────────
    describe('GET /users', () => {
      it('admin → 200 list (tenant-scoped, soft-deleted hariç)', async () => {
        const res = await request(ctx.app!)
          .get('/users')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.data.users)).toBe(true);
        // En az 5 seed kullanıcı (admin, admin2, cashier, kitchen, waiter)
        expect(res.body.data.users.length).toBeGreaterThanOrEqual(5);
        // Cross-tenant izolasyon: tenant B kullanıcısı listede DEĞİL
        const ids = (res.body.data.users as { id: string }[]).map((u) => u.id);
        expect(ids).not.toContain(TENANT_B_USER_ID);
      });

      it('cashier → 403', async () => {
        const res = await request(ctx.app!)
          .get('/users')
          .set('Authorization', `Bearer ${ctx.cashierToken!}`);
        expect(res.status).toBe(403);
      });

      it('waiter → 403', async () => {
        const res = await request(ctx.app!)
          .get('/users')
          .set('Authorization', `Bearer ${ctx.waiterToken!}`);
        expect(res.status).toBe(403);
      });

      it('kitchen → 403', async () => {
        const res = await request(ctx.app!)
          .get('/users')
          .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
        expect(res.status).toBe(403);
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // GET /users/:id
    // ────────────────────────────────────────────────────────────────────
    describe('GET /users/:id', () => {
      it('admin + var olan id → 200', async () => {
        const res = await request(ctx.app!)
          .get(`/users/${CASHIER_ID}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(200);
        expect(res.body.data.user.id).toBe(CASHIER_ID);
        expect(res.body.data.user.role).toBe('cashier');
      });

      it('admin + bilinmeyen id → 404 USER_NOT_FOUND', async () => {
        const res = await request(ctx.app!)
          .get(`/users/${randomUUID()}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('USER_NOT_FOUND');
      });

      it('admin + cross-tenant user id → 404 USER_NOT_FOUND (enumeration sızdırılmaz)', async () => {
        const res = await request(ctx.app!)
          .get(`/users/${TENANT_B_USER_ID}`)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('USER_NOT_FOUND');
      });

      it('cashier → 403', async () => {
        const res = await request(ctx.app!)
          .get(`/users/${CASHIER_ID}`)
          .set('Authorization', `Bearer ${ctx.cashierToken!}`);
        expect(res.status).toBe(403);
      });

      it('admin + malformed UUID id → 400 VALIDATION_ERROR (validateParams)', async () => {
        const res = await request(ctx.app!)
          .get('/users/not-a-uuid')
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message_key).toBe('error.validation.failed');
        expect(res.body.error.details.fields.id).toBeDefined();
      });

      it('no auth + malformed UUID → 401 (auth runs before validateParams; UUID format not leaked)', async () => {
        const res = await request(ctx.app!).get('/users/not-a-uuid');
        expect(res.status).toBe(401);
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // PATCH /users/:id
    // ────────────────────────────────────────────────────────────────────
    describe('PATCH /users/:id', () => {
      it('admin + name update → 200', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${KITCHEN_ID}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ name: 'Mutfak Şef' });
        expect(res.status).toBe(200);
        expect(res.body.data.user.name).toBe('Mutfak Şef');
      });

      it('waiter → 403', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${KITCHEN_ID}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.waiterToken!}`)
          .send({ name: 'X' });
        expect(res.status).toBe(403);
      });

      it('admin + boş body → 400 VALIDATION_ERROR (refine)', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${KITCHEN_ID}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({});
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('admin + bilinmeyen id → 404 USER_NOT_FOUND', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${randomUUID()}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ name: 'X' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('USER_NOT_FOUND');
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // DELETE /users/:id — lifecycle
    // ────────────────────────────────────────────────────────────────────
    describe('DELETE /users/:id', () => {
      it('admin + non-admin user → 204 + soft delete + token revoke', async () => {
        // Disposable cashier seed
        const tmpId = randomUUID();
        const tmpEmail = `tmp-${randomUUID()}@example.com`;
        const tmpPassword = 'tmppass123456';
        await ctx.db!
          .insertInto('users')
          .values({
            id: tmpId,
            tenant_id: TENANT_ID,
            email: tmpEmail,
            username: `tmp-${tmpId.slice(0, 8)}`,
            password_hash: await hashPassword(tmpPassword),
            role: 'cashier',
          })
          .execute();

        // login ile aktif refresh token üret
        const loginRes = await request(ctx.app!)
          .post('/auth/login')
          .set('X-Forwarded-For', uniqueIp())
          .send({ email: tmpEmail, password: tmpPassword });
        expect(loginRes.status).toBe(200);

        const delRes = await request(ctx.app!)
          .delete(`/users/${tmpId}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(delRes.status).toBe(204);

        // Hard delete (ADR-002 §10.10): satır gerçekten silindi
        const row = await ctx.db!
          .selectFrom('users')
          .selectAll()
          .where('id', '=', tmpId)
          .executeTakeFirst();
        expect(row).toBeUndefined();

        // refresh_tokens FK ON DELETE CASCADE (Migration 018):
        // user satırı silindiğinde token satırları otomatik silinir.
        const tokens = await ctx.db!
          .selectFrom('refresh_tokens')
          .selectAll()
          .where('user_id', '=', tmpId)
          .execute();
        expect(tokens).toEqual([]);
      });

      it('soft delete sonrası login → 401 AUTH_INVALID_CREDENTIALS (ADR-002 §10.4)', async () => {
        const tmpId = randomUUID();
        const tmpEmail = `softlogin-${randomUUID()}@example.com`;
        const tmpPassword = 'softlogin1234';
        await ctx.db!
          .insertInto('users')
          .values({
            id: tmpId,
            tenant_id: TENANT_ID,
            email: tmpEmail,
            username: `sl-${tmpId.slice(0, 8)}`,
            password_hash: await hashPassword(tmpPassword),
            role: 'cashier',
          })
          .execute();

        const delRes = await request(ctx.app!)
          .delete(`/users/${tmpId}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(delRes.status).toBe(204);

        const loginRes = await request(ctx.app!)
          .post('/auth/login')
          .set('X-Forwarded-For', uniqueIp())
          .send({ email: tmpEmail, password: tmpPassword });
        expect(loginRes.status).toBe(401);
        expect(loginRes.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      });

      it('soft delete sonrası refresh → 401 AUTH_REFRESH_INVALID', async () => {
        const tmpId = randomUUID();
        const tmpEmail = `softref-${randomUUID()}@example.com`;
        const tmpPassword = 'softref1234567';
        await ctx.db!
          .insertInto('users')
          .values({
            id: tmpId,
            tenant_id: TENANT_ID,
            email: tmpEmail,
            username: `sr-${tmpId.slice(0, 8)}`,
            password_hash: await hashPassword(tmpPassword),
            role: 'cashier',
          })
          .execute();

        // login ile refresh cookie al
        const loginRes = await request(ctx.app!)
          .post('/auth/login')
          .set('X-Forwarded-For', uniqueIp())
          .send({ email: tmpEmail, password: tmpPassword });
        expect(loginRes.status).toBe(200);
        const setCookie = loginRes.headers['set-cookie'] as
          | string[]
          | undefined;
        expect(setCookie).toBeDefined();

        // Admin soft delete
        const delRes = await request(ctx.app!)
          .delete(`/users/${tmpId}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(delRes.status).toBe(204);

        // Refresh — token revoked
        const refreshRes = await request(ctx.app!)
          .post('/auth/refresh')
          .set('X-Refresh-Request', '1')
          .set('Cookie', setCookie ?? []);
        expect(refreshRes.status).toBe(401);
        expect(refreshRes.body.error.code).toBe('AUTH_REFRESH_INVALID');
      });

      it('admin self-delete → 403 USER_CANNOT_DELETE_SELF (ADR-002 §10.2)', async () => {
        const res = await request(ctx.app!)
          .delete(`/users/${ADMIN_ID}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('USER_CANNOT_DELETE_SELF');
      });

      it('son admin guard — tek admin tenant → 409 USER_LAST_ADMIN_PROTECTED (ADR-002 §10.1)', async () => {
        // Tek admin'li ayrı tenant kur
        const tenantSoloId = randomUUID();
        const soloAdminId = randomUUID();
        const soloAdminEmail = `solo-${randomUUID()}@example.com`;
        const soloAdminPass = 'soloadmin1234';
        await ctx.db!
          .insertInto('tenants')
          .values({
            id: tenantSoloId,
            name: 'Solo Admin Tenant',
            slug: `solo-${tenantSoloId.slice(0, 8)}`,
          })
          .execute();
        await ctx.db!
          .insertInto('tenant_settings')
          .values({ tenant_id: tenantSoloId })
          .execute();
        await ctx.db!
          .insertInto('users')
          .values({
            id: soloAdminId,
            tenant_id: tenantSoloId,
            email: soloAdminEmail,
            username: `solo-${soloAdminId.slice(0, 8)}`,
            password_hash: await hashPassword(soloAdminPass),
            role: 'admin',
          })
          .execute();

        // Solo tenant için ayrı app instance (tenantId binding farklı)
        const soloApp = buildApp({
          pool: ctx.pool!,
          db: ctx.db!,
          accessSecret: ACCESS_SECRET,
          tenantId: tenantSoloId,
          webOrigin: 'http://localhost:5173',
        });
        const soloToken = await loginAndGetToken(
          soloApp,
          soloAdminEmail,
          soloAdminPass,
        );

        // İkinci bir admin yarat (target — tek admin OLMAYAN bir hedef yok burada,
        // test'in özü: solo admin başka bir admin'i hedef göstererek silmek istese
        // bile, kendisini silemediği için zaten 403; bu yüzden bu test'te ikinci
        // bir admin yaratıp solo admin'in onu silmesi → guard tetiklenmez.
        // Doğru senaryo: solo admin'i silmek için BAŞKA bir admin olmalı; o yüzden
        // önce yardımcı admin yaratılır, sonra solo admin DELETE edilir; sonra
        // ikinci admin tek admin haline gelir; solo admin dönemez. Bu davranışı
        // doğrulamak için: önce solo'nun rolünü cashier'a indir → solo zaten yok
        // → ikinci admin tek admin → ikinci admin'i sil → 409.
        // Daha basit yol: aux admin yarat, aux'u solo admin sil → success →
        // sonra aux yeniden yarat ve aux'tan solo'yu silmeyi dene → solo
        // tek admin → 409.
        const auxId = randomUUID();
        const auxEmail = `aux-${randomUUID()}@example.com`;
        const auxPass = 'auxadmin1234';
        await ctx.db!
          .insertInto('users')
          .values({
            id: auxId,
            tenant_id: tenantSoloId,
            email: auxEmail,
            username: `aux-${auxId.slice(0, 8)}`,
            password_hash: await hashPassword(auxPass),
            role: 'admin',
          })
          .execute();

        const auxToken = await loginAndGetToken(soloApp, auxEmail, auxPass);

        // Aux, solo'yu siler → success (2 admin var)
        const okRes = await request(soloApp)
          .delete(`/users/${soloAdminId}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${auxToken}`);
        expect(okRes.status).toBe(204);

        // Şimdi aux tek admin. Solo (deleted) auth edemediği için aux başka admin
        // yaratıp dener — alternatif: aux kendini silemez (self-delete guard 403),
        // bu yüzden başka bir admin (3.) yarat ve onu sil → guard yok (2 admin
        // anında 1 olur). Ama biz GUARD'ı test ediyoruz: aux kendi tek admin
        // değilse silinebilir → 1 admin kaldığında diğer admin'in silinmesi
        // engellenir.
        // Senaryo: aux + admin3 → admin3'ü sil → 1 admin kalır (aux). Sonra
        // aux başka bir admin (admin4) yaratıp admin4'ü sil → admin3 silindikten
        // sonra aux son admin; admin4'ü silsek tekrar 1 admin kalır. Yani guard
        // her zaman "current admin count == 1 ve target admin" kontrolü.
        // En net test: sadece aux var (1 admin), aux başka non-admin user yaratır,
        // o user'ı admin yapamaz (PATCH role), ama biz başka admin yaratıp test
        // ederiz: yeni admin5 yarat → 2 admin. admin5'i sil → 204. Şimdi 1 admin
        // (aux). Yeni admin6 yarat → 2 admin. aux'u sil ama aux kendini silemez
        // (self-delete). aux, admin6'yı silebilir mi? evet, 2 admin → 1 admin
        // → guard tetiklenmez (target silindikten sonra count 1, ama guard
        // "silmeden önce count == 1" kontrol eder, target admin → dolayısıyla
        // SİLMEDEN ÖNCE 2 admin → guard pas). admin6 silinir, 1 admin kalır.
        // GUARD'ı tetiklemek için: 1 admin tenant'ta DELETE → guard. Burada
        // cross-actor gerek var; aux self-delete çalışmaz. Çözüm: BAŞKA bir
        // tenant'ın admin'i kullanılamaz (cross-tenant 404). Test edilebilir
        // tek yol: aux + admin7 var. admin7 token ile aux'u sil → guard
        // tetiklenmez (2 admin → 1). Sonra admin7 + admin8 → admin7'yi sil
        // (admin8 token) → 2 → 1, guard tetiklenmez. Sonsuz döngü.
        //
        // ÇÖZÜM: aux soft-delete edilir (manuel SQL ile, son admin guard
        // bypass edilerek), sonra başka bir admin (admin9) eklenir → 1 admin.
        // admin9 ile başka bir hedef admin (admin10) eklenir → 2. admin10'u
        // silmek 204. Tekrar 1 admin. admin9 başka admin yarat (admin11) → 2.
        // admin9 admin11'i sil → 204. Hep 2 → 1, guard pas.
        //
        // Tek doğru yol: 1 admin + 1 başka admin yarat, ama 1. admin'i
        // silmesi için 2. admin'in token'ı gerekli; sonra 1. admin silindi,
        // tek admin (2.) kalır; 2. admin'i silmek için 3. admin gerekir;
        // ama biz 2.'yi silmek istiyoruz → guard tetiklenecek mi? Guard
        // "target admin && current count == 1" → evet target admin (2.),
        // silmeden önce count 1 → 409!
        const newAdminId = randomUUID();
        const newAdminEmail = `new-admin-${randomUUID()}@example.com`;
        const newAdminPass = 'newadmin12345';
        await ctx.db!
          .insertInto('users')
          .values({
            id: newAdminId,
            tenant_id: tenantSoloId,
            email: newAdminEmail,
            username: `na-${newAdminId.slice(0, 8)}`,
            password_hash: await hashPassword(newAdminPass),
            role: 'admin',
          })
          .execute();
        const newAdminToken = await loginAndGetToken(
          soloApp,
          newAdminEmail,
          newAdminPass,
        );

        // Aux'u sil (2 admin → 1, guard pas) — silme yapan newAdmin
        const auxDelRes = await request(soloApp)
          .delete(`/users/${auxId}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${newAdminToken}`);
        expect(auxDelRes.status).toBe(204);

        // Şimdi tenantSolo'da tek admin: newAdmin. newAdmin başka bir admin
        // yaratıp ona kendisini sildirmeli — kendi self-delete guard'a takılır.
        // Yardımcı: 2. admin (helper) yarat; helper newAdmin'i silmeye çalışsın
        // ama silmeden önce HELPER + newAdmin = 2 admin → guard PAS olur.
        // Yani guard'ı tetiklemek için: tenant tek admin VE silinmek istenen
        // o tek admin VE silen actor o admin (self-delete) → ama self-delete
        // ayrı 403 fırlatır, last-admin guard'a girmez.
        //
        // GERÇEK guard senaryosu: "B silmeye çalışıyor A'yı; A son admin"
        // → ama eğer B de admin'se 2 admin var (A, B) → silmeden önce 2 →
        // guard pas → A silinir → kalır B. B silinmek istenirse silen kim?
        // Kendi (self-delete 403). Başka admin C? Yok. Yani tek tenant'ta
        // last-admin guard'ı PRACTICE'te HİÇ tetiklenmez UNLESS ek varsayım:
        // "iki admin var, eş zamanlı silme race". Bu atomicity test'i.
        //
        // Direkt unit-style guard testi: countActiveAdmins'i manuel azalt.
        // Aux'un silinmesinden sonra 1 admin (newAdmin). Helper admin yarat
        // ama bunu DOĞRUDAN soft-delete et SQL ile (deleted_at = now). Şimdi
        // yine 1 active admin (newAdmin). Sonra başka helper admin yarat
        // (helper2) — 2 active admin. helper2 ile newAdmin'i sil → guard
        // pas → 204 → 1 admin kaldı (helper2). helper2'yi silmek için aktör
        // gerek. helper2'yi self-delete edemez.
        //
        // GUARD'ı production-realistic tetiklemek için: tenant'ta sadece
        // 1 active admin olduğunda BAŞKA HERHANGİ bir kullanıcı (cashier
        // role'lü) admin'i silmeye çalışsın — ama cashier 403 alır
        // (authorize). Yani DELETE /users/:id sadece admin yapabilir.
        // Tek admin tenant'ta o admin başkasını silebilir (kendi değilse).
        // Kendisi olmadığı için self-guard pas. Hedef admin değilse last-admin
        // guard tetiklenmez. Hedef admin olursa zaten kendi (self).
        //
        // Bu yüzden last-admin guard testi mock-style: SQL ile rolü manuel
        // 'cashier'a indir, sonra tek admin tenant kalsın, başka admin
        // yaratma yetkisini soluyalım. helper2 KENDİSİ son admin → kendisini
        // silmeye çalışırsa SELF-DELETE guard önce. Demek ki bu senaryoyu
        // tetiklemek için PATCH role (admin → non-admin) kullanmak gerek:
        // "tek admin'in role'ünü cashier'a indirmek" → 409 LAST_ADMIN.
        // PATCH testi suite'inde işlenecek (aşağıda).
        //
        // DELETE-style atomicity test: paralel iki DELETE — alttaki
        // 'atomicity' bloğunda. Bu blokta DOWNGRADE-style guard test
        // edilir: PATCH role admin → cashier (tek admin tenant) → 409.
        const downgradeRes = await request(soloApp)
          .patch(`/users/${newAdminId}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${newAdminToken}`)
          .send({ role: 'cashier' });
        expect(downgradeRes.status).toBe(409);
        expect(downgradeRes.body.error.code).toBe('USER_LAST_ADMIN_PROTECTED');

        // cleanup: solo tenant
        await ctx.db!
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', tenantSoloId)
          .execute();
        await ctx.db!
          .deleteFrom('users')
          .where('tenant_id', '=', tenantSoloId)
          .execute();
        await ctx.db!
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', tenantSoloId)
          .execute();
        await ctx.db!
          .deleteFrom('tenants')
          .where('id', '=', tenantSoloId)
          .execute();
      });

      it('cross-tenant DELETE → 404 USER_NOT_FOUND (izolasyon)', async () => {
        const res = await request(ctx.app!)
          .delete(`/users/${TENANT_B_USER_ID}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('USER_NOT_FOUND');
      });

      it('cashier → 403', async () => {
        const res = await request(ctx.app!)
          .delete(`/users/${KITCHEN_ID}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.cashierToken!}`);
        expect(res.status).toBe(403);
      });

      it('waiter → 403', async () => {
        const res = await request(ctx.app!)
          .delete(`/users/${KITCHEN_ID}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.waiterToken!}`);
        expect(res.status).toBe(403);
      });

      it('kitchen → 403', async () => {
        const res = await request(ctx.app!)
          .delete(`/users/${KITCHEN_ID}`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
        expect(res.status).toBe(403);
      });

      it('atomicity — paralel iki FARKLI admin DELETE: biri 204, diğeri 409 (FOR UPDATE race)', async () => {
        // 2 admin'li yeni izole tenant. Race senaryosu: A1, A2 admin; üçüncü
        // bir admin (driver) iki paralel DELETE atar — biri A1'e, biri A2'ye.
        // FOR UPDATE clause olmasaydı ikisi de count=3 görür (driver+A1+A2),
        // her ikisi de COMMIT ederdi → 1 admin (driver) kalırdı (yanlış: race
        // hâlâ var ama burada hedef "0 admin kalır" senaryosu). Doğru
        // tetikleyici: tenant'ta TAM 2 admin (A1, A2) ve dış driver yok
        // (driver = A1 veya A2). A1 token'ı ile A2'yi sil + A2 token'ı ile
        // A1'i sil — paralel.
        //
        // FOR UPDATE OLMASAYDI: ikisi de count=2 görür, her ikisi de
        // proceed → 0 admin. FOR UPDATE İLE: ikinci tx birincinin COMMIT'ini
        // bekler, count=1 → 409 USER_LAST_ADMIN_PROTECTED.
        const tId = randomUUID();
        const a1Id = randomUUID();
        const a2Id = randomUUID();
        const a1Email = `r-a1-${randomUUID()}@example.com`;
        const a2Email = `r-a2-${randomUUID()}@example.com`;
        const a1Pass = 'racea1pass1234';
        const a2Pass = 'racea2pass1234';
        await ctx.db!
          .insertInto('tenants')
          .values({ id: tId, name: 'Race', slug: `race-${tId.slice(0, 8)}` })
          .execute();
        await ctx.db!
          .insertInto('tenant_settings')
          .values({ tenant_id: tId })
          .execute();
        await ctx.db!
          .insertInto('users')
          .values([
            {
              id: a1Id,
              tenant_id: tId,
              email: a1Email,
              username: `a1-${a1Id.slice(0, 8)}`,
              password_hash: await hashPassword(a1Pass),
              role: 'admin',
            },
            {
              id: a2Id,
              tenant_id: tId,
              email: a2Email,
              username: `a2-${a2Id.slice(0, 8)}`,
              password_hash: await hashPassword(a2Pass),
              role: 'admin',
            },
          ])
          .execute();

        const raceApp = buildApp({
          pool: ctx.pool!,
          db: ctx.db!,
          accessSecret: ACCESS_SECRET,
          tenantId: tId,
          webOrigin: 'http://localhost:5173',
        });
        const [t1, t2] = await Promise.all([
          loginAndGetToken(raceApp, a1Email, a1Pass),
          loginAndGetToken(raceApp, a2Email, a2Pass),
        ]);

        // Paralel iki FARKLI admin id'ye DELETE — race tetiklenir.
        const [r1, r2] = await Promise.all([
          request(raceApp)
            .delete(`/users/${a2Id}`)
            .set("X-Forwarded-For", uniqueIp())
            .set('Authorization', `Bearer ${t1}`),
          request(raceApp)
            .delete(`/users/${a1Id}`)
            .set("X-Forwarded-For", uniqueIp())
            .set('Authorization', `Bearer ${t2}`),
        ]);
        const codes = [r1.status, r2.status].sort();
        // FOR UPDATE doğru çalışıyorsa: biri 204, diğeri 409.
        expect(codes).toEqual([204, 409]);

        // 409 yanıtının body'sinde USER_LAST_ADMIN_PROTECTED olmalı.
        const conflictRes = r1.status === 409 ? r1 : r2;
        expect(conflictRes.body.error.code).toBe('USER_LAST_ADMIN_PROTECTED');

        // Final state: tenant'ta tam 1 active admin kaldı (race kapandı).
        // Hard delete (ADR-002 §10.10): deleted_at filtresi yok.
        const activeAdmins = await ctx.db!
          .selectFrom('users')
          .select(['id'])
          .where('tenant_id', '=', tId)
          .where('role', '=', 'admin')
          .execute();
        expect(activeAdmins.length).toBe(1);

        // cleanup
        await ctx.db!
          .deleteFrom('refresh_tokens')
          .where('tenant_id', '=', tId)
          .execute();
        await ctx.db!
          .deleteFrom('users')
          .where('tenant_id', '=', tId)
          .execute();
        await ctx.db!
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', tId)
          .execute();
        await ctx.db!.deleteFrom('tenants').where('id', '=', tId).execute();
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // PATCH /users/:id/password — kendi şifresi (any role) + admin reset
    // ────────────────────────────────────────────────────────────────────
    describe('PATCH /users/:id/password', () => {
      it('cashier kendi şifresini değiştirir (currentPassword OK) → 200', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${CASHIER_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.cashierToken!}`)
          .send({
            currentPassword: CASHIER_PASSWORD,
            newPassword: 'cashierNewPass12',
          });
        expect(res.status).toBe(200);
        // restore (sonraki testler login'i bozmasın)
        const restoreRes = await request(ctx.app!)
          .patch(`/users/${CASHIER_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.cashierToken!}`)
          .send({
            currentPassword: 'cashierNewPass12',
            newPassword: CASHIER_PASSWORD,
          });
        expect(restoreRes.status).toBe(200);
      });

      it('waiter kendi şifresini yanlış currentPassword → 401 AUTH_INVALID_CREDENTIALS', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${WAITER_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.waiterToken!}`)
          .send({
            currentPassword: 'wrongpass1234',
            newPassword: 'waiterNewPass12',
          });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      });

      it('kitchen kendi şifresini değiştirir → 200', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${KITCHEN_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
          .send({
            currentPassword: KITCHEN_PASSWORD,
            newPassword: 'kitchenNewPass12',
          });
        expect(res.status).toBe(200);
      });

      it('admin kendi şifresini değiştirir → 200', async () => {
        const newPass = 'adminNewPass1234';
        const res = await request(ctx.app!)
          .patch(`/users/${ADMIN_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            currentPassword: ADMIN_PASSWORD,
            newPassword: newPass,
          });
        expect(res.status).toBe(200);
        // restore
        const restoreRes = await request(ctx.app!)
          .patch(`/users/${ADMIN_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            currentPassword: newPass,
            newPassword: ADMIN_PASSWORD,
          });
        expect(restoreRes.status).toBe(200);
      });

      it('admin başkasının şifresini reset (currentPassword YOK) → 200', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${WAITER_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({ newPassword: 'resetWaiterPass12' });
        expect(res.status).toBe(200);
      });

      it('cashier başka kullanıcının şifresi → 403 AUTH_FORBIDDEN', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${WAITER_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.cashierToken!}`)
          .send({
            currentPassword: 'whatever',
            newPassword: 'newpass1234567',
          });
        expect(res.status).toBe(403);
      });

      it('waiter başka kullanıcının şifresi → 403 AUTH_FORBIDDEN', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${KITCHEN_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.waiterToken!}`)
          .send({
            currentPassword: 'whatever',
            newPassword: 'newpass1234567',
          });
        expect(res.status).toBe(403);
      });

      it('weak newPassword (<10) → 400 VALIDATION_ERROR', async () => {
        const res = await request(ctx.app!)
          .patch(`/users/${ADMIN_ID}/password`)
          .set("X-Forwarded-For", uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            currentPassword: ADMIN_PASSWORD,
            newPassword: 'short',
          });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
    });

    // ────────────────────────────────────────────────────────────────────
    // Rate-limit (security-reviewer Görev 17 fix #3 + #5)
    // ────────────────────────────────────────────────────────────────────
    describe('Rate-limit', () => {
      it('PATCH /users/:id/password — 6. istek 429 AUTH_RATE_LIMITED (5/15dk)', async () => {
        // Sabit IP — 5 istek pas, 6. istek 429.
        const fixedIp = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
        const requests: Array<Promise<{ status: number; body: unknown }>> = [];
        for (let i = 0; i < 6; i += 1) {
          requests.push(
            request(ctx.app!)
              .patch(`/users/${ADMIN_ID}/password`)
              .set('X-Forwarded-For', fixedIp)
              .set('Authorization', `Bearer ${ctx.adminToken!}`)
              .send({
                currentPassword: ADMIN_PASSWORD,
                newPassword: `rateLimitTest${i}xx`,
              })
              .then((r) => ({
                status: r.status,
                body: r.body as unknown,
              })),
          );
        }
        const results = await Promise.all(requests);
        const statuses = results.map((r) => r.status).sort();
        // Sıralı çalışırlarsa: 200,200,200,200,200,429. Paralelde sıra
        // garantisiz; en az bir 429 olmalı.
        expect(statuses).toContain(429);
        const limited = results.find((r) => r.status === 429);
        expect((limited?.body as { error?: { code?: string } }).error?.code)
          .toBe('AUTH_RATE_LIMITED');

        // restore admin password (önceki başarılı istekler değiştirdi)
        const restore = await request(ctx.app!)
          .patch(`/users/${ADMIN_ID}/password`)
          .set('X-Forwarded-For', uniqueIp())
          .set('Authorization', `Bearer ${ctx.adminToken!}`)
          .send({
            currentPassword: 'rateLimitTest4xx',
            newPassword: ADMIN_PASSWORD,
          });
        // restore başarısızsa hangi password en son set edildi tahmin edilemez
        // (paralel sıralama garantisiz). Fallback: 0..4 dene.
        if (restore.status !== 200) {
          for (let i = 0; i < 5; i += 1) {
            const r = await request(ctx.app!)
              .patch(`/users/${ADMIN_ID}/password`)
              .set('X-Forwarded-For', uniqueIp())
              .set('Authorization', `Bearer ${ctx.adminToken!}`)
              .send({
                currentPassword: `rateLimitTest${i}xx`,
                newPassword: ADMIN_PASSWORD,
              });
            if (r.status === 200) break;
          }
        }
      });

      it('DELETE /users/:id — 11. istek 429 AUTH_RATE_LIMITED (10/dk)', async () => {
        // 11 disposable cashier seed; sabit IP üzerinden ardışık DELETE.
        const fixedIp = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
        const seedIds: string[] = [];
        for (let i = 0; i < 11; i += 1) {
          const id = randomUUID();
          seedIds.push(id);
          await ctx.db!
            .insertInto('users')
            .values({
              id,
              tenant_id: TENANT_ID,
              email: `rl-del-${i}-${randomUUID()}@example.com`,
              username: `rl-del-${i}-${id.slice(0, 8)}`,
              password_hash: await hashPassword('rldelpass1234'),
              role: 'cashier',
            })
            .execute();
        }

        const responses: Array<{ status: number; body: unknown }> = [];
        for (const id of seedIds) {
          const res = await request(ctx.app!)
            .delete(`/users/${id}`)
            .set('X-Forwarded-For', fixedIp)
            .set('Authorization', `Bearer ${ctx.adminToken!}`);
          responses.push({ status: res.status, body: res.body as unknown });
        }
        const statuses = responses.map((r) => r.status);
        // Diagnostic: failure halinde non-204 ilk index'i göster
        const firstNon204 = statuses.findIndex((s) => s !== 204);
        if (firstNon204 !== -1 && firstNon204 < 10) {
          console.error(
            `DELETE rate-limit test failure: index=${firstNon204} status=${statuses[firstNon204]} body=${JSON.stringify(
              responses[firstNon204]?.body,
            )} all=${statuses.join(',')}`,
          );
        }
        // İlk 10 istek 204, 11. istek 429.
        expect(statuses.slice(0, 10).every((s) => s === 204)).toBe(true);
        expect(statuses[10]).toBe(429);
        const limitedBody = responses[10]?.body as
          | { error?: { code?: string } }
          | undefined;
        expect(limitedBody?.error?.code).toBe('AUTH_RATE_LIMITED');
      });
    });
  },
);
