import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  createKysely,
  createPool,
  createOrdersRepository,
  createUsersRepository,
  type OrdersRepository,
} from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated.js';

/**
 * DB-TX-05 (BLOCKER) — payments.ts `createTx()`'s idempotency-race recovery
 * path is unreachable in practice. On a genuine concurrent duplicate-key
 * race (two requests with the same idempotency_key racing each other — the
 * exact scenario idempotency keys exist to protect against: double-tap
 * "Öde", client retry-on-timeout), the losing INSERT fails with 23505
 * (payments.ts:245-264). The `catch` block then tries to recover by
 * re-querying for the replay row ON THE SAME TRANSACTION (payments.ts:270):
 *
 *   const replay = await trx.selectFrom('payments')...executeTakeFirstOrThrow();
 *
 * PostgreSQL aborts an ENTIRE transaction after any error inside it (unless
 * a SAVEPOINT precedes the risky statement) — every subsequent command,
 * including a harmless SELECT, is rejected with `25P02 current transaction
 * is aborted, commands ignored until end of transaction block`. There is no
 * SAVEPOINT before the INSERT here, so this recovery SELECT ALWAYS throws
 * 25P02 instead of returning the replay row. `mapPgError()` has no case for
 * 25P02 either (DB-TX-03 territory) → the raw pg error propagates to the
 * caller. The documented behavior ("Idempotency race — paralel iki request:
 * replay safety. Yeniden çek.") never actually executes.
 *
 * Net effect: the loser of a real concurrent double-submit gets a hard
 * error instead of the expected idempotent replay. If the client
 * regenerates the idempotency key on error-triggered retry, this can result
 * in a genuine DUPLICATE payment being recorded for the same order.
 *
 * This test forces the exact interleaving deterministically with two raw
 * `pg.Client` sessions mirroring createTx's own SQL verbatim (payments.ts
 * :192-284) — a plain `Promise.all` race is timing-dependent here (the
 * first call frequently fully commits before the second even sends its
 * first query on a fast local Postgres, which would skip the race window
 * on some runs and not others).
 *
 * Runs ONLY against pos_test (DATABASE_URL env). Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('DB-TX-05 — payments.createTx() idempotency-race recovery is unreachable (findings, expected RED)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let ordersRepo: OrdersRepository;
  let tenantId: string;
  let userId: string;
  let orderId: string;

  beforeAll(async () => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    ordersRepo = createOrdersRepository(db);

    tenantId = randomUUID();
    await db
      .insertInto('tenants')
      .values({ id: tenantId, name: 'QA3C DB-TX-05', slug: `qa-3c-dbtx05-${tenantId.slice(0, 8)}` })
      .execute();
    await db.insertInto('tenant_settings').values({ tenant_id: tenantId }).execute();

    const usersRepo = createUsersRepository(db);
    userId = randomUUID();
    await usersRepo.create({
      id: userId,
      tenantId,
      email: `qa3c-dbtx05-${userId}@example.com`,
      username: `qa3c-dbtx05-${userId}`,
      passwordHash: '$2b$12$dummyhashfortestpurpose0000000000000000000000',
      role: 'cashier',
    });

    const tableId = randomUUID();
    await db.insertInto('tables').values({ id: tableId, tenant_id: tenantId, code: 'R1', capacity: 4 }).execute();
    orderId = randomUUID();
    await ordersRepo.create(
      tenantId,
      { id: orderId, tableId, orderType: 'dine_in', storeDate: new Date() },
      [
        {
          id: randomUUID(),
          productId: null,
          productName: 'Testi Kebabı',
          categoryNameSnapshot: 'Ana Yemek',
          unitPriceCents: 5000,
          quantity: 1,
          totalCents: 5000,
          createdByUserId: null,
          createdByName: null,
        },
      ],
    );
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

  it('DB-TX-05: the losing side of a real idempotency-key race gets 25P02 instead of the replay row', async () => {
    const idempotencyKey = randomUUID();
    const clientA = new Client({ connectionString: DB_URL as string });
    const clientB = new Client({ connectionString: DB_URL as string });
    await clientA.connect();
    await clientB.connect();

    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');

      // Phase 1 — both sessions mirror createTx's idempotency pre-check
      // (payments.ts:194-199): neither sees an existing row yet.
      const preA = await clientA.query('SELECT id FROM payments WHERE tenant_id = $1 AND idempotency_key = $2', [
        tenantId,
        idempotencyKey,
      ]);
      const preB = await clientB.query('SELECT id FROM payments WHERE tenant_id = $1 AND idempotency_key = $2', [
        tenantId,
        idempotencyKey,
      ]);
      expect(preA.rows).toHaveLength(0);
      expect(preB.rows).toHaveLength(0);

      // Phase 2 — A "wins": INSERT + COMMIT (mirrors payments.ts:245-264,
      // minimal required columns).
      const paymentAId = randomUUID();
      await clientA.query(
        `INSERT INTO payments (id, tenant_id, order_id, payment_type, payment_scope,
           amount_cents, idempotency_key, created_by_user_id)
         VALUES ($1, $2, $3, 'cash', 'full', 5000, $4, $5)`,
        [paymentAId, tenantId, orderId, idempotencyKey, userId],
      );
      await clientA.query('COMMIT');

      // Phase 3 — B "loses": the SAME INSERT now violates the
      // (tenant_id, idempotency_key) UNIQUE index → 23505, aborting B's tx.
      let insertBError: { code?: string } | null = null;
      try {
        const paymentBId = randomUUID();
        await clientB.query(
          `INSERT INTO payments (id, tenant_id, order_id, payment_type, payment_scope,
             amount_cents, idempotency_key, created_by_user_id)
           VALUES ($1, $2, $3, 'cash', 'full', 5000, $4, $5)`,
          [paymentBId, tenantId, orderId, idempotencyKey, userId],
        );
      } catch (err) {
        insertBError = err as { code?: string };
      }
      expect(insertBError?.code).toBe('23505');

      // Phase 4 — createTx's documented recovery: re-SELECT the replay row
      // ON THE SAME (now-aborted) transaction (payments.ts:270-275).
      let recoveryError: { code?: string; message?: string } | null = null;
      try {
        await clientB.query('SELECT id FROM payments WHERE tenant_id = $1 AND idempotency_key = $2', [
          tenantId,
          idempotencyKey,
        ]);
      } catch (err) {
        recoveryError = err as { code?: string; message?: string };
      }

      // DB-TX-05 (BLOCKER): the recovery SELECT should succeed and return
      // the winner's row (idempotent replay) — instead it throws 25P02
      // ("current transaction is aborted"). Fix: wrap the INSERT in a
      // SAVEPOINT so the catch-block can `ROLLBACK TO SAVEPOINT` before
      // re-querying, OR re-run the replay SELECT on a fresh
      // connection/transaction instead of the poisoned one.
      expect(recoveryError).toBeNull();
    } finally {
      await Promise.allSettled([clientA.query('ROLLBACK'), clientB.query('ROLLBACK')]);
      await clientA.end();
      await clientB.end();
    }
  });
});
