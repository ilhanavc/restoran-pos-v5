import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';
import { hashPassword } from '../auth/password';

/**
 * KASITLI KIRMIZI — API-CORE-01 (response-PII), Blok 6 Hat C devir maddesi.
 *
 * Kök neden (kod okuması, apps/api/src/errors.ts:226-240 + packages/db/src/errors.ts:68-69):
 *   `mapPgError` 23505 (unique_violation) için `RepositoryError('unique', undefined,
 *   pgErr.detail)` üretir — `pgErr.detail` PostgreSQL'in HAM hata metnidir, örn:
 *   `Key (tenant_id, lower(email::text))=(<uuid>, kirmizi@ornek.com) already exists.`
 *   `toHttpError`'ın `case 'unique'` dalı bu HAM metni doğrudan
 *   `details.field`'a koyar:
 *     details: { field: err.detail }
 *   → 409 response body'sinde ham e-posta + iç SQL ifadesi (`lower(email::text)`,
 *   index/constraint yapısı) DÖNÜYOR. Bu davranış `users.ts` POST /users route'unda
 *   `catch (err) { return next(err); }` ile hiçbir ek sanitize olmadan bu path'e düşer.
 *
 * Bu test BİLİNÇLİ OLARAK KIRMIZI bırakılmıştır — "response body ham e-posta
 * içermemeli" invariantını kodlar; bugünkü davranış bunu ihlal ediyor.
 * Fix (implementer'a devir): `toHttpError` 'unique' dalında `details.field`'ı
 * ham `err.detail` yerine sanitize edilmiş bir şema kullanmalı (örn. yalnız
 * ihlal edilen mantıksal alan adı `'email'`, DEĞER YOK) — veya `RepositoryError`
 * hiç `detail` taşımamalı, yalnız `messageKey` taşımalı.
 *
 * NOT: Bu aynı `mapPgError`/`toHttpError` kod yolu TÜM unique-constraint
 * hatalarında (customers.phone, attribute_groups.name, tables.code, vb.)
 * paylaşılıyor — kök neden tek nokta, fix tek nokta düzeltir (root-cause fix).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `api-core-01-admin-${randomUUID()}@example.com`;
const ADMIN_USERNAME = `api-core-01-admin-${randomUUID().slice(0, 8)}`;
const ADMIN_PASSWORD = 'adminpass1234';

const DUPLICATE_EMAIL = `kirmizi-${randomUUID().slice(0, 8)}@ornek.com`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
}

const ctx: Partial<TestCtx> = {};

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'API-CORE-01 — POST /users duplicate email response-PII (KASITLI KIRMIZI)',
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
          name: 'API-CORE-01 Test Tenant',
          slug: `api-core-01-${TENANT_ID.slice(0, 8)}`,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto('tenant_settings')
        .values({ tenant_id: TENANT_ID })
        .onConflict((oc) => oc.doNothing())
        .execute();

      const adminHash = await hashPassword(ADMIN_PASSWORD);
      await db
        .insertInto('users')
        .values({
          id: ADMIN_ID,
          tenant_id: TENANT_ID,
          email: ADMIN_EMAIL,
          username: ADMIN_USERNAME,
          password_hash: adminHash,
          role: 'admin',
        })
        .execute();

      const loginRes = await request(ctx.app)
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.201')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      if (loginRes.status !== 200) {
        throw new Error(`login failed: ${JSON.stringify(loginRes.body)}`);
      }
      ctx.adminToken = loginRes.body.accessToken as string;
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('audit_logs')
          .where('tenant_id', '=', TENANT_ID)
          .execute();
        await ctx.db
          .deleteFrom('refresh_tokens')
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

    it('API-CORE-01: duplicate email POST /users → 409 response body ham e-posta İÇERMEMELİ (bugün içeriyor → KIRMIZI)', async () => {
      const first = await request(ctx.app!)
        .post('/users')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          email: DUPLICATE_EMAIL,
          password: 'pass1234567',
          role: 'cashier',
          name: 'İlk Kullanıcı',
        });
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/users')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({
          email: DUPLICATE_EMAIL,
          password: 'anotherpass123',
          role: 'waiter',
          name: 'İkinci Kullanıcı',
        });

      expect(second.status).toBe(409);

      const raw = JSON.stringify(second.body);
      // Invariant: response body ham e-posta adresini SIZDIRMAMALI. Bugünkü
      // davranış `errors.ts` toHttpError 'unique' dalında `details.field =
      // err.detail` (ham Postgres detail metni) koyduğu için bu assertion
      // KIRMIZI düşer — kanıt aşağıdaki `raw` içeriğidir.
      expect(raw).not.toContain(DUPLICATE_EMAIL);
    });
  },
);
