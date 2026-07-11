import { describe, expect, it } from 'vitest';
import { createPool } from '../../index.js';

/**
 * DB-TX-06 (HIGH) — connection.ts `createPool()` returns a plain `pg.Pool`
 * with NO `'error'` listener attached, and neither does the only production
 * caller (`apps/api/src/index.ts:39`, confirmed via grep — every other
 * `createPool(...)` call site in the repo is test fixture code).
 *
 * `pg.Pool` is a Node `EventEmitter`. Per `node-postgres`'s own docs: "the
 * pool will emit an error on behalf of any idle clients it contains if any
 * client encounters an error while sitting idly in the pool... You should
 * always add a listener to the pool to catch errors. Failure to do so will
 * cause unhandled errors to crash your node process." A Node EventEmitter
 * with zero listeners for an `'error'` event throws synchronously when that
 * event is emitted, which — for the *default* uncaught-exception behavior —
 * crashes the whole process.
 *
 * Concretely: any transient network blip between the API process and
 * Postgres that happens to hit an IDLE pooled connection (not one actively
 * running a query) — e.g. Hetzner network hiccup, PG restart during a
 * maintenance window, a firewall/NAT idle-connection reset — takes down the
 * ENTIRE API process for every connected waiter/cashier/kitchen screen at
 * once, instead of the pool silently discarding the bad idle client (its
 * designed, intended recovery behavior). PM2 will restart the process, but
 * every in-flight request at that instant fails and all sockets drop.
 *
 * This test only inspects `pool.listenerCount('error')` — it deliberately
 * does NOT emit a synthetic `'error'` event on a real pool, because doing
 * so on a pool with zero listeners would crash the test runner itself
 * (that is exactly the bug being demonstrated).
 *
 * No DB connection is actually opened for this check (listener count is
 * inspectable pre-connect), but pos_test's connection string is used to
 * stay consistent with the rest of the suite. Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('DB-TX-06 — pg.Pool has no error listener (findings, expected RED)', () => {
  it("DB-TX-06: createPool()'s pool should have an 'error' listener so idle-client network errors don't crash the process", async () => {
    const pool = createPool({ connectionString: DB_URL as string });
    try {
      // FAILS today — createPool() attaches nothing, and neither does the
      // sole production caller (apps/api/src/index.ts:39). Fix: either
      // `pool.on('error', (err) => logger.error(...))` inside createPool()
      // itself, or document + enforce (lint rule / code review) that every
      // caller must attach one immediately after construction.
      expect(pool.listenerCount('error')).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });
});
