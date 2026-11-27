import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import { createPool, createKysely, withTenant, type DB } from '@restoran-pos/db';
import { sql, type Kysely } from 'kysely';
import type { Express } from 'express';
import { createAppTenantPool } from './helpers/appTenantPool';
import { buildApp } from '../app';
import { logger } from '../logger.js';

/**
 * ADR-052 PR-2 — tenant-bound Caller ID bridge key (`cb1_`), K1 + K2 + K6.
 *
 * Harness (ADR-041 F4a): the app runs under the `app_tenant` pool so the
 * force-RLS on `caller_bridge_keys` really bites — an unwrapped repository
 * call returns 0 rows and the success tests go RED. Fixtures are written with
 * the superuser pool (keys seeded as raw SHA-256 hashes).
 */

const DB_URL = process.env['DATABASE_URL'];
const ACCESS_SECRET = 'test-secret-min-32-chars-please-be-long-enough';
const AGENT_SECRET = 'test-agent-secret-min-32-chars-please-long';
const LEGACY_TOKEN = 'test-legacy-bridge-token-shared';

const TENANT_A = randomUUID(); // live tenant (API TENANT_ID)
const TENANT_B = randomUUID();
const TENANT_DELETED = randomUUID();
const ALL_TENANTS = [TENANT_A, TENANT_B, TENANT_DELETED];

const INVALID_BODY = { error: { code: 'BRIDGE_TOKEN_INVALID' } };

function makeKey(tenantId: string): string {
  return `cb1_${tenantId.replace(/-/g, '')}_${randomBytes(32).toString('base64url')}`;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function uniquePhone(): string {
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += String(Math.floor(Math.random() * 10));
  return `0539${suffix}`;
}

interface Ctx {
  db: Kysely<DB>;
  appDb: Kysely<DB>;
  app: Express;
}
const ctx: Partial<Ctx> = {};

function appOptions(appDb: Kysely<DB>, appPool: ReturnType<typeof createAppTenantPool>, bridgeToken: string) {
  return {
    pool: appPool,
    db: appDb,
    accessSecret: ACCESS_SECRET,
    agentSecret: AGENT_SECRET,
    tenantId: TENANT_A,
    webOrigin: 'http://localhost:5173',
    bridgeToken,
  };
}

async function seedKey(
  tenantId: string,
  opts: { validUntil?: string; revoked?: boolean } = {},
): Promise<{ key: string; id: string }> {
  const key = makeKey(tenantId);
  const id = randomUUID();
  await ctx.db!
    .insertInto('caller_bridge_keys')
    .values({
      id,
      tenant_id: tenantId,
      key_hash: sha256(key),
      valid_until:
        opts.validUntil === undefined ? null : sql<Date>`now() + ${opts.validUntil}::interval`,
      revoked_at: opts.revoked === true ? sql<Date>`now()` : null,
      revoke_reason: opts.revoked === true ? 'test' : null,
    })
    .execute();
  return { key, id };
}

async function callLogCount(tenantId: string, phone: string): Promise<number> {
  const row = await ctx.db!
    .selectFrom('call_logs')
    .select((eb) => eb.fn.countAll<string>().as('c'))
    .where('tenant_id', '=', tenantId)
    .where('normalized_phone', '=', phone)
    .executeTakeFirstOrThrow();
  return Number(row.c);
}

async function lastUsed(id: string): Promise<Date | null> {
  const row = await ctx.db!
    .selectFrom('caller_bridge_keys')
    .select('last_used_at')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row.last_used_at;
}

function post(app: Express, token: string, tenantHeader: string | null, phone: string) {
  let r = request(app).post('/bridge/caller-id/incoming').set('X-Bridge-Token', token);
  if (tenantHeader !== null) r = r.set('X-Tenant-Id', tenantHeader);
  return r.send({ rawPhone: phone, receivedAt: new Date().toISOString() });
}

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)(
  'ADR-052 PR-2 — cb1_ tenant-bound bridge key',
  () => {
    const logSpies: MockInstance[] = [];

    beforeAll(async () => {
      const pool = createPool({ connectionString: DB_URL ?? '' });
      ctx.db = createKysely(pool);
      const appPool = createAppTenantPool(DB_URL ?? '');
      ctx.appDb = createKysely(appPool);
      ctx.app = buildApp(appOptions(ctx.appDb, appPool, LEGACY_TOKEN));

      await ctx.db
        .insertInto('tenants')
        .values(
          ALL_TENANTS.map((id, i) => ({
            id,
            name: `Test Bridge Key ${i}`,
            slug: `test-cbk-${i}-${id.slice(0, 8)}`,
          })),
        )
        .execute();
      await ctx.db
        .updateTable('tenants')
        .set({ deleted_at: sql<Date>`now()` })
        .where('id', '=', TENANT_DELETED)
        .execute();
      await ctx.db
        .insertInto('tenant_settings')
        .values(ALL_TENANTS.map((tenant_id) => ({ tenant_id, caller_id_bypass_patterns: ['^0850'] })))
        .onConflict((oc) => oc.doNothing())
        .execute();

      for (const method of ['info', 'warn', 'error'] as const) {
        logSpies.push(vi.spyOn(logger, method));
      }
    });

    afterAll(async () => {
      for (const spy of logSpies) spy.mockRestore();
      if (ctx.db !== undefined) {
        await ctx.db.deleteFrom('call_logs').where('tenant_id', 'in', ALL_TENANTS).execute();
        await ctx.db.deleteFrom('caller_bridge_keys').where('tenant_id', 'in', ALL_TENANTS).execute();
        await ctx.db.deleteFrom('tenant_settings').where('tenant_id', 'in', ALL_TENANTS).execute();
        await ctx.db.deleteFrom('tenants').where('id', 'in', ALL_TENANTS).execute();
        await ctx.db.destroy();
      }
      await ctx.appDb?.destroy();
    });

    it('A key + A header → 200 and the call_log is written in A', async () => {
      const { key } = await seedKey(TENANT_A);
      const phone = uniquePhone();
      const res = await post(ctx.app!, key, TENANT_A, phone);
      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      const log = await ctx.db!
        .selectFrom('call_logs')
        .select(['tenant_id'])
        .where('id', '=', res.body.callLogId as string)
        .executeTakeFirstOrThrow();
      expect(log.tenant_id).toBe(TENANT_A);
    });

    it('A key without X-Tenant-Id → 200 (header is optional, tenant comes from the key)', async () => {
      const { key } = await seedKey(TENANT_A);
      const phone = uniquePhone();
      const res = await post(ctx.app!, key, null, phone);
      expect(res.status).toBe(200);
      expect(await callLogCount(TENANT_A, phone)).toBe(1);
    });

    it('A key + upper-case A header → 200 (K1.6 v normalization)', async () => {
      const { key } = await seedKey(TENANT_A);
      const res = await post(ctx.app!, key, TENANT_A.toUpperCase(), uniquePhone());
      expect(res.status).toBe(200);
    });

    it('B key (non-live tenant) + B header → 200 and the row lands in B', async () => {
      const { key } = await seedKey(TENANT_B);
      const phone = uniquePhone();
      const res = await post(ctx.app!, key, TENANT_B, phone);
      expect(res.status).toBe(200);
      expect(await callLogCount(TENANT_B, phone)).toBe(1);
      expect(await callLogCount(TENANT_A, phone)).toBe(0);
    });

    it('A key + B header → 401 and NO row in B (or A)', async () => {
      const { key } = await seedKey(TENANT_A);
      const phone = uniquePhone();
      const res = await post(ctx.app!, key, TENANT_B, phone);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID_BODY);
      expect(await callLogCount(TENANT_B, phone)).toBe(0);
      expect(await callLogCount(TENANT_A, phone)).toBe(0);
    });

    it('B key + A header → 401 and NO row in A (or B)', async () => {
      const { key } = await seedKey(TENANT_B);
      const phone = uniquePhone();
      const res = await post(ctx.app!, key, TENANT_A, phone);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID_BODY);
      expect(await callLogCount(TENANT_A, phone)).toBe(0);
      expect(await callLogCount(TENANT_B, phone)).toBe(0);
    });

    it("A key with its prefix rewritten to B's uuid → 401, no row in B", async () => {
      const { key } = await seedKey(TENANT_A);
      const forged = key.replace(TENANT_A.replace(/-/g, ''), TENANT_B.replace(/-/g, ''));
      expect(forged).not.toBe(key);
      const phone = uniquePhone();
      const res = await post(ctx.app!, forged, TENANT_B, phone);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID_BODY);
      expect(await callLogCount(TENANT_B, phone)).toBe(0);
    });

    it('revoked key → 401', async () => {
      const { key, id } = await seedKey(TENANT_A, { revoked: true });
      const res = await post(ctx.app!, key, TENANT_A, uniquePhone());
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID_BODY);
      expect(await lastUsed(id)).toBeNull();
    });

    it('valid_until in the past → 401', async () => {
      const { key, id } = await seedKey(TENANT_A, { validUntil: '-1 minute' });
      const res = await post(ctx.app!, key, TENANT_A, uniquePhone());
      expect(res.status).toBe(401);
      expect(res.body).toEqual(INVALID_BODY);
      expect(await lastUsed(id)).toBeNull();
    });

    it('grace: old key (valid_until in the future) and new key are both accepted', async () => {
      const oldKey = await seedKey(TENANT_A, { validUntil: '7 days' });
      const newKey = await seedKey(TENANT_A);
      expect((await post(ctx.app!, oldKey.key, TENANT_A, uniquePhone())).status).toBe(200);
      expect((await post(ctx.app!, newKey.key, TENANT_A, uniquePhone())).status).toBe(200);
    });

    it('unknown key with a valid prefix, unknown tenant prefix, deleted tenant → all 401', async () => {
      const unknown = makeKey(TENANT_A); // never seeded
      const ghost = makeKey(randomUUID()); // tenant does not exist
      const deleted = await seedKey(TENANT_DELETED); // tenant soft-deleted
      for (const token of [unknown, ghost, deleted.key]) {
        const res = await post(ctx.app!, token, null, uniquePhone());
        expect(res.status).toBe(401);
        expect(res.body).toEqual(INVALID_BODY);
      }
      expect(await lastUsed(deleted.id)).toBeNull();
    });

    it('malformed cb1_ tokens → identical 401 (upper-case hex, short secret, extra suffix)', async () => {
      const { key } = await seedKey(TENANT_A);
      const hex = TENANT_A.replace(/-/g, '');
      const malformed = [
        key.replace(hex, hex.toUpperCase()),
        key.slice(0, -1),
        `${key}x`,
        'cb1_',
        `cb1_${hex}`,
      ];
      for (const token of malformed) {
        const res = await post(ctx.app!, token, TENANT_A, uniquePhone());
        expect(res.status).toBe(401);
        expect(res.body).toEqual(INVALID_BODY);
      }
    });

    it('a failing cb1_ token NEVER falls through to the legacy branch (even if it equals BRIDGE_TOKEN and the header is the live tenant)', async () => {
      // The legacy shared secret itself is a cb1_-looking string: without the
      // prefix dispatcher, the legacy chain would accept it for TENANT_A.
      const malformedLegacy = 'cb1_not-a-valid-bridge-key';
      const wellFormedLegacy = makeKey(TENANT_A); // valid shape, not in the table
      for (const legacy of [malformedLegacy, wellFormedLegacy]) {
        const appPool = createAppTenantPool(DB_URL ?? '');
        const appDb = createKysely(appPool);
        try {
          const app = buildApp(appOptions(appDb, appPool, legacy));
          const phone = uniquePhone();
          const res = await post(app, legacy, TENANT_A, phone);
          expect(res.status).toBe(401);
          expect(res.body).toEqual(INVALID_BODY);
          expect(await callLogCount(TENANT_A, phone)).toBe(0);
        } finally {
          await appDb.destroy();
        }
      }
    });

    it('legacy shared token + live tenant header → 200 (regression); + B header → 401', async () => {
      const phone = uniquePhone();
      const ok = await post(ctx.app!, LEGACY_TOKEN, TENANT_A, phone);
      expect(ok.status).toBe(200);
      expect(await callLogCount(TENANT_A, phone)).toBe(1);
      const phoneB = uniquePhone();
      const bad = await post(ctx.app!, LEGACY_TOKEN, TENANT_B, phoneB);
      expect(bad.status).toBe(401);
      expect(bad.body).toEqual(INVALID_BODY);
      expect(await callLogCount(TENANT_B, phoneB)).toBe(0);
    });

    it('last_used_at: written only on success, then throttled to once per 5 minutes', async () => {
      const { key, id } = await seedKey(TENANT_A);
      expect(await lastUsed(id)).toBeNull();

      // Failure (header mismatch) must not touch it.
      expect((await post(ctx.app!, key, TENANT_B, uniquePhone())).status).toBe(401);
      expect(await lastUsed(id)).toBeNull();

      expect((await post(ctx.app!, key, TENANT_A, uniquePhone())).status).toBe(200);
      expect(await lastUsed(id)).not.toBeNull();

      // Inside the window → unchanged.
      await ctx.db!
        .updateTable('caller_bridge_keys')
        .set({ last_used_at: sql<Date>`now() - interval '1 minute'` })
        .where('id', '=', id)
        .execute();
      const inWindow = await lastUsed(id);
      expect((await post(ctx.app!, key, TENANT_A, uniquePhone())).status).toBe(200);
      expect((await lastUsed(id))?.getTime()).toBe(inWindow?.getTime());

      // Outside the window → refreshed.
      await ctx.db!
        .updateTable('caller_bridge_keys')
        .set({ last_used_at: sql<Date>`now() - interval '10 minutes'` })
        .where('id', '=', id)
        .execute();
      const stale = await lastUsed(id);
      expect((await post(ctx.app!, key, TENANT_A, uniquePhone())).status).toBe(200);
      expect((await lastUsed(id))!.getTime()).toBeGreaterThan(stale!.getTime());
    });

    it('K6: per-tenant bucket — 61st call of A (many IPs) → 429, B still 200', async () => {
      const appPool = createAppTenantPool(DB_URL ?? '');
      const appDb = createKysely(appPool);
      try {
        const app = buildApp(appOptions(appDb, appPool, LEGACY_TOKEN));
        const a = await seedKey(TENANT_A);
        const b = await seedKey(TENANT_B);
        // 0850 → masked_bypass: no call_log row, cheap. Distinct X-Forwarded-For
        // per request keeps the IP bucket out of the picture (trust proxy = 1).
        const send = (key: string, i: number) =>
          request(app)
            .post('/bridge/caller-id/incoming')
            .set('X-Bridge-Token', key)
            .set('X-Forwarded-For', `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`)
            .send({ rawPhone: '08501234567', receivedAt: new Date().toISOString() });
        for (let i = 0; i < 60; i++) {
          expect((await send(a.key, i)).status).toBe(200);
        }
        const limited = await send(a.key, 60);
        expect(limited.status).toBe(429);
        expect(limited.body.error.code).toBe('BRIDGE_RATE_LIMITED');
        expect((await send(b.key, 61)).status).toBe(200);
      } finally {
        await appDb.destroy();
      }
    });

    it('logs carry neither the phone number nor the key', async () => {
      for (const spy of logSpies) spy.mockClear();
      const { key } = await seedKey(TENANT_A);
      const phone = uniquePhone();
      await post(ctx.app!, key, TENANT_A, phone);
      await post(ctx.app!, key, TENANT_B, phone);
      await post(ctx.app!, makeKey(TENANT_B), null, phone);
      const logged = JSON.stringify(logSpies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain(phone.slice(1));
      expect(logged).not.toContain(key.slice(-43));
      expect(logged).toContain('caller_id.bridge.key_rejected');
    });

    it('RLS: app pool is app_tenant, table is force-RLS, app_tenant has no DELETE, cron_purger has no access', async () => {
      const who = await sql<{ u: string }>`select current_user as u`.execute(ctx.appDb!);
      expect(who.rows[0]?.u).toBe('app_tenant');

      const rls = await sql<{ enabled: boolean; forced: boolean }>`
        select relrowsecurity as enabled, relforcerowsecurity as forced
        from pg_class where oid = 'public.caller_bridge_keys'::regclass`.execute(ctx.db!);
      expect(rls.rows[0]).toEqual({ enabled: true, forced: true });

      const privs = await sql<{ del: boolean; purger: boolean }>`
        select has_table_privilege('app_tenant', 'public.caller_bridge_keys', 'DELETE') as del,
               has_table_privilege('cron_purger', 'public.caller_bridge_keys', 'SELECT') as purger`.execute(ctx.db!);
      expect(privs.rows[0]).toEqual({ del: false, purger: false });

      // Without tenant context app_tenant sees nothing (fail-closed).
      await seedKey(TENANT_A);
      const bare = await sql<{ n: number }>`select count(*)::int as n from caller_bridge_keys`.execute(ctx.appDb!);
      expect(bare.rows[0]?.n).toBe(0);

      // Inside B's context, A's keys are invisible.
      const crossCount = await withTenant(ctx.appDb!, TENANT_B, (trx) =>
        sql<{ n: number }>`select count(*)::int as n from caller_bridge_keys where tenant_id = ${TENANT_A}::uuid`.execute(trx),
      );
      expect(crossCount.rows[0]?.n).toBe(0);
    });
  },
);
