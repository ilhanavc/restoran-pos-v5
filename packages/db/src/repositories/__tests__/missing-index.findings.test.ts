import { describe, expect, it } from 'vitest';
import { Client } from 'pg';

/**
 * DB-TX-04 (HIGH, PERF) — `order_items` has no index whose leading column
 * is `order_id`. Repository code filters `WHERE order_id = $1 AND
 * tenant_id = $2` on nearly every order interaction:
 *   - orders.ts fetchItemsWithAttributes (:502-508)
 *   - orders.ts insertItemsAndRecalc total_cents subquery (:588-599)
 *   - orders.ts updateItemTx recalc subquery (:855-871)
 *   - orders.ts mergeInto re-parent UPDATE + recalc (:1591-1625)
 *   - orders.ts cancelOrder / cancelTakeawayOrder item status UPDATEs
 *   - payments.ts createTx item-allocation lookup (:296-302)
 *
 * Empirically confirmed live against pos_test (000_init.sql / kysely
 * generated schema): order_items only has `pkey(id)`, `(id, tenant_id)`,
 * `(tenant_id, product_name)` and `(tenant_id, category_name_snapshot)` —
 * none usable for an `order_id` lookup. `EXPLAIN SELECT * FROM order_items
 * WHERE order_id = ? AND tenant_id = ?` chose `Seq Scan on order_items`.
 * As order_items grows (append-only, no purge), every order detail view,
 * item add, recalculation, cancel and merge gets linearly slower.
 *
 * This test only introspects `pg_indexes` (schema check, not row-count
 * dependent) — deterministic, no EXPLAIN-plan flakiness.
 *
 * Runs ONLY against pos_test (DATABASE_URL env). Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('DB-TX-04 — order_items: no index on order_id (findings, expected RED)', () => {
  it("DB-TX-04: order_items should have an index usable for WHERE order_id = ? (the repo's hottest filter)", async () => {
    const client = new Client({ connectionString: DB_URL as string });
    await client.connect();
    try {
      const { rows } = await client.query<{ indexname: string; indexdef: string }>(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='order_items'",
      );
      const hasOrderIdIndex = rows.some((r) => /\(order_id\b/.test(r.indexdef));
      expect(hasOrderIdIndex).toBe(true); // FAILS today — no such index exists
    } finally {
      await client.end();
    }
  });
});
