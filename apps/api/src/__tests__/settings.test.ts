import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const TENANT_NAME = 'Test Tenant Settings';
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;
const CASHIER_ID = randomUUID();
const CASHIER_EMAIL = `cashier-${randomUUID()}@example.com`;
const CASHIER_PASSWORD = 'cashierpass1234';
const CASHIER_USERNAME = `cashier-${randomUUID().slice(0, 8)}`;
const WAITER_ID = randomUUID();
const WAITER_EMAIL = `waiter-${randomUUID()}@example.com`;
const WAITER_PASSWORD = 'waiterpass1234';
const WAITER_USERNAME = `waiter-${randomUUID().slice(0, 8)}`;
const KITCHEN_ID = randomUUID();
const KITCHEN_EMAIL = `kitchen-${randomUUID()}@example.com`;
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
 * Tenant_settings satırını test başlangıç değerlerine sıfırla. Migration
 * default'ı (timezone='Europe/Istanbul') DB'de DEFAULT olarak tanımlı;
 * her test arası reset için açık UPDATE.
 *
 * ADR-015: business_day_cutoff_hour Migration 026 ile DROP edildi.
 */
async function resetSettings(db: Kysely<DB>): Promise<void> {
  await db
    .updateTable('tenant_settings')
    .set({ timezone: 'Europe/Istanbul' })
    .where('tenant_id', '=', TENANT_ID)
    .execute();
  await db.deleteFrom('audit_logs').where('tenant_id', '=', TENANT_ID).execute();
}

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
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: TENANT_NAME,
          slug: `test-settings-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
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

      ctx.adminToken = await loginAndGetToken(ctx.app, ADMIN_EMAIL, ADMIN_PASSWORD);
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

    beforeEach(async () => {
      if (ctx.db !== undefined) {
        await resetSettings(ctx.db);
      }
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
        await ctx.db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    // ─────────────────────────────────────────────────────────────────
    // GET /settings — RBAC matrisi (4 rol)
    // ─────────────────────────────────────────────────────────────────

    it('GET admin → 200 + tenantName + timezone (ADR-015 — cutoff removed)', async () => {
      const res = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      expect(res.body.data.settings.tenantId).toBe(TENANT_ID);
      expect(res.body.data.settings.tenantName).toBe(TENANT_NAME);
      expect(res.body.data.settings.timezone).toBe('Europe/Istanbul');
      expect(res.body.data.settings.businessDayCutoffHour).toBeUndefined();
      expect(typeof res.body.data.settings.createdAt).toBe('string');
      expect(typeof res.body.data.settings.updatedAt).toBe('string');
    });

    it('GET cashier → 200 (ADR-002 §6 amendment, Sprint 6: tenant.settings.read)', async () => {
      const res = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`);
      expect(res.status).toBe(200);
      expect(res.body.data.settings.tenantName).toBe(TENANT_NAME);
    });

    it('GET waiter → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('GET kitchen → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('GET no token → 401 AUTH_TOKEN_INVALID', async () => {
      const res = await request(ctx.app!).get('/settings');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });

    // ─────────────────────────────────────────────────────────────────
    // PATCH /settings — admin happy path + audit
    // ─────────────────────────────────────────────────────────────────

    it('PATCH admin timezone tek alan → 200, updatedAt ilerledi, audit_logs 1 satır', async () => {
      const beforeRes = await request(ctx.app!)
        .get('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      const beforeUpdatedAt = beforeRes.body.data.settings.updatedAt as string;
      // Driver/Postgres bazen ms granularity altında — küçük gecikme
      await new Promise((r) => setTimeout(r, 10));

      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ timezone: 'Europe/Berlin' });
      expect(res.status).toBe(200);
      expect(res.body.data.settings.timezone).toBe('Europe/Berlin');
      expect(
        new Date(res.body.data.settings.updatedAt).getTime(),
      ).toBeGreaterThanOrEqual(new Date(beforeUpdatedAt).getTime());

      const audit = await ctx.db!
        .selectFrom('audit_logs')
        .select(['event_type', 'entity_id', 'payload'])
        .where('tenant_id', '=', TENANT_ID)
        .where('event_type', '=', 'tenant_settings.updated')
        .execute();
      expect(audit.length).toBe(1);
      expect(audit[0]!.entity_id).toBe(TENANT_ID);
      const payload = audit[0]!.payload as {
        changed_fields?: string[];
        timezone_before?: string;
        timezone_after?: string;
      };
      expect(payload.changed_fields).toEqual(['timezone']);
      expect(payload.timezone_before).toBe('Europe/Istanbul');
      expect(payload.timezone_after).toBe('Europe/Berlin');
    });

    // ─────────────────────────────────────────────────────────────────
    // PATCH /settings — VALIDATION_ERROR (zod)
    // ADR-015: businessDayCutoffHour artık schema'da yok; gönderilirse zod
    // tarafından strict mod olmadığı için sessizce yutulur — sadece timezone
    // patch'i etkili olur. Boş body refine ile 400.
    // ─────────────────────────────────────────────────────────────────

    it('PATCH boş body → 400 VALIDATION_ERROR', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('PATCH timezone="invalid//bad" → 400 VALIDATION_ERROR (zod regex)', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ timezone: 'invalid//bad' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    // ─────────────────────────────────────────────────────────────────
    // PATCH /settings — DB trigger savunması (SETTINGS_INVALID_TIMEZONE)
    // ─────────────────────────────────────────────────────────────────

    it('PATCH timezone="Mars/Olympus" → 400 SETTINGS_INVALID_TIMEZONE (DB trigger)', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ timezone: 'Mars/Olympus' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SETTINGS_INVALID_TIMEZONE');
      expect(res.body.error.message_key).toBe('error.settings.invalidTimezone');
    });

    // ─────────────────────────────────────────────────────────────────
    // PATCH /settings — RBAC (forbidden)
    // ─────────────────────────────────────────────────────────────────

    it('PATCH cashier → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.cashierToken!}`)
        .send({ timezone: 'UTC' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH waiter → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.waiterToken!}`)
        .send({ timezone: 'UTC' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH kitchen → 403 AUTH_FORBIDDEN', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .set('Authorization', `Bearer ${ctx.kitchenToken!}`)
        .send({ timezone: 'UTC' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('PATCH no token → 401 AUTH_TOKEN_INVALID', async () => {
      const res = await request(ctx.app!)
        .patch('/settings')
        .send({ timezone: 'UTC' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
    });
  },
);
