import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createKysely,
  createPool,
  createOrdersRepository,
  createPaymentsRepository,
  createUsersRepository,
  type OrdersRepository,
  type PaymentsRepository,
} from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated.js';

/**
 * DB-TX-02 (HIGH) — orders.ts `mergeInto()`'s "no payments" guard
 * (orders.ts ~1577-1586) counts `payments` rows for source+target without
 * filtering `voided_at IS NULL`:
 *
 *   .selectFrom('payments')
 *   .where('order_id', 'in', [source.id, target.id])
 *   ... throws ORDER_HAS_PAYMENTS if count > 0
 *
 * Every other SUM/COUNT site touching payments after ADR-033/Migration 044
 * excludes voided rows (payOrderTx close-check, createTx close-invariant,
 * tables.ts board projection) — mergeInto was never updated for the void
 * feature. Once a payment on an order is voided (e.g. wrong-table mistake,
 * ADR-033), that order can NEVER be merged again, even though it has zero
 * ACTIVE payments — a functional regression introduced by Migration 044
 * landing after Migration 042.
 *
 * Runs ONLY against pos_test (DATABASE_URL env). Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('DB-TX-02 — mergeInto() ignores voided payments (findings, expected RED)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let ordersRepo: OrdersRepository;
  let paymentsRepo: PaymentsRepository;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    ordersRepo = createOrdersRepository(db);
    paymentsRepo = createPaymentsRepository(db);

    tenantId = randomUUID();
    await db
      .insertInto('tenants')
      .values({ id: tenantId, name: 'QA3C DB-TX-02', slug: `qa-3c-dbtx02-${tenantId.slice(0, 8)}` })
      .execute();
    await db.insertInto('tenant_settings').values({ tenant_id: tenantId }).execute();

    const usersRepo = createUsersRepository(db);
    userId = randomUUID();
    await usersRepo.create({
      id: userId,
      tenantId,
      email: `qa3c-dbtx02-${userId}@example.com`,
      username: `qa3c-dbtx02-${userId}`,
      passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
      role: 'cashier',
    });
  });

  afterAll(async () => {
    await db.deleteFrom('payment_items').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('payments').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('order_item_attributes').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('order_items').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('order_no_counters').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tables').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('users').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenant_settings').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
    await db.destroy();
  });

  async function makeTable(): Promise<string> {
    const id = randomUUID();
    await db
      .insertInto('tables')
      .values({ id, tenant_id: tenantId, code: `T-${id.slice(0, 6)}`, capacity: 4 })
      .execute();
    return id;
  }

  it('DB-TX-02: mergeInto() rejects ORDER_HAS_PAYMENTS even when the only payment was voided', async () => {
    const sourceTableId = await makeTable();
    const targetTableId = await makeTable();
    const sourceOrderId = randomUUID();
    const targetOrderId = randomUUID();

    await ordersRepo.create(
      tenantId,
      { id: sourceOrderId, tableId: sourceTableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Tavuk Döner',
          categoryNameSnapshot: 'Dönerler',
          unitPriceCents: 6000,
          quantity: 1,
          totalCents: 6000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );
    await ordersRepo.create(
      tenantId,
      { id: targetOrderId, tableId: targetTableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Ekmek Arası Köfte',
          categoryNameSnapshot: 'Ana Yemek',
          unitPriceCents: 4000,
          quantity: 1,
          totalCents: 4000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );

    // Payment on the source order, WITHOUT closeOrder — order stays 'open'
    // (keeps the reopen-collision codepath out of scope for this finding).
    const paymentId = randomUUID();
    await paymentsRepo.create(tenantId, {
      id: paymentId,
      orderId: sourceOrderId,
      paymentType: 'cash',
      paymentScope: 'full',
      amountCents: 6000,
      idempotencyKey: randomUUID(),
      createdByUserId: userId,
    });

    // Cashier realizes it was entered on the wrong table → voids it.
    await db
      .transaction()
      .execute((trx) =>
        paymentsRepo.voidPayment(trx, tenantId, paymentId, {
          reasonCode: 'wrong_table',
          actorUserId: userId,
        }),
      );
    const voided = await db
      .selectFrom('payments')
      .select('voided_at')
      .where('id', '=', paymentId)
      .executeTakeFirstOrThrow();
    expect(voided.voided_at).not.toBeNull(); // sanity: void itself succeeded

    // DB-TX-02 (HIGH): the source order now has ZERO active payments — the
    // merge should succeed. It does not, because mergeInto's payment-count
    // guard doesn't filter voided_at. This `.resolves` assertion FAILS
    // today (the promise rejects with RepositoryError('check',
    // 'ORDER_HAS_PAYMENTS')). Fix: add `.where('voided_at', 'is', null)` to
    // the payments COUNT query in mergeInto (orders.ts ~1578-1586).
    await expect(
      db.transaction().execute((trx) => ordersRepo.mergeInto(trx, tenantId, sourceOrderId, targetTableId)),
    ).resolves.toMatchObject({ targetOrderId });
  });
});
