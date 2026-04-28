import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const TENANT_NAME = `Settings Test Tenant ${TENANT_ID.slice(0, 6)}`;

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-set-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;

const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-set-${randomUUID()}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-${randomUUID().slice(0, 8)}`;

const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-set-${randomUUID()}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-${randomUUID().slice(0, 8)}`;

const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-set-${randomUUID()}@example.com`;
const KITCHEN_PASSWORD = 'kitchenpass1234';
const KITCHEN_USERNAME = `kitchen-${randomUUID().slice(0, 8)}`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
  cashierToken: string;
  waiterToken: string;
  kitchenToken: string;
}

const ctx: Partial<TestCtx> = {};

async function loginAndGetToken(
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
 * Sprint 6 Görev 24 — `/settings` GET + PATCH integration tests.
 *
 * Kapsam: 4 rol RBAC, validation (boş body, invalid TZ, hour out of range),
 * persisting (PATCH sonrası 2. GET'te değer dönüyor), audit (settings.updated
 * payload). DATABASE_URL yoksa skip (areas.test.ts pattern).
 */
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  '/settings integration (Sprint 6 Görev 24)',
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

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: TENANT_NAME,
          slug: `settings-test-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      // 1:1 settings seed — Europe/Istanbul + cutoff 4 (production default)
      await db
        .insertInto('tenant_settings')
        .values({
          tenant_id: TENANT_ID,
          timezone: 'Europe/Istanbul',
          business_day_cutoff_hour: 4,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      const cashierHash = await hashPassword(CASHIER_PASSWORD);
      const waiterHash = await hashPassword(WAITER_PASSWORD);
      const kitchenHash = await hashPassword(KITCHEN_PASSWORD);

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
            id: CASHIER_ID,
            tenant_id: TENANT_ID,
            email: CASHIER_EMAIL,
            username: CASHIER_USERNAME,
            password_hash: cashierHash,
            role: 'cashier',
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
            id: KITCHEN_ID,
            tenant_id: TENANT_ID,
            email: KITCHEN_EMAIL,
            username: KITCHEN_USERNAME,
            password_hash: kitchenHash,
            role: 'kitchen',
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
      ctx.waiterToken = await loginAndGetToken(
        ctx.app,
        WAITER_EMAIL,
        WAITER_PASSWORD,
      );
      ctx.kitchenToken = await loginAndGetToken(
        ctx.app,
        KITCHEN_EMAIL,
        KITCHEN_PASSWORD,
      );
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
        await ctx.db
          .deleteFrom('tenants')
          .where('id', '=', TENANT_ID)
          .execute();
        await ctx.db.destroy();
      }
    });

    // ─────────────────────────────────────────────────────────────────
    // GET /settings — RBAC matrix
    // ─────────────────────────────────────────────────────────────────

    it('GET admin → 200 + tüm 6 alan dolu', async () => {
      const res = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      const s = res.body.data.settings;
      expect(s.tenant_id).toBe(TENANT_ID);
      expect(s.tenant_name).toBe(TENANT_NAME);
      expect(typeof s.timezone).toBe('string');
      expect(s.timezone.length).toBeGreaterThan(0);
      expect(typeof s.business_day_cutoff_hour).toBe('number');
      expect(typeof s.created_at).toBe('string');
      expect(typeof s.updated_at).toBe('string');
    });

    it('GET cashier → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('GET waiter → 403', async () => {
      const res = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(403);
    });

    it('GET kitchen → 403', async () => {
      const res = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
      expect(res.status).toBe(403);
    });

    it('GET no Authorization → 401 AUTH_TOKEN_INVALID', async () => {
      const res = await request(ctx.app!).get('/settings');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    // ─────────────────────────────────────────────────────────────────
    // PATCH /settings — happy path + persisting
    // ─────────────────────────────────────────────────────────────────

    it('PATCH admin timezone → 200 + persisted (2. GET ile teyit)', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ timezone: 'America/New_York' });
      expect(res.status).toBe(200);
      expect(res.body.data.settings.timezone).toBe('America/New_York');

      const verify = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(verify.status).toBe(200);
      expect(verify.body.data.settings.timezone).toBe('America/New_York');
    });

    it('PATCH admin business_day_cutoff_hour → 200 + persisted', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ business_day_cutoff_hour: 6 });
      expect(res.status).toBe(200);
      expect(res.body.data.settings.business_day_cutoff_hour).toBe(6);

      const verify = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(verify.body.data.settings.business_day_cutoff_hour).toBe(6);
    });

    it('PATCH admin both fields → 200', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ timezone: 'Europe/Istanbul', business_day_cutoff_hour: 4 });
      expect(res.status).toBe(200);
      expect(res.body.data.settings.timezone).toBe('Europe/Istanbul');
      expect(res.body.data.settings.business_day_cutoff_hour).toBe(4);
    });

    // ─────────────────────────────────────────────────────────────────
    // PATCH /settings — validation (400)
    // ─────────────────────────────────────────────────────────────────

    it('PATCH boş body → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH invalid IANA timezone → 400', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ timezone: 'Mars/Olympus_Mons' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH business_day_cutoff_hour=24 → 400', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ business_day_cutoff_hour: 24 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH business_day_cutoff_hour=-1 → 400', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ business_day_cutoff_hour: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH unknown field (strict()) → 400', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ tenant_name: 'hijack' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    // ─────────────────────────────────────────────────────────────────
    // PATCH /settings — RBAC
    // ─────────────────────────────────────────────────────────────────

    it('PATCH cashier/waiter/kitchen → 403', async () => {
      for (const token of [
        ctx.cashierToken!,
        ctx.waiterToken!,
        ctx.kitchenToken!,
      ]) {
        const res = await request(ctx.app!)
          .patch('/settings')
          .set('Authorization', `Bearer ${token}`)
          .send({ business_day_cutoff_hour: 5 });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('PATCH no Authorization → 401', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .send({ business_day_cutoff_hour: 5 });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    // ─────────────────────────────────────────────────────────────────
    // Audit — settings.updated payload
    // ─────────────────────────────────────────────────────────────────

    it('PATCH timezone değişti → audit_logs satırı whitelist payload ile', async () => {
      // İlk önce baseline'a getir
      await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ timezone: 'Europe/Istanbul' });

      // Sonra değiştir
      await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ timezone: 'Europe/Berlin' });

      const auditRow = await ctx.db!
        .selectFrom('audit_logs')
        .select(['id', 'event_type', 'entity_id', 'entity_type', 'payload'])
        .where('event_type', '=', 'settings.updated')
        .where('tenant_id', '=', TENANT_ID)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      expect(auditRow).toBeDefined();
      expect(auditRow!.entity_type).toBe('tenant_settings');
      expect(auditRow!.entity_id).toBe(TENANT_ID);
      const payload = auditRow!.payload as {
        changed_fields?: string[];
        timezone_before?: string;
        timezone_after?: string;
      };
      expect(payload.changed_fields).toEqual(['timezone']);
      expect(payload.timezone_before).toBe('Europe/Istanbul');
      expect(payload.timezone_after).toBe('Europe/Berlin');
    });
  },
);
