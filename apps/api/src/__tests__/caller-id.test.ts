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

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const BRIDGE_TOKEN = 'test-bridge-token-shared-secret';

const TENANT_ID = randomUUID();
const TENANT_B_ID = randomUUID();

const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `caller-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `caller-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
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

function uniquePhone(): string {
  const digits = '0123456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += digits[Math.floor(Math.random() * 10)];
  }
  return `0539${suffix}`;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  '/bridge/caller-id + /caller-id integration',
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
        bridgeToken: BRIDGE_TOKEN,
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_ID,
            name: 'Test Tenant Caller',
            slug: `test-caller-${TENANT_ID.slice(0, 8)}`,
          },
          {
            id: TENANT_B_ID,
            name: 'Test Tenant Caller B',
            slug: `test-caller-b-${TENANT_B_ID.slice(0, 8)}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      // Tenant A: bypass pattern (0850 prefix maskeleme).
      await db
        .insertInto('tenant_settings')
        .values({
          tenant_id: TENANT_ID,
          caller_id_bypass_patterns: ['^0850'],
        })
        .onConflict((oc) =>
          oc.column('tenant_id').doUpdateSet({
            caller_id_bypass_patterns: ['^0850'],
          }),
        )
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_B_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
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
        ])
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      );
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        for (const tid of [TENANT_ID, TENANT_B_ID]) {
          await ctx.db
            .deleteFrom('refresh_tokens')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('call_logs')
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
          await ctx.db
            .deleteFrom('users')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('tenant_settings')
            .where('tenant_id', '=', tid)
            .execute();
          await ctx.db
            .deleteFrom('tenants')
            .where('id', '=', tid)
            .execute();
        }
        await ctx.db.destroy();
      }
    });

    it('POST /bridge/caller-id/incoming bilinen telefon → 200 + customerId, call_log INSERT', async () => {
      const phone = uniquePhone();
      // Müşteri seed (rehberde olan numara)
      const customerId = randomUUID();
      await ctx.db!
        .insertInto('customers')
        .values({
          id: customerId,
          tenant_id: TENANT_ID,
          full_name: 'Bilinen Müşteri',
          note: null,
        })
        .execute();
      await ctx.db!
        .insertInto('customer_phones')
        .values({
          id: randomUUID(),
          tenant_id: TENANT_ID,
          customer_id: customerId,
          raw_phone: phone,
          normalized_phone: phone,
          is_primary: true,
          is_mobile: true,
        })
        .execute();

      const res = await request(ctx.app!)
        .post('/bridge/caller-id/incoming')
        .set('X-Bridge-Token', BRIDGE_TOKEN)
        .set('X-Tenant-Id', TENANT_ID)
        .send({ rawPhone: phone, receivedAt: new Date().toISOString() });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.callLogId).toBeTruthy();

      // call_log persisted with customerId
      const log = await ctx.db!
        .selectFrom('call_logs')
        .selectAll()
        .where('id', '=', res.body.callLogId as string)
        .executeTakeFirst();
      expect(log).toBeDefined();
      expect(log!.customer_id).toBe(customerId);
      expect(log!.tenant_id).toBe(TENANT_ID);
    });

    it('POST /bridge/caller-id/incoming .NET DateTimeOffset "O" formatı (offset +00:00) → 200 (400 DEĞİL)', async () => {
      const phone = uniquePhone();
      // .NET bridge `DateTimeOffset.ToString("O")` → "…+00:00" (Z değil). datetime({offset:true}) şart.
      // Kontrat regresyon guard'ı: S86 canlı bridge testinde bu format 400 verdi (zod offset reddi).
      const res = await request(ctx.app!)
        .post('/bridge/caller-id/incoming')
        .set('X-Bridge-Token', BRIDGE_TOKEN)
        .set('X-Tenant-Id', TENANT_ID)
        .send({
          rawPhone: phone,
          lineNumber: 2,
          receivedAt: '2026-07-07T18:34:05.4310000+00:00',
        });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.callLogId).toBeTruthy();
    });

    it('POST /bridge/caller-id/incoming bilinmeyen telefon → 200 + customerId null + call_log INSERT', async () => {
      const phone = uniquePhone();
      const res = await request(ctx.app!)
        .post('/bridge/caller-id/incoming')
        .set('X-Bridge-Token', BRIDGE_TOKEN)
        .set('X-Tenant-Id', TENANT_ID)
        .send({ rawPhone: phone, receivedAt: new Date().toISOString() });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.callLogId).toBeTruthy();

      const log = await ctx.db!
        .selectFrom('call_logs')
        .selectAll()
        .where('id', '=', res.body.callLogId as string)
        .executeTakeFirst();
      expect(log).toBeDefined();
      expect(log!.customer_id).toBeNull();
    });

    it('POST /bridge/caller-id/incoming masked (0850) → 200 accepted:false reason:masked_bypass, call_log YOK', async () => {
      const masked = `0850${Math.floor(1000000 + Math.random() * 8999999)}`;
      const before = await ctx.db!
        .selectFrom('call_logs')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('tenant_id', '=', TENANT_ID)
        .where('normalized_phone', '=', masked)
        .executeTakeFirst();

      const res = await request(ctx.app!)
        .post('/bridge/caller-id/incoming')
        .set('X-Bridge-Token', BRIDGE_TOKEN)
        .set('X-Tenant-Id', TENANT_ID)
        .send({ rawPhone: masked, receivedAt: new Date().toISOString() });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(false);
      expect(res.body.reason).toBe('masked_bypass');
      expect(res.body.callLogId).toBeNull();

      const after = await ctx.db!
        .selectFrom('call_logs')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('tenant_id', '=', TENANT_ID)
        .where('normalized_phone', '=', masked)
        .executeTakeFirst();
      // Sayı değişmedi
      expect(after!.c).toBe(before!.c);
    });

    it('POST /bridge/caller-id/incoming yanlış token → 401', async () => {
      const res = await request(ctx.app!)
        .post('/bridge/caller-id/incoming')
        .set('X-Bridge-Token', 'wrong-token')
        .set('X-Tenant-Id', TENANT_ID)
        .send({ rawPhone: uniquePhone(), receivedAt: new Date().toISOString() });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('BRIDGE_TOKEN_INVALID');
    });

    it('POST /bridge/caller-id/incoming geçersiz/boş normalize → 200 accepted:false reason:invalid', async () => {
      // "abc" normalize → '' → reason='invalid'
      const res = await request(ctx.app!)
        .post('/bridge/caller-id/incoming')
        .set('X-Bridge-Token', BRIDGE_TOKEN)
        .set('X-Tenant-Id', TENANT_ID)
        .send({ rawPhone: 'abcdef', receivedAt: new Date().toISOString() });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(false);
      expect(res.body.reason).toBe('invalid');
      expect(res.body.callLogId).toBeNull();
    });

    it('GET /caller-id/logs farklı tenant çağrılarını görmez', async () => {
      // Tenant B'ye özel call_log seed (bridge ile — bridge endpoint
      // X-Tenant-Id header'ı ile multi-tenant çalışır, JWT login değil)
      const phoneB = uniquePhone();
      const bridgeRes = await request(ctx.app!)
        .post('/bridge/caller-id/incoming')
        .set('X-Bridge-Token', BRIDGE_TOKEN)
        .set('X-Tenant-Id', TENANT_B_ID)
        .send({ rawPhone: phoneB, receivedAt: new Date().toISOString() });
      expect(bridgeRes.status).toBe(200);
      expect(bridgeRes.body.accepted).toBe(true);
      const tenantBLogId = bridgeRes.body.callLogId as string;

      // Tenant A admin GET → tenantBLogId görünmemeli (izolasyon)
      const res = await request(ctx.app!)
        .get('/caller-id/logs?limit=200')
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(200);
      const ids = (res.body.data.calls as Array<{ id: string }>).map((c) => c.id);
      expect(ids).not.toContain(tenantBLogId);

      // Not: Tenant B admin login'i mümkün değil — buildApp tenantId
      // hardcoded. Sanity "B sees own log" testi atlandı; izolasyonun
      // pozitif yönünü call_logs row'unun tenant_id=B olduğunu DB'den
      // doğrulayarak yerine getiriyoruz.
      const log = await ctx.db!
        .selectFrom('call_logs')
        .selectAll()
        .where('id', '=', tenantBLogId)
        .executeTakeFirst();
      expect(log).toBeDefined();
      expect(log!.tenant_id).toBe(TENANT_B_ID);
    });
  },
);
