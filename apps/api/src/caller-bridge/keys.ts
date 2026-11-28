import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { withTenant, type DB } from '@restoran-pos/db';
import { writeAudit } from '../audit/writeAudit.js';

/**
 * ADR-052 K3 — Caller ID bridge key (`cb1_`) lifecycle: issue, rotate, revoke.
 *
 * K3.5 (Katman 3 hook): ALL key logic lives here, not in the ops script, so a
 * future self-service endpoint can call the same functions (its own ADR, S3).
 * The ops script `scripts/caller-bridge-key.ts` is only argument parsing +
 * secret-file delivery around these functions.
 *
 * Secret discipline: the plaintext key never leaves this module except through
 * the caller-supplied `deliver` callback, which runs INSIDE the transaction —
 * if delivery fails (e.g. the target file already exists) nothing is
 * committed, so there is never a stored hash whose plaintext was lost. Only the
 * SHA-256 hash reaches the DB; audit payloads carry row ids and counts only.
 */

/** ADR-052 K3.3 — product owner decision S4: default grace 7 days. */
export const DEFAULT_GRACE_DAYS = 7;
export const MIN_GRACE_DAYS = 1;
export const MAX_GRACE_DAYS = 30;

const KEY_PREFIX = 'cb1_';
const RANDOM_BYTES = 32; // → 43 base64url characters (K1.1)
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ADR-052 K1.1 — `cb1_<32 lowercase hex tenant uuid>_<43 base64url>`.
 *
 * 🔴 The return value is a SECRET: hand it only to the delivery channel
 * (a 0600 file). Never log, audit, print or put it in an error message.
 */
export function generateCallerBridgeKey(tenantId: string): string {
  const hex = tenantId.replace(/-/g, '').toLowerCase();
  return `${KEY_PREFIX}${hex}_${randomBytes(RANDOM_BYTES).toString('base64url')}`;
}

/**
 * ADR-052 K2 — SHA-256 over the FULL presented string, no normalization.
 * Single source for both the writer (this module) and the verifier
 * (`requireCallerBridgeKey`): a drift between the two would make every issued
 * key a silent 401.
 */
export function hashCallerBridgeKey(key: string): Buffer {
  return createHash('sha256').update(key, 'utf8').digest();
}

export type CallerBridgeKeyRefusalCode =
  | 'INVALID_ARGS'
  | 'TENANT_NOT_FOUND'
  | 'ACTOR_UNRESOLVED'
  | 'ACTIVE_KEY_EXISTS'
  | 'NO_ACTIVE_KEY'
  | 'NEW_KEY_UNUSED';

/**
 * Every refusal is a typed error with a stable `code` so a future endpoint can
 * map it to an HTTP status; the message is the Turkish ops-console line.
 */
export class CallerBridgeKeyRefusedError extends Error {
  readonly code: CallerBridgeKeyRefusalCode;

  constructor(code: CallerBridgeKeyRefusalCode, message: string) {
    super(`ADR-052 K3 — REDDEDİLDİ: ${message}`);
    this.name = 'CallerBridgeKeyRefusedError';
    this.code = code;
  }
}

export interface KeyDelivery {
  /** 🔴 SECRET — write it to the delivery channel only. */
  plaintextKey: string;
  tenantSlug: string;
  keyId: string;
}

/** Runs inside the DB transaction; throwing rolls the whole operation back. */
export type DeliverKey = (delivery: KeyDelivery) => Promise<void>;

export interface CallerBridgeKeyTarget {
  /** Target tenant — given explicitly, never derived from env. */
  tenantId: string;
  /** Admin username or e-mail of THIS tenant; unresolvable → refused. */
  actor: string;
}

export interface IssueOptions extends CallerBridgeKeyTarget {
  deliver: DeliverKey;
}

export interface RotateOptions extends CallerBridgeKeyTarget {
  graceDays?: number;
  deliver: DeliverKey;
}

export type RevokeMode = 'after_grace' | 'now';

export interface RevokeOptions extends CallerBridgeKeyTarget {
  mode: RevokeMode;
}

export interface IssueResult {
  keyId: string;
  tenantSlug: string;
}

export interface RotateResult extends IssueResult {
  /** Grace end written to the old keys. */
  validUntil: Date;
  /** Old rows that received `valid_until`. */
  affectedKeyCount: number;
}

export interface RevokeResult {
  tenantSlug: string;
  revokedCount: number;
  /** after_grace: the new key whose `last_used_at` proved the switch. */
  provenKeyId: string | null;
}

type Trx = Transaction<DB>;

/** Masks `--actor` in messages: a swapped flag must not echo a secret. */
function maskActor(actor: string): string {
  const trimmed = actor.trim();
  return `${trimmed.slice(0, 3)}…(${String(trimmed.length)} karakter)`;
}

function normalizeTarget(opts: CallerBridgeKeyTarget): CallerBridgeKeyTarget {
  if (!UUID_RE.test(opts.tenantId)) {
    throw new CallerBridgeKeyRefusedError('INVALID_ARGS', '--tenant-id geçerli bir UUID olmalı.');
  }
  if (opts.actor.trim() === '') {
    throw new CallerBridgeKeyRefusedError('INVALID_ARGS', '--actor zorunlu.');
  }
  return { tenantId: opts.tenantId.toLowerCase(), actor: opts.actor };
}

function assertGraceDays(graceDays: number): void {
  if (!Number.isInteger(graceDays) || graceDays < MIN_GRACE_DAYS || graceDays > MAX_GRACE_DAYS) {
    throw new CallerBridgeKeyRefusedError(
      'INVALID_ARGS',
      `--grace-days ${String(MIN_GRACE_DAYS)}-${String(MAX_GRACE_DAYS)} arası tam sayı olmalı (varsayılan ${String(DEFAULT_GRACE_DAYS)}).`,
    );
  }
}

/**
 * Serializes key operations per tenant (security review 2026-11-28): two
 * concurrent `issue` runs could otherwise both pass the "no usable key" check,
 * and a `revoke --now` could miss a key a parallel `rotate` is inserting.
 * Transaction-scoped: released on commit/rollback.
 */
async function lockTenantKeys(trx: Trx, tenantId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`caller_bridge_keys:${tenantId}`}))`.execute(
    trx,
  );
}

/** `tenants` is RLS-free; a soft-deleted tenant is treated as absent. */
async function resolveTenantSlug(trx: Trx, tenantId: string): Promise<string> {
  const row = await trx
    .selectFrom('tenants')
    .select(['slug'])
    .where('id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (row === undefined) {
    throw new CallerBridgeKeyRefusedError('TENANT_NOT_FOUND', 'bu id ile silinmemiş bir tenant yok.');
  }
  return row.slug;
}

/**
 * K3.1 — the actor must be an admin of THIS tenant (username or e-mail).
 * `users` has no soft-delete column; role + tenant is the whole check. Must run
 * inside `withTenant` (`users` is force-RLS: unwrapped → silent 0 rows).
 */
async function resolveActorUserId(trx: Trx, tenantId: string, actor: string): Promise<string> {
  const needle = actor.trim();
  const row = await trx
    .selectFrom('users')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .where('role', '=', 'admin')
    .where((eb) =>
      eb.or([eb('username', '=', needle), eb('email', '=', needle.toLocaleLowerCase('en'))]),
    )
    .executeTakeFirst();
  if (row === undefined) {
    throw new CallerBridgeKeyRefusedError(
      'ACTOR_UNRESOLVED',
      `"${maskActor(actor)}" bu tenant'ta bir admin kullanıcıya çözülemedi; denetim izi olmadan anahtar işlemi yapılmaz.`,
    );
  }
  return row.id;
}

/** Keys the middleware would accept right now (same filter as K1.6 iv). */
async function usableKeys(
  trx: Trx,
  tenantId: string,
): Promise<{ id: string; last_used_at: Date | null }[]> {
  return trx
    .selectFrom('caller_bridge_keys')
    .select(['id', 'last_used_at'])
    .where('tenant_id', '=', tenantId)
    .where('revoked_at', 'is', null)
    .where((eb) => eb.or([eb('valid_until', 'is', null), eb('valid_until', '>', sql<Date>`now()`)]))
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
}

async function insertKey(
  trx: Trx,
  tenantId: string,
  actorUserId: string,
): Promise<{ keyId: string; plaintextKey: string }> {
  const keyId = randomUUID();
  const plaintextKey = generateCallerBridgeKey(tenantId);
  await trx
    .insertInto('caller_bridge_keys')
    .values({
      id: keyId,
      tenant_id: tenantId,
      key_hash: hashCallerBridgeKey(plaintextKey),
      created_by_user_id: actorUserId,
    })
    .execute();
  return { keyId, plaintextKey };
}

/**
 * `issue` — the tenant's FIRST key (or the first after a `revoke --now`).
 * Refused while the tenant still has a usable key: a second open-ended key
 * would silently double the attack surface — use `rotate` instead.
 */
export async function issueCallerBridgeKey(
  db: Kysely<DB>,
  opts: IssueOptions,
): Promise<IssueResult> {
  const { tenantId, actor } = normalizeTarget(opts);
  return withTenant(db, tenantId, async (trx) => {
    await lockTenantKeys(trx, tenantId);
    const tenantSlug = await resolveTenantSlug(trx, tenantId);
    const actorUserId = await resolveActorUserId(trx, tenantId, actor);
    if ((await usableKeys(trx, tenantId)).length > 0) {
      throw new CallerBridgeKeyRefusedError(
        'ACTIVE_KEY_EXISTS',
        'bu tenant\'ın geçerli bir köprü anahtarı zaten var; yenisi için "rotate" kullanın.',
      );
    }
    const { keyId, plaintextKey } = await insertKey(trx, tenantId, actorUserId);
    await writeAudit(trx, {
      tenantId,
      eventType: 'caller_bridge.key_issued',
      actorUserId,
      entityType: 'caller_bridge_key',
      entityId: keyId,
      rawPayload: { bridge_key_id: keyId },
    });
    // Last step inside the transaction: a failed delivery rolls everything back.
    await opts.deliver({ plaintextKey, tenantSlug, keyId });
    return { keyId, tenantSlug };
  });
}

/**
 * `rotate` — new key + `valid_until = now() + grace` on the old usable keys
 * (NOT revoked: both work during grace, K7). Keys whose grace already ends
 * sooner keep their earlier end; longer windows are shortened.
 */
export async function rotateCallerBridgeKey(
  db: Kysely<DB>,
  opts: RotateOptions,
): Promise<RotateResult> {
  const { tenantId, actor } = normalizeTarget(opts);
  const graceDays = opts.graceDays ?? DEFAULT_GRACE_DAYS;
  assertGraceDays(graceDays);
  const validUntil = new Date(Date.now() + graceDays * DAY_MS);

  return withTenant(db, tenantId, async (trx) => {
    await lockTenantKeys(trx, tenantId);
    const tenantSlug = await resolveTenantSlug(trx, tenantId);
    const actorUserId = await resolveActorUserId(trx, tenantId, actor);
    if ((await usableKeys(trx, tenantId)).length === 0) {
      throw new CallerBridgeKeyRefusedError(
        'NO_ACTIVE_KEY',
        'bu tenant\'ın geçerli bir köprü anahtarı yok; ilk anahtar için "issue" kullanın.',
      );
    }
    const updated = await trx
      .updateTable('caller_bridge_keys')
      .set({ valid_until: validUntil })
      .where('tenant_id', '=', tenantId)
      .where('revoked_at', 'is', null)
      .where((eb) => eb.or([eb('valid_until', 'is', null), eb('valid_until', '>', validUntil)]))
      .executeTakeFirst();
    const affectedKeyCount = Number(updated.numUpdatedRows);

    const { keyId, plaintextKey } = await insertKey(trx, tenantId, actorUserId);
    await writeAudit(trx, {
      tenantId,
      eventType: 'caller_bridge.key_rotated',
      actorUserId,
      entityType: 'caller_bridge_key',
      entityId: keyId,
      rawPayload: {
        bridge_key_id: keyId,
        valid_until: validUntil.toISOString(),
        affected_key_count: affectedKeyCount,
      },
    });
    await opts.deliver({ plaintextKey, tenantSlug, keyId });
    return { keyId, tenantSlug, validUntil, affectedKeyCount };
  });
}

/**
 * `revoke`:
 *  - `after_grace` — revokes keys whose grace has passed, but ONLY when the
 *    newest usable key has a `last_used_at` (K3.3: proof the bridge switched).
 *    There is deliberately no force flag.
 *  - `now` — leak case (S5): revokes every not-yet-revoked key of the tenant
 *    immediately. Caller ID goes silent for that tenant until a new `issue`.
 */
export async function revokeCallerBridgeKeys(
  db: Kysely<DB>,
  opts: RevokeOptions,
): Promise<RevokeResult> {
  const { tenantId, actor } = normalizeTarget(opts);
  return withTenant(db, tenantId, async (trx) => {
    await lockTenantKeys(trx, tenantId);
    const tenantSlug = await resolveTenantSlug(trx, tenantId);
    const actorUserId = await resolveActorUserId(trx, tenantId, actor);

    let provenKeyId: string | null = null;
    let query = trx
      .updateTable('caller_bridge_keys')
      .where('tenant_id', '=', tenantId)
      .where('revoked_at', 'is', null);

    if (opts.mode === 'after_grace') {
      const newest = (await usableKeys(trx, tenantId))[0];
      if (newest === undefined || newest.last_used_at === null) {
        throw new CallerBridgeKeyRefusedError(
          'NEW_KEY_UNUSED',
          'yeni anahtar henüz hiç kullanılmamış (last_used_at boş); köprü yeni anahtara geçmeden eski anahtar iptal edilmez.',
        );
      }
      provenKeyId = newest.id;
      query = query.where('valid_until', 'is not', null).where('valid_until', '<=', sql<Date>`now()`);
    }

    const result = await query
      .set({
        revoked_at: sql<Date>`now()`,
        revoke_reason: opts.mode === 'now' ? 'revoked_now' : 'rotated',
      })
      .executeTakeFirst();
    const revokedCount = Number(result.numUpdatedRows);

    // `--now` is a leak response: it leaves a trace even when nothing was left
    // to revoke. `after_grace` with 0 rows is a routine no-op → no row.
    if (revokedCount > 0 || opts.mode === 'now') {
      await writeAudit(trx, {
        tenantId,
        eventType: 'caller_bridge.key_revoked',
        actorUserId,
        entityType: 'caller_bridge_key',
        ...(provenKeyId === null ? {} : { entityId: provenKeyId }),
        rawPayload: {
          ...(provenKeyId === null ? {} : { bridge_key_id: provenKeyId }),
          affected_key_count: revokedCount,
        },
      });
    }
    return { tenantSlug, revokedCount, provenKeyId };
  });
}
