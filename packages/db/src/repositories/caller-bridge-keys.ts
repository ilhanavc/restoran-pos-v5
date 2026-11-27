import { sql, type Selectable } from 'kysely';
import type { CallerBridgeKeys } from '../generated.js';
import type { DbExecutor } from './users.js';

export type CallerBridgeKeyRow = Selectable<CallerBridgeKeys>;

/**
 * ADR-052 K2 — Caller ID bridge keys (`cb1_`), SHA-256 hashed.
 *
 * `caller_bridge_keys` is force-RLS (mig 073): every call must run inside
 * `withTenant(<tenant resolved from the key prefix>)`. Unwrapped → 0 rows →
 * the bridge gets 401 (fail-closed, Caller ID goes silent for that tenant).
 */
export interface CallerBridgeKeysRepository {
  /**
   * Returns the key row only if it is usable right now. The validity filter
   * lives INSIDE the query (ADR-052 K1.6 iv) — callers never re-check
   * `revoked_at` / `valid_until` in application code.
   */
  findActiveByHash(
    tenantId: string,
    keyHash: Buffer,
  ): Promise<CallerBridgeKeyRow | null>;
  /**
   * Marks a successful verification. Throttled in SQL to at most one write per
   * 5 minutes per key (K2) — the bridge authenticates on every call.
   */
  touchLastUsed(tenantId: string, id: string): Promise<void>;
}

export function createCallerBridgeKeysRepository(
  db: DbExecutor,
): CallerBridgeKeysRepository {
  return {
    async findActiveByHash(tenantId, keyHash) {
      const row = await db
        .selectFrom('caller_bridge_keys')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('key_hash', '=', keyHash)
        .where('revoked_at', 'is', null)
        .where((eb) =>
          eb.or([
            eb('valid_until', 'is', null),
            eb('valid_until', '>', sql<Date>`now()`),
          ]),
        )
        .executeTakeFirst();
      return row ?? null;
    },

    async touchLastUsed(tenantId, id) {
      await db
        .updateTable('caller_bridge_keys')
        .set({ last_used_at: sql<Date>`now()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where((eb) =>
          eb.or([
            eb('last_used_at', 'is', null),
            eb('last_used_at', '<', sql<Date>`now() - interval '5 minutes'`),
          ]),
        )
        .execute();
    },
  };
}
