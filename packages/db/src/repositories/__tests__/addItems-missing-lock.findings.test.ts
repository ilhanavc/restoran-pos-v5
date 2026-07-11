import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createKysely, createPool, createOrdersRepository, type OrdersRepository } from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB, OrderStatus } from '../../generated.js';

/**
 * DB-TX-01 (BLOCKER) — orders.ts `addItems()` / `updateItemTx()` read the
 * parent order's status WITHOUT `FOR UPDATE` (orders.ts:702-707 and
 * :790-795), unlike `payOrderTx`/`cancelOrder`/`assignCustomer`/
 * `moveToTable`/`mergeInto`, which all lock the order row before acting.
 *
 * A concurrent `cancelOrder()` (which DOES take `FOR UPDATE`) can commit its
 * cancellation *between* addItems' unlocked read and addItems' later
 * INSERT + total_cents recalc UPDATE. Nothing at the DB level backstops
 * this either — the only triggers touching `orders`/`order_items` are
 * `set_updated_at`, `populate_order_store_date`, `reject_temporal_update`
 * and `block_comped_item_in_payment` (payment_items only); none of them
 * tie order_items inserts to orders.status.
 *
 * Result: a 'cancelled' order can end up with total_cents > 0 and a live
 * (non-cancelled) order_item — an invariant violation that would print a
 * receipt for an item on a supposedly-void order.
 *
 * This test manually interleaves two sessions to FORCE the exact race
 * window deterministically (real Promise.all timing is not reliable enough
 * to reproduce this reliably — see feedback_avoid_overcheckpoint /
 * flaky-test discipline). Session A repeats the EXACT SQL addItems() runs
 * (orders.ts:544-599 insertItemsAndRecalc, called from :700-733); the
 * cancellation in between is the REAL, unmodified `cancelOrder()` repo call
 * (orders.ts:955-1008) — no production code is copied or modified.
 *
 * Runs ONLY against pos_test (DATABASE_URL env). Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('DB-TX-01 — addItems() missing row lock (findings, expected RED)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let ordersRepo: OrdersRepository;
  let tenantId: string;
  let tableId: string;

  beforeAll(async () => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    ordersRepo = createOrdersRepository(db);

    tenantId = randomUUID();
    await db
      .insertInto('tenants')
      .values({ id: tenantId, name: 'QA3C DB-TX-01', slug: `qa-3c-dbtx01-${tenantId.slice(0, 8)}` })
      .execute();
    await db.insertInto('tenant_settings').values({ tenant_id: tenantId }).execute();
    tableId = randomUUID();
    await db.insertInto('tables').values({ id: tableId, tenant_id: tenantId, code: 'R1', capacity: 4 }).execute();
  });

  afterAll(async () => {
    await db.deleteFrom('order_item_attributes').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('order_no_counters').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tables').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenant_settings').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
    await db.destroy();
  });

  it('DB-TX-01: concurrent addItems + cancelOrder leaves order cancelled but total_cents > 0 with a live item', async () => {
    const orderId = randomUUID();
    await ordersRepo.create(
      tenantId,
      { id: orderId, tableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Adana Kebap',
          categoryNameSnapshot: 'Kebaplar',
          unitPriceCents: 20000,
          quantity: 1,
          totalCents: 20000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );

    const clientA = new Client({ connectionString: DB_URL as string });
    await clientA.connect();
    await clientA.query('BEGIN');

    // Phase 1 — addItems' unlocked read (orders.ts:702-707): plain SELECT,
    // no FOR UPDATE. The order is still 'open' at this instant.
    const readBack = await clientA.query<{ status: OrderStatus }>(
      'SELECT status FROM orders WHERE id = $1 AND tenant_id = $2',
      [orderId, tenantId],
    );
    expect(readBack.rows[0]?.status).toBe('open');

    // --- Meanwhile: the REAL, unmodified cancelOrder() runs to completion on
    // its own connection (own transaction, takes FOR UPDATE, commits). ---
    const cancelResult = await ordersRepo.cancelOrder(tenantId, orderId);
    expect(cancelResult.order.status).toBe('cancelled');
    expect(cancelResult.order.total_cents).toBe(0);

    // Phase 2 — addItems' write phase (orders.ts:544-599 insertItemsAndRecalc):
    // INSERT the new item + recalc total_cents, on the SAME connection/tx
    // opened above (i.e. still operating on the stale 'open' read from
    // phase 1 — this is exactly what the real addItems() would do).
    const newItemId = randomUUID();
    await clientA.query(
      `INSERT INTO order_items (id, tenant_id, order_id, product_id, product_name,
         category_name_snapshot, unit_price_cents, quantity, total_cents,
         note, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, NULL, 'Ayran', 'İçecekler', 2000, 1, 2000, NULL, NULL, NULL)`,
      [newItemId, tenantId, orderId],
    );
    await clientA.query(
      `UPDATE orders SET total_cents = (
         SELECT COALESCE(SUM(total_cents), 0) FROM order_items
         WHERE order_id = $1 AND tenant_id = $2
       ), updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [orderId, tenantId],
    );
    await clientA.query('COMMIT');
    await clientA.end();

    const finalOrder = await db
      .selectFrom('orders')
      .select(['status', 'total_cents'])
      .where('id', '=', orderId)
      .executeTakeFirstOrThrow();
    const liveItems = await db
      .selectFrom('order_items')
      .select('id')
      .where('order_id', '=', orderId)
      .where('status', '!=', 'cancelled')
      .execute();

    // Sanity: cancelOrder() itself did apply.
    expect(finalOrder.status).toBe('cancelled');
    // DB-TX-01 (BLOCKER): a cancelled order must never carry a positive
    // total_cents or a live item. These two assertions FAIL today — the
    // race above resurrects total_cents to 2000 and leaves the Ayran item
    // with status='open' on a 'cancelled' order. Fix: addItems()/
    // updateItemTx() must `.forUpdate()` the order row (mirroring
    // payOrderTx/cancelOrder), so cancelOrder either wins the lock first
    // (addItems then sees status='cancelled' and rejects) or addItems wins
    // first (cancelOrder then correctly cancels the just-added item too).
    expect(finalOrder.total_cents).toBe(0);
    expect(liveItems).toHaveLength(0);
  });
});
