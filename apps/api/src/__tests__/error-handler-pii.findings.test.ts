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
 * Deep-audit Blok 4 Hat C — KASITLI KIRMIZI bulgu testleri.
 *
 * Blok 3 DB-SEC-01'in "response body'ye sızıyor mu?" sorusunu apps/api
 * HTTP katmanında UÇTAN UCA doğrular: gerçek `pos_test`'e karşı POST /users'ı
 * aynı email ile 2 kez çağırıp 409 yanıtının GERÇEK gövdesini denetler.
 *
 * Kök neden: `packages/db/src/errors.ts` `mapPgError()` 23505 için
 * `pgErr.detail`'i (ham Postgres "Key (tenant_id, email)=(<uuid>, EMAIL)
 * already exists." string'i) filtresiz `RepositoryError.detail`'e taşır;
 * `apps/api/src/errors.ts` `toHttpError()`'ın `'unique'` dalı bunu
 * `body.error.details.field`'e AYNEN kopyalar. `apps/api/src/routes/users.ts`
 * POST /users bu RepositoryError'ı `catch (err) { return next(err); }` ile
 * HİÇ MÜDAHALE ETMEDEN iletir (ADR-016 §11 customers/index.ts'teki
 * PHONE_ALREADY_EXISTS güvenli-intercept paterninin AKSİNE).
 *
 * Bu test bugün KIRMIZI. Fix: users.ts POST /users içinde 23505/email
 * çakışmasını customers/index.ts paterniyle intercept edip `domainError(...)`
 * ile (detail YOK) next() etmek — ya da `toHttpError`'ın 'unique' dalından
 * `details.field` alanını tamamen kaldırmak (tüm route'lar için kalıcı kapanış).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';

const TENANT_ID = randomUUID();
const ADMIN_ID = randomUUID();
const ADMIN_EMAIL = `pii-admin-${randomUUID()}@example.com`;
const ADMIN_PASSWORD = 'adminpass1234';
const ADMIN_USERNAME = `pii-admin-${randomUUID().slice(0, 8)}`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  adminToken: string;
}
const ctx: Partial<TestCtx> = {};
let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.113.${(ipCounter % 254) + 1}`;
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'BULGU API-CORE-01 — RepositoryError(unique) response body PII sızıntısı (Blok 4 Hat C)',
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
        .values({ id: TENANT_ID, name: 'PII Findings Tenant', slug: `pii-${TENANT_ID.slice(0, 8)}` })
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

      const login = await request(ctx.app)
        .post('/auth/login')
        .set('X-Forwarded-For', uniqueIp())
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      ctx.adminToken = login.body.accessToken as string;
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('refresh_tokens').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('users').where('tenant_id', '=', TENANT_ID).execute();
        await ctx.db.deleteFrom('tenants').where('id', '=', TENANT_ID).execute();
        await ctx.db.destroy();
      }
    });

    it('API-CORE-01 [BLOCKER] [SEC/KVKK]: POST /users duplicate email → 409 response body EMAIL İÇERMEMELİ', async () => {
      // Gerçekçi ama sahte e-posta — gerçek kişi verisi DEĞİL (fake test PII).
      const dupEmail = `pii-leak-victim-${randomUUID()}@example.com`;

      const first = await request(ctx.app!)
        .post('/users')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ email: dupEmail, password: 'validpass1234', role: 'waiter', name: 'Ayşe Yılmaz' });
      expect(first.status).toBe(201);

      const second = await request(ctx.app!)
        .post('/users')
        .set('Authorization', `Bearer ${ctx.adminToken!}`)
        .send({ email: dupEmail, password: 'validpass1234', role: 'waiter', name: 'Ayşe Yılmaz 2' });
      expect(second.status).toBe(409);

      const bodyText = JSON.stringify(second.body);
      // DOĞRU davranış: yanıt gövdesi kullanıcının e-posta adresini asla
      // içermemeli (KVKK + ADR-006 ErrorEnvelope — details client-safe olmalı).
      // BUGÜN KIRMIZI: `toHttpError`'ın 'unique' dalı ham pg `detail`'i
      // `details.field`'e kopyalıyor → email literal olarak sızıyor.
      expect(bodyText).not.toContain(dupEmail);
    });

    it('API-CORE-02 [MEDIUM] [BUG]: authenticate/authorize middleware envelope — message_key ALANI EKSİK (ADR-006 ErrorEnvelope ihlali)', async () => {
      // `middleware/authenticate.ts` + `middleware/authorize.ts` `toHttpError`'ı
      // HİÇ ÇAĞIRMAZ — res.status(401/403).json({error:{code}}) DOĞRUDAN yazar.
      // `ErrorEnvelope.error.message_key` tip tanımında ZORUNLU (`string`,
      // opsiyonel değil) — UI `t(error.message_key)` çağırdığında `undefined`
      // alır. Tüm authenticate/authorize korumalı route'ları (orders, payments,
      // menu, products, tables, areas, users, kds, settings, attribute-groups)
      // bu bypass'tan etkilenir.
      const res = await request(ctx.app!).get('/auth/me'); // token yok → authenticate 401
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_TOKEN_INVALID');
      // DOĞRU davranış: message_key her zaman string olmalı (ADR-006 §2).
      // BUGÜN KIRMIZI: alan tamamen YOK (undefined).
      expect(res.body.error.message_key).toEqual(expect.any(String));
    });
  },
);
