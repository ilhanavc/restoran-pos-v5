import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createKysely,
  createPool,
  createOrdersRepository,
  createPaymentsRepository,
  createUsersRepository,
  RepositoryError,
  type OrdersRepository,
  type PaymentsRepository,
} from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated.js';

/**
 * Deep audit — Blok 3 / Hat C (packages/db). Real, parallel (Promise.all)
 * concurrency against pos_test — proves the DB-level backstops (partial
 * unique indexes, idempotency UNIQUE) actually resolve races correctly.
 *
 * Runs ONLY against pos_test (DATABASE_URL env). Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Concurrency audit (Hat C)', () => {
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
      .values({
        id: tenantId,
        name: 'QA3C Concurrency',
        slug: `qa-3c-concurrency-${tenantId.slice(0, 8)}`,
      })
      .execute();
    await db
      .insertInto('tenant_settings')
      .values({ tenant_id: tenantId })
      .execute();

    const usersRepo = createUsersRepository(db);
    userId = randomUUID();
    await usersRepo.create({
      id: userId,
      tenantId,
      email: `qa3c-cc-${userId}@example.com`,
      username: `qa3c-cc-${userId}`,
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

  it('two concurrent dine_in order creates on the SAME table: exactly one succeeds (041/042 exclude-void unique index)', async () => {
    const tableId = await makeTable();
    const idA = randomUUID();
    const idB = randomUUID();

    const results = await Promise.allSettled([
      ordersRepo.create(tenantId, { id: idA, tableId, orderType: 'dine_in', storeDate: new Date() }),
      ordersRepo.create(tenantId, { id: idB, tableId, orderType: 'dine_in', storeDate: new Date() }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedResult = rejected[0];
    if (rejectedResult === undefined || rejectedResult.status !== 'rejected') {
      throw new Error('expected exactly one rejected promise');
    }
    const reason: unknown = rejectedResult.reason;
    expect(reason).toBeInstanceOf(RepositoryError);
    expect((reason as RepositoryError).cause).toBe('unique');

    // Exactly one active order must remain on the table — no double-booking,
    // no lost booking either.
    const activeOrders = await db
      .selectFrom('orders')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('table_id', '=', tableId)
      .where('status', 'not in', ['paid', 'cancelled', 'void', 'merged'])
      .execute();
    expect(activeOrders).toHaveLength(1);
  });

  it('sequential double-submit with the SAME idempotency key: second call replays the first (no duplicate row)', async () => {
    // NOTE: a genuinely concurrent (Promise.all) double-INSERT race on the
    // same idempotency_key is covered separately in
    // `payment-idempotency-race.findings.test.ts` (DB-TX-05, BLOCKER) using
    // a deterministic two-client interleave — real network/scheduling
    // timing makes a plain Promise.all race non-deterministic here (the
    // first call frequently fully commits before the second even sends its
    // first query, which would silently skip the race window and make this
    // "pass" for the wrong reason on some runs but not others = flaky).
    // This test instead proves the always-reachable, always-safe path: a
    // client retries an already-completed request (e.g. after a slow
    // response) and must get the ORIGINAL payment back, not a duplicate.
    const tableId = await makeTable();
    const orderId = randomUUID();
    await ordersRepo.create(
      tenantId,
      { id: orderId, tableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'İskender',
          categoryNameSnapshot: 'Ana Yemek',
          unitPriceCents: 5000,
          quantity: 1,
          totalCents: 5000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );

    const idempotencyKey = randomUUID();
    const r1 = await db
      .transaction()
      .execute((trx) =>
        paymentsRepo.createTx(trx, tenantId, {
          id: randomUUID(),
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: 5000,
          idempotencyKey,
          createdByUserId: userId,
        }),
      );
    const r2 = await db
      .transaction()
      .execute((trx) =>
        paymentsRepo.createTx(trx, tenantId, {
          id: randomUUID(),
          orderId,
          paymentType: 'cash',
          paymentScope: 'full',
          amountCents: 5000,
          idempotencyKey,
          createdByUserId: userId,
        }),
      );

    expect(r1.replayed).toBe(false);
    expect(r2.replayed).toBe(true);
    expect(r2.payment.id).toBe(r1.payment.id);

    const rows = await db
      .selectFrom('payments')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('idempotency_key', '=', idempotencyKey)
      .execute();
    expect(rows).toHaveLength(1);
  });
});
