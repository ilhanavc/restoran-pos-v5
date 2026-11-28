/**
 * caller-bridge-key.ts + src/caller-bridge/keys.ts — ADR-052 PR-3 (K3).
 *
 * Unit: CLI argument contract.
 * Integration (DATABASE_URL — local pos_test / CI service container): the
 * service runs on the `app_tenant` pool (NOBYPASSRLS, prod-faithful: an
 * unwrapped write to the force-RLS `caller_bridge_keys` fails), fixtures on the
 * superuser pool. The issued key is proven end-to-end through the real
 * middleware: POST /bridge/caller-id/incoming → 200.
 *
 * Cleanup touches only this file's tenants.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { sql, type Kysely } from 'kysely';
import type { Express } from 'express';
import { createPool, createKysely, type DB } from '@restoran-pos/db';
import { ALLOWED_KEYS } from '@restoran-pos/shared-domain';
import { createAppTenantPool } from '../src/__tests__/helpers/appTenantPool.js';
import { buildApp } from '../src/app.js';
import {
  CallerBridgeKeyRefusedError,
  generateCallerBridgeKey,
  hashCallerBridgeKey,
  issueCallerBridgeKey,
  revokeCallerBridgeKeys,
  rotateCallerBridgeKey,
  type CallerBridgeKeyRefusalCode,
} from '../src/caller-bridge/keys.js';
import {
  defaultKeyPath,
  parseCliArgs,
  runCallerBridgeKeyCli,
  type CliArgs,
} from './caller-bridge-key.js';

/** Same shape the PR-4 `.ps1` checks on the shop PC (ADR-052 K7 C). */
const KEY_SHAPE = /^cb1_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/;
const TENANT_ARGS = ['--tenant-id', '11111111-1111-4111-8111-111111111111', '--actor', 'admin'];

describe('parseCliArgs', () => {
  it('parses the four modes', () => {
    expect(parseCliArgs(['issue', ...TENANT_ARGS]).mode).toBe('issue');
    expect(parseCliArgs(['rotate', ...TENANT_ARGS]).mode).toBe('rotate');
    expect(parseCliArgs(['revoke', ...TENANT_ARGS, '--after-grace']).mode).toBe('revoke-after-grace');
    expect(parseCliArgs(['revoke', ...TENANT_ARGS, '--now']).mode).toBe('revoke-now');
  });

  it('rotate takes --grace-days and --out; absent options stay absent', () => {
    expect(parseCliArgs(['rotate', ...TENANT_ARGS, '--grace-days', '3', '--out', '/tmp/k.txt'])).toEqual({
      mode: 'rotate',
      tenantId: '11111111-1111-4111-8111-111111111111',
      actor: 'admin',
      graceDays: 3,
      outPath: '/tmp/k.txt',
    });
    expect(parseCliArgs(['issue', ...TENANT_ARGS])).toEqual({
      mode: 'issue',
      tenantId: '11111111-1111-4111-8111-111111111111',
      actor: 'admin',
    });
  });

  it('revoke needs exactly one of --after-grace / --now', () => {
    expect(() => parseCliArgs(['revoke', ...TENANT_ARGS])).toThrow('--after-grace');
    expect(() => parseCliArgs(['revoke', ...TENANT_ARGS, '--after-grace', '--now'])).toThrow('--after-grace');
    expect(() => parseCliArgs(['rotate', ...TENANT_ARGS, '--now'])).toThrow('yalnız revoke');
  });

  it('rejects unknown mode, missing tenant/actor, misplaced options', () => {
    expect(() => parseCliArgs(['delete', ...TENANT_ARGS])).toThrow('issue | rotate | revoke');
    expect(() => parseCliArgs(['issue', '--actor', 'admin'])).toThrow('--tenant-id ve --actor');
    expect(() => parseCliArgs(['issue', '--tenant-id', '--actor', 'admin'])).toThrow('--tenant-id bir değer');
    expect(() => parseCliArgs(['issue', ...TENANT_ARGS, '--grace-days', '3'])).toThrow('yalnız rotate');
    expect(() => parseCliArgs(['revoke', ...TENANT_ARGS, '--now', '--out', 'x'])).toThrow('yalnız issue');
  });

  it('defaultKeyPath: /root/caller-bridge-key-<slug>.txt; refuses a slug unfit for a path', () => {
    expect(defaultKeyPath('dilan-pide')).toBe('/root/caller-bridge-key-dilan-pide.txt');
    expect(() => defaultKeyPath('../etc/x')).toThrow('slug');
  });

  it('generateCallerBridgeKey: K1.1 shape, lowercase tenant hex, fresh randomness', () => {
    const tenant = 'ABCDEF01-2345-4678-9ABC-DEF012345678';
    const a = generateCallerBridgeKey(tenant);
    expect(a).toMatch(KEY_SHAPE);
    expect(a.startsWith('cb1_abcdef0123454678' + '9abcdef012345678_')).toBe(true);
    expect(generateCallerBridgeKey(tenant)).not.toBe(a);
    expect(hashCallerBridgeKey(a)).toHaveLength(32);
  });
});

const DB_URL = process.env.DATABASE_URL;

describe.skipIf(DB_URL === undefined || DB_URL.length === 0)('caller bridge key lifecycle (integration)', () => {
  const RUN = randomUUID().slice(0, 8);
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const TENANT_GONE = randomUUID();
  const TENANTS = [TENANT_A, TENANT_B, TENANT_GONE];
  const ADMIN_A = `cbk-admin-a-${RUN}`;
  const CASHIER_A = `cbk-cashier-a-${RUN}`;
  const ADMIN_B = `cbk-admin-b-${RUN}`;

  let db: Kysely<DB>;
  let appDb: Kysely<DB>;
  let app: Express;
  let dir: string;

  const outFile = (name: string): string => join(dir, `${name}.txt`);

  async function keyRows(tenantId: string) {
    return db
      .selectFrom('caller_bridge_keys')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async function bridgePost(key: string): Promise<number> {
    let phone = '0539';
    for (let i = 0; i < 8; i++) phone += String(Math.floor(Math.random() * 10));
    const res = await request(app)
      .post('/bridge/caller-id/incoming')
      .set('X-Bridge-Token', key)
      .send({ rawPhone: phone, receivedAt: new Date().toISOString() });
    return res.status;
  }

  async function readKey(path: string): Promise<string> {
    return (await readFile(path, 'utf8')).trimEnd();
  }

  async function expectRefused(p: Promise<unknown>, code: CallerBridgeKeyRefusalCode): Promise<void> {
    const err: unknown = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CallerBridgeKeyRefusedError);
    expect((err as CallerBridgeKeyRefusedError).code).toBe(code);
  }

  const cli = (args: Omit<CliArgs, 'tenantId' | 'actor'>, tenantId = TENANT_A, actor = ADMIN_A) =>
    runCallerBridgeKeyCli(appDb, { tenantId, actor, ...args });

  beforeAll(async () => {
    db = createKysely(createPool({ connectionString: DB_URL ?? '' }));
    const appPool = createAppTenantPool(DB_URL ?? '');
    appDb = createKysely(appPool);
    app = buildApp({
      pool: appPool,
      db: appDb,
      accessSecret: 'test-secret-min-32-chars-please-be-long-enough',
      agentSecret: 'test-agent-secret-min-32-chars-please-long',
      tenantId: TENANT_A,
      webOrigin: 'http://localhost:5173',
      bridgeToken: 'test-legacy-bridge-token-shared',
    });
    dir = await mkdtemp(join(tmpdir(), 'cbk-'));

    await db
      .insertInto('tenants')
      .values(TENANTS.map((id, i) => ({ id, name: `CBK ${String(i)}`, slug: `cbk-vitest-${String(i)}-${RUN}` })))
      .execute();
    await db.updateTable('tenants').set({ deleted_at: sql<Date>`now()` }).where('id', '=', TENANT_GONE).execute();
    await db
      .insertInto('tenant_settings')
      .values(TENANTS.map((tenant_id) => ({ tenant_id })))
      .onConflict((oc) => oc.doNothing())
      .execute();
    const hash = await bcrypt.hash('irrelevant', 4);
    await db
      .insertInto('users')
      .values([
        { id: randomUUID(), tenant_id: TENANT_A, username: ADMIN_A, email: `${ADMIN_A}@test.local`, password_hash: hash, role: 'admin' },
        { id: randomUUID(), tenant_id: TENANT_A, username: CASHIER_A, email: null, password_hash: hash, role: 'cashier' },
        { id: randomUUID(), tenant_id: TENANT_B, username: ADMIN_B, email: null, password_hash: hash, role: 'admin' },
        { id: randomUUID(), tenant_id: TENANT_GONE, username: `cbk-admin-g-${RUN}`, email: null, password_hash: hash, role: 'admin' },
      ])
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom('call_logs').where('tenant_id', 'in', TENANTS).execute();
    await db.deleteFrom('caller_bridge_keys').where('tenant_id', 'in', TENANTS).execute();
    await db.deleteFrom('audit_logs').where('tenant_id', 'in', TENANTS).execute();
    await db.deleteFrom('tenant_settings').where('tenant_id', 'in', TENANTS).execute();
    await db.deleteFrom('users').where('tenant_id', 'in', TENANTS).execute();
    await db.deleteFrom('tenants').where('id', 'in', TENANTS).execute();
    await db.destroy();
    await appDb.destroy();
    await rm(dir, { recursive: true, force: true });
  });

  it('runs as app_tenant (force-RLS bites)', async () => {
    const who = await sql<{ u: string }>`select current_user as u`.execute(appDb);
    expect(who.rows[0]?.u).toBe('app_tenant');
  });

  it('actor not an admin of the tenant / admin of ANOTHER tenant / unknown → refused, nothing written', async () => {
    for (const actor of [CASHIER_A, ADMIN_B, 'nobody@example.test']) {
      const path = outFile(`actor-${actor.slice(0, 12)}`);
      await expectRefused(cli({ mode: 'issue', outPath: path }, TENANT_A, actor), 'ACTOR_UNRESOLVED');
      expect(existsSync(path)).toBe(false);
    }
    expect(await keyRows(TENANT_A)).toHaveLength(0);
  });

  it('missing / soft-deleted tenant → refused', async () => {
    await expectRefused(cli({ mode: 'issue', outPath: outFile('ghost') }, randomUUID()), 'TENANT_NOT_FOUND');
    await expectRefused(
      cli({ mode: 'issue', outPath: outFile('gone') }, TENANT_GONE, `cbk-admin-g-${RUN}`),
      'TENANT_NOT_FOUND',
    );
  });

  it('issue: 0600 file with the key, stdout has no secret, hash verifies through the real middleware (200)', async () => {
    const path = outFile('issue-a');
    const lines = await cli({ mode: 'issue', outPath: path });

    const raw = await readFile(path, 'utf8');
    expect(raw).toMatch(/^cb1_[0-9a-f]{32}_[A-Za-z0-9_-]{43}\n$/);
    const key = raw.trimEnd();
    expect(key.startsWith(`cb1_${TENANT_A.replace(/-/g, '')}_`)).toBe(true);
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }

    const rows = await keyRows(TENANT_A);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.key_hash.equals(hashCallerBridgeKey(key))).toBe(true);
    expect(row.valid_until).toBeNull();
    expect(row.created_by_user_id).not.toBeNull();

    expect(lines).toEqual([`[caller-bridge-key] anahtar dosyası: ${path}`, `[caller-bridge-key] anahtar id=${row.id}`]);
    expect(lines.join('\n')).not.toContain('cb1_');
    expect(lines.join('\n')).not.toContain(key.slice(-43));

    expect(await bridgePost(key)).toBe(200);
    expect((await keyRows(TENANT_A))[0]!.last_used_at).not.toBeNull();
  });

  it('issue again while a usable key exists → ACTIVE_KEY_EXISTS, no new row, no file', async () => {
    const path = outFile('issue-a-again');
    await expectRefused(cli({ mode: 'issue', outPath: path }), 'ACTIVE_KEY_EXISTS');
    expect(await keyRows(TENANT_A)).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
  });

  it('refuses to overwrite an existing file — and rolls the DB back', async () => {
    const path = outFile('preexisting-b');
    await writeFile(path, 'do not touch\n');
    await expectRefused(cli({ mode: 'issue', outPath: path }, TENANT_B, ADMIN_B), 'INVALID_ARGS');
    expect(await readFile(path, 'utf8')).toBe('do not touch\n');
    expect(await keyRows(TENANT_B)).toHaveLength(0);
    const audits = await db.selectFrom('audit_logs').select('id').where('tenant_id', '=', TENANT_B).execute();
    expect(audits).toHaveLength(0);
  });

  it('a failing delivery commits nothing (service level)', async () => {
    await expect(
      issueCallerBridgeKey(appDb, {
        tenantId: TENANT_B,
        actor: ADMIN_B,
        deliver: () => Promise.reject(new Error('disk full')),
      }),
    ).rejects.toThrow('disk full');
    expect(await keyRows(TENANT_B)).toHaveLength(0);
  });

  it('rotate with no usable key → NO_ACTIVE_KEY; grace bounds 1..30 integer enforced', async () => {
    const deliver = () => Promise.resolve();
    await expectRefused(rotateCallerBridgeKey(appDb, { tenantId: TENANT_B, actor: ADMIN_B, deliver }), 'NO_ACTIVE_KEY');
    for (const graceDays of [0, 31, 1.5, Number.NaN]) {
      await expectRefused(
        rotateCallerBridgeKey(appDb, { tenantId: TENANT_A, actor: ADMIN_A, graceDays, deliver }),
        'INVALID_ARGS',
      );
    }
    const rows = await keyRows(TENANT_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.valid_until).toBeNull();
  });

  it('rotate: old key gets valid_until ≈ now + 7d, both keys work during grace; revoke --after-grace refused while the new key is unused', async () => {
    const oldKey = await readKey(outFile('issue-a'));
    const path = outFile('rotate-a');
    const before = Date.now();
    await cli({ mode: 'rotate', outPath: path });
    const newKey = await readKey(path);
    expect(newKey).toMatch(KEY_SHAPE);
    expect(newKey).not.toBe(oldKey);

    const [oldRow, newRow] = await keyRows(TENANT_A);
    expect(newRow!.valid_until).toBeNull();
    const grace = oldRow!.valid_until!.getTime() - before;
    expect(grace).toBeGreaterThanOrEqual(7 * 86_400_000 - 5_000);
    expect(grace).toBeLessThanOrEqual(7 * 86_400_000 + 5_000);
    expect(oldRow!.revoked_at).toBeNull();

    // K3.3: the new key has never been used → no revocation.
    await expectRefused(cli({ mode: 'revoke-after-grace' }), 'NEW_KEY_UNUSED');

    expect(await bridgePost(oldKey)).toBe(200);
    expect(await bridgePost(newKey)).toBe(200);
  });

  it('revoke --after-grace: succeeds once the new key is used, revokes only expired-grace rows', async () => {
    const oldKey = await readKey(outFile('issue-a'));
    const newKey = await readKey(outFile('rotate-a'));
    const [oldRow, newRow] = await keyRows(TENANT_A);
    // Grace has passed (simulated) — the middleware already refuses it.
    await db
      .updateTable('caller_bridge_keys')
      .set({ valid_until: sql<Date>`now() - interval '1 minute'` })
      .where('id', '=', oldRow!.id)
      .execute();
    expect(await bridgePost(oldKey)).toBe(401);

    const lines = await cli({ mode: 'revoke-after-grace' });
    expect(lines[0]).toContain(`1 anahtar iptal edildi (kullanımda olan anahtar id=${newRow!.id})`);

    const [oldAfter, newAfter] = await keyRows(TENANT_A);
    expect(oldAfter!.revoked_at).not.toBeNull();
    expect(oldAfter!.revoke_reason).toBe('rotated');
    expect(newAfter!.revoked_at).toBeNull();
    expect(await bridgePost(newKey)).toBe(200);
  });

  it('revoke --now: every key of the tenant dies at once (leak case); issue works again afterwards', async () => {
    await cli({ mode: 'rotate', outPath: outFile('rotate-a-2'), graceDays: 1 });
    const live = [await readKey(outFile('rotate-a')), await readKey(outFile('rotate-a-2'))];
    for (const key of live) expect(await bridgePost(key)).toBe(200);

    const lines = await cli({ mode: 'revoke-now' });
    expect(lines[0]).toContain('2 anahtar HEMEN iptal edildi');
    for (const key of live) expect(await bridgePost(key)).toBe(401);
    const rows = await keyRows(TENANT_A);
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);
    expect(rows.filter((r) => r.revoke_reason === 'revoked_now')).toHaveLength(2);

    await cli({ mode: 'issue', outPath: outFile('issue-a-after-leak') });
    expect(await bridgePost(await readKey(outFile('issue-a-after-leak')))).toBe(200);
  });

  it('audit: three event types written, payload holds only allow-listed ids/counts — never key material', async () => {
    const audits = await db
      .selectFrom('audit_logs')
      .select(['event_type', 'payload', 'entity_type', 'actor_user_id'])
      .where('tenant_id', '=', TENANT_A)
      .where('event_type', 'like', 'caller_bridge.%')
      .execute();
    const types = audits.map((a) => a.event_type).sort();
    expect(types).toEqual([
      'caller_bridge.key_issued',
      'caller_bridge.key_issued',
      'caller_bridge.key_revoked',
      'caller_bridge.key_revoked',
      'caller_bridge.key_rotated',
      'caller_bridge.key_rotated',
    ]);

    const secrets = (
      await Promise.all(['issue-a', 'rotate-a', 'rotate-a-2', 'issue-a-after-leak'].map((n) => readKey(outFile(n))))
    ).flatMap((k) => [k, k.slice(-43), hashCallerBridgeKey(k).toString('hex'), hashCallerBridgeKey(k).toString('base64')]);

    for (const a of audits) {
      const json = JSON.stringify(a.payload);
      expect(json).not.toContain('cb1_');
      for (const s of secrets) expect(json).not.toContain(s);
      const allowed = ALLOWED_KEYS[a.event_type as keyof typeof ALLOWED_KEYS];
      for (const k of Object.keys(a.payload as Record<string, unknown>)) expect(allowed).toContain(k);
      expect(a.entity_type).toBe('caller_bridge_key');
      expect(a.actor_user_id).not.toBeNull();
    }

    const rotated = audits.find((a) => a.event_type === 'caller_bridge.key_rotated')!;
    expect(rotated.payload).toMatchObject({ affected_key_count: 1 });
    const revokedNow = audits.filter((a) => a.event_type === 'caller_bridge.key_revoked');
    expect(revokedNow.map((a) => (a.payload as { affected_key_count: number }).affected_key_count).sort()).toEqual([1, 2]);
  });

  it('revoke --now with nothing to revoke still leaves one audit row (leak response trace)', async () => {
    const before = await db.selectFrom('audit_logs').select('id').where('tenant_id', '=', TENANT_B).execute();
    const r = await revokeCallerBridgeKeys(appDb, { tenantId: TENANT_B, actor: ADMIN_B, mode: 'now' });
    expect(r.revokedCount).toBe(0);
    const after = await db
      .selectFrom('audit_logs')
      .select(['id', 'event_type', 'payload'])
      .where('tenant_id', '=', TENANT_B)
      .execute();
    expect(after).toHaveLength(before.length + 1);
    const added = after.find((a) => !before.some((b) => b.id === a.id))!;
    expect(added.event_type).toBe('caller_bridge.key_revoked');
    expect(added.payload).toEqual({ affected_key_count: 0 });
  });

  it('issue waits on the per-tenant advisory lock (concurrent runs are serialized)', async () => {
    // Deterministic: a real two-way race is too narrow to trigger reliably, so
    // the test holds the same lock itself and proves `issue` blocks on it.
    // Negative control: drop `lockTenantKeys` → `settledWhileLocked` is true.
    const deliver = async (): Promise<void> => {};
    let settled = false;
    let pending: Promise<unknown> | undefined;
    let settledWhileLocked: boolean | undefined;
    // Warm the app pool first: a cold connect alone can exceed the wait window
    // and would make the assertion pass without any lock (false green).
    await sql`select 1`.execute(appDb);
    await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${`caller_bridge_keys:${TENANT_B}`}))`.execute(trx);
      pending = issueCallerBridgeKey(appDb, { tenantId: TENANT_B, actor: ADMIN_B, deliver })
        .catch((err: unknown) => err)
        .finally(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 750));
      settledWhileLocked = settled;
    });
    expect(settledWhileLocked).toBe(false);
    await pending;
    expect(settled).toBe(true);
  });
});
