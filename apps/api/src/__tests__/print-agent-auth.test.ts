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
import { sql } from 'kysely';
import { buildApp } from '../app';
import { createAppTenantPool } from './helpers/appTenantPool';

/**
 * ADR-004 §Amendment 2 (Session 62 PR-3a) — Print Agent auth backbone
 * integration tests.
 *
 * Kapsam (10 case, decisions.md ADR-004 §Amendment 2 §6 sözleşmesi
 * + ADR-041 Amendment 7 K4/K6 güncellemeleri):
 *   0. ROL TEYİDİ: app pool gerçekten `app_tenant` altında (sahte-yeşil kapısı)
 *   1. POST /agent/register success → 200 + JWT + agents row
 *   2. POST /agent/register invalid apiKey → 401 AUTH_INVALID_CREDENTIALS
 *   3. POST /agent/register idempotent (same fingerprint same tenant) → aynı agentId
 *   4. POST /agent/register başka tenant'ta kayıtlı fingerprint → **BAŞARILI**
 *      (eskiden 409 AGENT_FINGERPRINT_CONFLICT; Amd7 K6 ile oracle kapatıldı)
 *   4b. POST /agent/register prefix uyuşmazlığı → 401 AUTH_INVALID_CREDENTIALS
 *      (Amd7 K4(2): tenant sunucu sabitinden çözülür, istemciden ÖĞRENİLMEZ)
 *   5. POST /agent/refresh success → 200 + rotated tokens + agentId aynı
 *   6. POST /agent/refresh expired → 401 AUTH_REFRESH_INVALID
 *   7. POST /agent/refresh revoked agent → 401 AGENT_REVOKED
 *   8. requireAgentJwt regression: GET /jobs/next Bearer JWT → 204 (auth geçti)
 *
 * Strateji: 2 tenant seed (PRIMARY + OTHER, cross-tenant case için);
 * primary tenant'a 1 baz agent (revoke + expired senaryoları). beforeEach
 * agents temizler ve baz agent'i yeniden ekler — testler birbirinden bağımsız.
 *
 * ⚠️ ADR-041 Amd7 K7 — `agents` force-RLS altına alındı (mig 064). App bu
 * testlerde `app_tenant` (NOBYPASSRLS) altında koşar; aksi halde süperuser
 * RLS'i bypass eder ve sarılmamış bir call-site MASKELENİR (sahte-yeşil; S134'te
 * tam olarak bu yaşandı). Fixture/seed süperuser `pool`/`db` ile kalır — yalnız
 * `buildApp`'e verilen pool `appPool`'dur. Bu dosya üç sarımın negatif
 * kontrolüdür: middleware agent lookup, register akışı, refresh lookup.
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
  /** ADR-041 Amd7 K7 — app'in koştuğu `app_tenant` (NOBYPASSRLS) pool'u. */
  appPool: Pool;
  appDb: Kysely<DB>;
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
      // ADR-041 Amd7 K7 — app app_tenant (NOBYPASSRLS) altında; seed superuser db.
      const appPool = createAppTenantPool(DB_URL ?? '');
      const appDb = createKysely(appPool);
      ctx.appPool = appPool;
      ctx.appDb = appDb;
      ctx.app = buildApp({
        pool: appPool,
        db: appDb,
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
      if (ctx.appDb !== undefined) {
        await ctx.appDb.destroy();
      }
    });

    // ── 0. ROL TEYİDİ (ADR-041 Amd7 K7 ek kural 1) ─────────────────────────
    // `SET LOCAL ROLE` transaction DIŞINDA sessizce etkisizdir; bu pool rolü
    // connect-time option'ı (`-c role=app_tenant`) ile düşürür. Assert'lerden
    // ÖNCE bunu doğrulamazsak tüm dosya süperuser altında koşup sahte-yeşil
    // olabilir (S134'te üç kez yaşandı).
    it('ROL TEYİDİ: app pool current_user = app_tenant (sahte-yeşil kapısı)', async () => {
      const r = await sql<{ u: string }>`select current_user as u`.execute(
        ctx.appDb!,
      );
      expect(r.rows[0]?.u).toBe('app_tenant');
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

    // ── 4. Başka tenant'ta kayıtlı fingerprint → BAŞARILI (Amd7 K6) ────────
    it('POST /agent/register başka tenant\'ta kayıtlı fingerprint → BAŞARILI (409 DEĞİL — oracle kapandı)', async () => {
      // DAVRANIŞ DEĞİŞİKLİĞİ (ADR-041 Amd7 K6): eskiden 409
      // AGENT_FINGERPRINT_CONFLICT dönerdi ve bu fark, geçerli apiKey taşıyan
      // çağırana "bu cihaz başka bir tenant'ta kayıtlı" bilgisini sızdıran bir
      // oracle'dı. Artık sorgu kendi tenant'ına daraldı; aynı fiziksel PC
      // meşru olarak iki işletmeye hizmet edebilir ve DB kısıtı bunu zaten
      // öngörmüştür — `UNIQUE (tenant_id, device_fingerprint)`, global DEĞİL.
      const fp = `fp-shared-${randomUUID()}`;

      // OTHER tenant'ta aynı fingerprint'i süperuser ile kayıt et (seed —
      // app'in kendi tenant'ı dışına yazması artık RLS ile de imkânsız).
      await ctx.db!
        .insertInto('agents')
        .values({
          id: randomUUID(),
          tenant_id: OTHER_TENANT_ID,
          device_fingerprint: fp,
          api_key_hash: ctx.otherHash!,
        })
        .execute();

      // PRIMARY tenant aynı fingerprint ile register → 200 + YENİ satır.
      const res = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({ apiKey: PRIMARY_API_KEY, deviceFingerprint: fp });

      expect(res.status).toBe(200);
      expect(typeof res.body.agentId).toBe('string');

      const row = await ctx.db!
        .selectFrom('agents')
        .select(['id', 'tenant_id'])
        .where('id', '=', res.body.agentId)
        .executeTakeFirst();
      expect(row?.tenant_id).toBe(TENANT_ID);

      // İki tenant'ta YAN YANA iki satır — 23505 yok.
      const rows = await ctx.db!
        .selectFrom('agents')
        .select(['tenant_id'])
        .where('device_fingerprint', '=', fp)
        .execute();
      expect(rows).toHaveLength(2);
    });

    // ── 4b. Prefix uyuşmazlığı → 401 (Amd7 K4(2)) ──────────────────────────
    it('POST /agent/register başka tenant\'ın apiKey prefix\'i → 401 AUTH_INVALID_CREDENTIALS', async () => {
      // Sunucu tenant'ı `deps.tenantId` sabitidir (buildApp'e TENANT_ID
      // verildi). OTHER tenant'ın geçerli apiKey'i ve DB'de geçerli bir agent
      // satırı olsa bile, prefix sunucu sabitiyle eşleşmediği için akış
      // bcrypt'e hiç ulaşmaz → MEVCUT 401. Yeni hata kodu yok, yeni oracle yok
      // (prefix uyuşmazlığı ile parola uyuşmazlığı ayırt edilemez).
      await ctx.db!
        .insertInto('agents')
        .values({
          id: randomUUID(),
          tenant_id: OTHER_TENANT_ID,
          device_fingerprint: `fp-other-base-${randomUUID()}`,
          api_key_hash: ctx.otherHash!,
        })
        .execute();

      const res = await request(ctx.app!)
        .post('/print/v1/agent/register')
        .send({
          apiKey: OTHER_API_KEY,
          deviceFingerprint: `fp-prefix-mismatch-${randomUUID()}`,
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
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

    // ── 9. last_seen_at fire-and-forget yazımı (ADR-041 Amd7 K3/K5) ────────
    it('last_seen_at poll sonrası DB\'de dolar (fire-and-forget sarımı canlı)', async () => {
      // Bu test `print-agent-auth.ts`'teki `last_seen_at` UPDATE sarımının
      // negatif kontrolüdür: sarım sökülürse app_tenant altında 42501 alır,
      // `catch` artık yutmadığı için logger/Sentry'ye düşer ve `last_seen_at`
      // NULL kalır → test KIRMIZI. Eskiden bu site hiçbir testte ölçülmüyordu
      // (gözlem alanı olduğu için) — tam olarak F4e'nin sessiz yüzeyi.
      // Ayrıca K3'ün bug düzeltmesini de örtük sınar: UPDATE artık
      // `tenant_id` yüklemlidir ve kendi tenant'ında ÇALIŞMALIDIR.
      const token = jwt.sign({ type: 'agent', tid: TENANT_ID }, AGENT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '1h',
        subject: BASE_AGENT_ID,
        jwtid: randomUUID(),
      });

      const before = await ctx.db!
        .selectFrom('agents')
        .select('last_seen_at')
        .where('id', '=', BASE_AGENT_ID)
        .executeTakeFirst();
      expect(before?.last_seen_at).toBeNull();

      const res = await request(ctx.app!)
        .get('/print/v1/jobs/next?wait=0')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);

      // fire-and-forget → kısa poll ile bekle (printers.test.ts deseni).
      let lastSeen: Date | null = null;
      for (let i = 0; i < 20; i++) {
        const row = await ctx.db!
          .selectFrom('agents')
          .select('last_seen_at')
          .where('id', '=', BASE_AGENT_ID)
          .executeTakeFirst();
        lastSeen = row?.last_seen_at ?? null;
        if (lastSeen !== null) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(lastSeen).not.toBeNull();
    });
  },
);
