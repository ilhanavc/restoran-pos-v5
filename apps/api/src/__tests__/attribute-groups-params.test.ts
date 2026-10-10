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
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `admin-${randomUUID().slice(0, 8)}`;

/**
 * Bozuk path parametresi. `authenticate` + `authorize` geçilir, bu yüzden
 * istek gerçekten handler'a ulaşır; UUID doğrulaması yoksa repo sorgusuna
 * düşer (Postgres 22P02 → 500).
 */
const BAD = 'not-a-uuid';

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  appDb: Kysely<DB>;
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

/**
 * ADR-012 attribute-groups path-parametre doğrulaması (S139).
 *
 * Bu router ailesi `validateParams` kullanmıyordu: `:id` / `:optId` /
 * `:groupId` doğrudan repo sorgusuna gidiyordu. Kolonlar `UUID` olduğu için
 * bozuk bir parametre Postgres `22P02 invalid input syntax for type uuid`
 * üretiyor ve istemciye 400 yerine 500 dönüyordu (emsal: `orderItemParamSchema`
 * docblock'u aynı hata modunu tarif ediyor).
 *
 * ⚠️ Gövde gönderen uçlarda gövde **geçerli** seçilir; aksi hâlde 400
 * `validateBody`'den gelir ve test parametre kusurunu hiç tetiklemez
 * (tetiklemeyen vaka tuzağı).
 */
describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'attribute-groups path parametre doğrulaması (ADR-012)',
  () => {
    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      const db = createKysely(pool);
      ctx.pool = pool;
      ctx.db = db;
      // ADR-041 F3 test-harness: uygulama `app_tenant` (RLS-subject) altında
      // koşar; fixture/seed superuser `db` ile ayrı kalır.
      const appPool = createAppTenantPool(DB_URL ?? '');
      const appDb = createKysely(appPool);
      ctx.appDb = appDb;
      ctx.app = buildApp({
        pool: appPool,
        db: appDb,
        accessSecret: ACCESS_SECRET,
        agentSecret: 'test-agent-secret-min-32-chars-please-long',
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values({
          id: TENANT_ID,
          name: 'Test Tenant AttrParams',
          slug: `test-attrparams-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      await db
        .insertInto('users')
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          password_hash: await hashPassword(ADMIN_PASSWORD),
          role: 'admin',
        })
        .execute();

      ctx.adminToken = await loginAndGetToken(
        ctx.app,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
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
          .deleteFrom('attribute_options')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('attribute_groups')
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
      if (ctx.appDb !== undefined) {
        await ctx.appDb.destroy();
      }
    });

    /**
     * Her satır: bozuk UUID taşıyan gerçek bir istek. Gövde alanı dolu olan
     * uçlarda gövde şemaya UYGUN — böylece 400 yalnız path parametresinden
     * gelebilir.
     */
    const OK_GROUP_BODY = { name: 'Boy', selectionType: 'single' as const };
    const OK_GROUP_PATCH = { name: 'Yeni Ad' };
    const OK_OPTION_BODY = { name: 'Büyük' };
    const OK_OPTION_PATCH = { name: 'Orta' };
    const VALID = randomUUID();

    const cases: Array<{
      label: string;
      method: 'get' | 'post' | 'patch' | 'delete';
      path: string;
      body?: Record<string, unknown>;
    }> = [
      // --- /attribute-groups ---
      { label: 'GET /attribute-groups/:id', method: 'get', path: `/attribute-groups/${BAD}` },
      {
        label: 'PATCH /attribute-groups/:id',
        method: 'patch',
        path: `/attribute-groups/${BAD}`,
        body: OK_GROUP_PATCH,
      },
      {
        label: 'DELETE /attribute-groups/:id',
        method: 'delete',
        path: `/attribute-groups/${BAD}`,
      },
      {
        label: 'GET /attribute-groups/:id/options',
        method: 'get',
        path: `/attribute-groups/${BAD}/options`,
      },
      {
        label: 'POST /attribute-groups/:id/options',
        method: 'post',
        path: `/attribute-groups/${BAD}/options`,
        body: OK_OPTION_BODY,
      },
      {
        label: 'PATCH /attribute-groups/:id/options/:optId — bozuk :id',
        method: 'patch',
        path: `/attribute-groups/${BAD}/options/${VALID}`,
        body: OK_OPTION_PATCH,
      },
      {
        label: 'PATCH /attribute-groups/:id/options/:optId — bozuk :optId',
        method: 'patch',
        path: `/attribute-groups/${VALID}/options/${BAD}`,
        body: OK_OPTION_PATCH,
      },
      {
        label: 'DELETE /attribute-groups/:id/options/:optId — bozuk :id',
        method: 'delete',
        path: `/attribute-groups/${BAD}/options/${VALID}`,
      },
      {
        label: 'DELETE /attribute-groups/:id/options/:optId — bozuk :optId',
        method: 'delete',
        path: `/attribute-groups/${VALID}/options/${BAD}`,
      },
      // --- /menu/categories/:id/attribute-groups ---
      {
        label: 'GET /menu/categories/:id/attribute-groups',
        method: 'get',
        path: `/menu/categories/${BAD}/attribute-groups`,
      },
      {
        label: 'POST /menu/categories/:id/attribute-groups/:groupId — bozuk :id',
        method: 'post',
        path: `/menu/categories/${BAD}/attribute-groups/${VALID}`,
      },
      {
        label: 'POST /menu/categories/:id/attribute-groups/:groupId — bozuk :groupId',
        method: 'post',
        path: `/menu/categories/${VALID}/attribute-groups/${BAD}`,
      },
      {
        label: 'DELETE /menu/categories/:id/attribute-groups/:groupId — bozuk :id',
        method: 'delete',
        path: `/menu/categories/${BAD}/attribute-groups/${VALID}`,
      },
      {
        label: 'DELETE /menu/categories/:id/attribute-groups/:groupId — bozuk :groupId',
        method: 'delete',
        path: `/menu/categories/${VALID}/attribute-groups/${BAD}`,
      },
      // --- /products/:id/attribute-groups ---
      {
        label: 'GET /products/:id/attribute-groups',
        method: 'get',
        path: `/products/${BAD}/attribute-groups`,
      },
      {
        label: 'GET /products/:id/attribute-groups/effective',
        method: 'get',
        path: `/products/${BAD}/attribute-groups/effective`,
      },
      {
        label: 'GET /products/:id/attribute-groups/effective-with-options',
        method: 'get',
        path: `/products/${BAD}/attribute-groups/effective-with-options`,
      },
      {
        label: 'POST /products/:id/attribute-groups/:groupId — bozuk :id',
        method: 'post',
        path: `/products/${BAD}/attribute-groups/${VALID}`,
      },
      {
        label: 'POST /products/:id/attribute-groups/:groupId — bozuk :groupId',
        method: 'post',
        path: `/products/${VALID}/attribute-groups/${BAD}`,
      },
      {
        label: 'DELETE /products/:id/attribute-groups/:groupId — bozuk :id',
        method: 'delete',
        path: `/products/${BAD}/attribute-groups/${VALID}`,
      },
      {
        label: 'DELETE /products/:id/attribute-groups/:groupId — bozuk :groupId',
        method: 'delete',
        path: `/products/${VALID}/attribute-groups/${BAD}`,
      },
    ];

    it.each(cases)(
      'bozuk UUID → 400 VALIDATION_ERROR: $label',
      async ({ method, path, body }) => {
        const req = request(ctx.app!)
          [method](path)
          .set('Authorization', `Bearer ${ctx.adminToken!}`);
        const res = body === undefined ? await req : await req.send(body);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      },
    );

    it('geçerli UUID doğrulamaya takılmaz — var olan grup okunur (200)', async () => {
      const created = await request(ctx.app!)
        .post('/attribute-groups')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: `Boy-${randomUUID().slice(0, 8)}`, selectionType: 'single' });
      expect(created.status).toBe(201);
      const groupId = created.body.data.group.id as string;

      const read = await request(ctx.app!)
        .get(`/attribute-groups/${groupId}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(read.status).toBe(200);
      expect(read.body.data.group.id).toBe(groupId);
    });

    it('geçerli ama var olmayan UUID → 404 (400 DEĞİL)', async () => {
      const res = await request(ctx.app!)
        .get(`/attribute-groups/${randomUUID()}`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`);
      expect(res.status).toBe(404);
    });

    it('geçerli gövde + geçerli UUID ile option oluşturulur (regresyon kontrolü)', async () => {
      const created = await request(ctx.app!)
        .post('/attribute-groups')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ name: `Pisme-${randomUUID().slice(0, 8)}`, selectionType: 'single' });
      expect(created.status).toBe(201);
      const groupId = created.body.data.group.id as string;

      const opt = await request(ctx.app!)
        .post(`/attribute-groups/${groupId}/options`)
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send(OK_OPTION_BODY);
      expect(opt.status).toBe(201);
      expect(opt.body.data.option.name).toBe(OK_OPTION_BODY.name);
    });
  },
);
