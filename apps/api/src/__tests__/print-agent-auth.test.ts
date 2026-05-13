import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';
import type { Express } from 'express';
import { buildApp } from '../app';

/**
 * ADR-004 §Amendment 2 (Session 62 PR-3a) — Print Agent auth backbone
 * integration tests.
 *
 * Kapsam (8 case, decisions.md ADR-004 §Amendment 2 §6 sözleşmesi):
 *   1. POST /agent/register success → 200 + JWT + agents row
 *   2. POST /agent/register invalid apiKey → 401 AUTH_INVALID_CREDENTIALS
 *   3. POST /agent/register idempotent (same fingerprint same tenant) → aynı agentId
 *   4. POST /agent/register cross-tenant fingerprint → 409 AGENT_FINGERPRINT_CONFLICT
 *   5. POST /agent/refresh success → 200 + rotated tokens + agentId aynı
 *   6. POST /agent/refresh expired → 401 AUTH_REFRESH_INVALID
 *   7. POST /agent/refresh revoked agent → 401 AGENT_REVOKED
 *   8. requireAgentJwt regression: GET /jobs/next Bearer JWT → 204 (auth geçti)
 *
 * Strateji: 2 tenant seed (PRIMARY + OTHER, cross-tenant case için);
 * primary tenant'a 1 baz agent (revoke + expired senaryoları). beforeEach
 * agents temizler ve baz agent'i yeniden ekler — testler birbirinden bağımsız.
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';

const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const TENANT_SHORT = TENANT_ID.replace(/-/g, '').slice(0, 8);
const OTHER_SHORT = OTHER_TENANT_ID.replace(/-/g, '').slice(0, 8);

// Plaintext API keys — register endpoint bunları bcrypt.compare ile bulur.
const PRIMARY_API_KEY = `pk_${TENANT_SHORT}_primary-fixture-key-12345`;
const OTHER_API_KEY = `pk_${OTHER_SHORT}_other-fixture-key-67890`;

interface TestCtx {
  pool: Pool;
  db: Kysely<DB>;
  app: Express;
  primaryHash: string;
  otherHash: string;
}

const ctx: Partial<TestCtx> = {};

// Suite scope sabitleri — beforeEach baz agent'i bu id ile yeniden ekler;
// refresh/revoke testleri bu agent'a referans verir.
const BASE_AGENT_ID = randomUUID();
const BASE_FINGERPRINT = `fp-base-${BASE_AGENT_ID.slice(0, 8)}`;

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'Print Agent auth backbone (ADR-004 §Amendment 2)',
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
        agentSecret: AGENT_SECRET,
        tenantId: TENANT_ID,
        webOrigin: 'http://localhost:5173',
      });

      await db
        .insertInto('tenants')
        .values([
          {
            id: TENANT_ID,
            name: 'Test Tenant Auth Primary',
            slug: `test-auth-${TENANT_SHORT}`,
          },
          {
            id: OTHER_TENANT_ID,
            name: 'Test Tenant Auth Other',
            slug: `test-auth-${OTHER_SHORT}`,
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();

      // Plaintext API key → bcrypt hash (cost 12). Suite scope'unda sabit;
      // her register testi aynı hash'i kullanır (lookup match doğrulamak için).
      ctx.primaryHash = await bcrypt.hash(PRIMARY_API_KEY, 12);
      ctx.otherHash = await bcrypt.hash(OTHER_API_KEY, 12);
    });

    beforeEach(async () => {
      if (ctx.db === undefined) return;
      // Test bağımsızlığı: agents temizle + baz agent'i ekle. Baz agent
      // (BASE_AGENT_ID) refresh/revoke testlerinde kullanılır; register
      // testleri kendi agent row'larını üretir (idempotent + new fingerprint).
      await ctx.db
        .deleteFrom('agents')
        .where('tenant_id', 'in', [TENANT_ID, OTHER_TENANT_ID])
        .execute();

      await ctx.db
        .insertInto('agents')
        .values({
          id: BASE_AGENT_ID,
          tenant_id: TENANT_ID,
          device_fingerprint: BASE_FINGERPRINT,
          api_key_hash: ctx.primaryHash!,
        })
        .execute();
    });

    afterAll(async () => {
      if (ctx.db !== undefined) {
        await ctx.db
          .deleteFrom('agents')
          .where('tenant_id', 'in', [TENANT_ID, OTHER_TENANT_ID])
          .execute();
        await ctx.db
          .deleteFrom('print_jobs')
          .where('tenant_id', 'in', [TENANT_ID, OTHER_TENANT_ID])
          .execute();
        await ctx.db
          .deleteFrom('tenant_settings')
          .where('tenant_id', 'in', [TENANT_ID, OTHER_TENANT_ID])
          .execute();
        await ctx.db
          .deleteFrom('tenants')
          .where('id', 'in', [TENANT_ID, OTHER_TENANT_ID])
          .execute();
        await ctx.db.destroy();
      }
    });

    // ── 1. POST /agent/register success ────────────────────────────────────
    it('POST /agent/register success → 200 + JWT + agents row', async () => {
      const fp = `fp-success-${randomUUID()}`;
      const res = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({ apiKey: PRIMARY_API_KEY, deviceFingerprint: fp });

      expect(res.status).toBe(200);
      expect(typeof res.body.agentId).toBe('string');
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');

      const row = await ctx.db!
        .selectFrom('agents')
        .select(['id', 'tenant_id', 'device_fingerprint'])
        .where('id', '=', res.body.agentId)
        .executeTakeFirst();
      expect(row?.tenant_id).toBe(TENANT_ID);
      expect(row?.device_fingerprint).toBe(fp);

      // Token üzerinden requireAgentJwt geçtiğini doğrula (regression).
      const decoded = jwt.verify(res.body.accessToken, AGENT_SECRET) as jwt.JwtPayload;
      expect(decoded['type']).toBe('agent');
      expect(decoded['tid']).toBe(TENANT_ID);
      expect(decoded['sub']).toBe(res.body.agentId);
    });

    // ── 2. POST /agent/register invalid apiKey ─────────────────────────────
    it('POST /agent/register invalid apiKey → 401 AUTH_INVALID_CREDENTIALS', async () => {
      const res = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({
          apiKey: `pk_${TENANT_SHORT}_wrong-secret-no-bcrypt-match`,
          deviceFingerprint: `fp-invalid-${randomUUID()}`,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    // ── 3. POST /agent/register idempotent ─────────────────────────────────
    it('POST /agent/register idempotent (same fingerprint same tenant) → aynı agentId', async () => {
      const fp = `fp-idem-${randomUUID()}`;
      const r1 = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({ apiKey: PRIMARY_API_KEY, deviceFingerprint: fp });
      expect(r1.status).toBe(200);
      const id1 = r1.body.agentId;

      const r2 = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({ apiKey: PRIMARY_API_KEY, deviceFingerprint: fp });
      expect(r2.status).toBe(200);
      expect(r2.body.agentId).toBe(id1);

      // DB'de tek satır (UNIQUE(tenant_id, device_fingerprint) garanti).
      const rows = await ctx.db!
        .selectFrom('agents')
        .select(['id'])
        .where('tenant_id', '=', TENANT_ID)
        .where('device_fingerprint', '=', fp)
        .execute();
      expect(rows).toHaveLength(1);
    });

    // ── 4. POST /agent/register cross-tenant fingerprint ───────────────────
    it('POST /agent/register cross-tenant fingerprint → 409 AGENT_FINGERPRINT_CONFLICT', async () => {
      // Baz tenant'a aynı fingerprint'i kayıt et — sonra OTHER tenant'tan
      // aynı fingerprint ile register → 409.
      const fp = `fp-conflict-${randomUUID()}`;
      const r1 = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({ apiKey: PRIMARY_API_KEY, deviceFingerprint: fp });
      expect(r1.status).toBe(200);

      // OTHER tenant'ın baz agent'i — bcrypt match için DB'ye ekle.
      await ctx.db!
        .insertInto('agents')
        .values({
          id: randomUUID(),
          tenant_id: OTHER_TENANT_ID,
          device_fingerprint: `fp-other-base-${randomUUID()}`,
          api_key_hash: ctx.otherHash!,
        })
        .execute();

      const r2 = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({ apiKey: OTHER_API_KEY, deviceFingerprint: fp });

      expect(r2.status).toBe(409);
      expect(r2.body.error.code).toBe('AGENT_FINGERPRINT_CONFLICT');
    });

    // ── 5. POST /agent/refresh success ─────────────────────────────────────
    it('POST /agent/refresh success → 200 + rotated tokens + agentId aynı', async () => {
      // Önce register et — refresh token'ı al.
      const reg = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({
          apiKey: PRIMARY_API_KEY,
          deviceFingerprint: `fp-refresh-${randomUUID()}`,
        });
      expect(reg.status).toBe(200);
      const oldRefresh = reg.body.refreshToken;
      const agentId = reg.body.agentId;

      const res = await request(ctx.app!)
        .post('/print/v1/agent/refresh')
        .send({ refreshToken: oldRefresh });

      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');

      const decoded = jwt.verify(res.body.accessToken, AGENT_SECRET) as jwt.JwtPayload;
      expect(decoded['sub']).toBe(agentId);
      expect(decoded['type']).toBe('agent');
      expect(decoded['tid']).toBe(TENANT_ID);
    });

    // ── 6. POST /agent/refresh expired ─────────────────────────────────────
    it('POST /agent/refresh expired → 401 AUTH_REFRESH_INVALID', async () => {
      // Manuel expired refresh token: exp = now - 1s
      const expiredToken = jwt.sign(
        {
          type: 'agent_refresh',
          tid: TENANT_ID,
          // jsonwebtoken: exp `iat + ttl`. Custom iat + negative expiresIn
          // tutarsız olabilir; en sade yol: doğrudan exp claim.
          exp: Math.floor(Date.now() / 1000) - 60,
          iat: Math.floor(Date.now() / 1000) - 120,
        },
        AGENT_SECRET,
        {
          algorithm: 'HS256',
          subject: BASE_AGENT_ID,
          jwtid: randomUUID(),
        },
      );

      const res = await request(ctx.app!)
        .post('/print/v1/agent/refresh')
        .send({ refreshToken: expiredToken });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REFRESH_INVALID');
    });

    // ── 7. POST /agent/refresh revoked agent ───────────────────────────────
    it('POST /agent/refresh revoked agent → 401 AGENT_REVOKED', async () => {
      // BASE_AGENT_ID için geçerli refresh token üret, sonra agents.revoked_at
      // SET et → refresh denenince 401 AGENT_REVOKED.
      const refreshToken = jwt.sign(
        { type: 'agent_refresh', tid: TENANT_ID },
        AGENT_SECRET,
        {
          algorithm: 'HS256',
          expiresIn: '30d',
          subject: BASE_AGENT_ID,
          jwtid: randomUUID(),
        },
      );

      await ctx.db!
        .updateTable('agents')
        .set({ revoked_at: new Date(), revoke_reason: 'test revoke' })
        .where('id', '=', BASE_AGENT_ID)
        .execute();

      const res = await request(ctx.app!)
        .post('/print/v1/agent/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AGENT_REVOKED');
    });

    // ── 8. requireAgentJwt regression ──────────────────────────────────────
    it('requireAgentJwt regression: GET /jobs/next Bearer JWT → 204 (auth geçti, kuyruk boş)', async () => {
      // print_jobs temizle (queued job kalıntısı 200'e dönüştürmesin).
      await ctx.db!
        .deleteFrom('print_jobs')
        .where('tenant_id', '=', TENANT_ID)
        .execute();

      const token = jwt.sign(
        { type: 'agent', tid: TENANT_ID },
        AGENT_SECRET,
        {
          algorithm: 'HS256',
          expiresIn: '1h',
          subject: BASE_AGENT_ID,
          jwtid: randomUUID(),
        },
      );

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=0')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);
    });
  },
);
