import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createKysely, createPool, mapPgError } from '../../index.js';

/**
 * DB-TX-03 (HIGH) — errors.ts `mapPgError()` has no `case` for contention
 * or type-coercion PG error codes:
 *   - 40001 serialization_failure
 *   - 40P01 deadlock_detected
 *   - 22P02 invalid_text_representation (e.g. malformed UUID string)
 *   - 22003 numeric_value_out_of_range (e.g. integer overflow)
 *
 * All four fall through to `default: return null` (errors.ts:83-84). Per
 * this file's own doc comment ("Raw pg hatası asla üst katmana sızmaz"),
 * every repo catch-block does `if (mapped !== null) throw mapped; throw
 * err;` — so an unmapped code means the RAW `pg` DatabaseError propagates
 * unchanged all the way to the route handler, which (apps/api toHttpError)
 * has no `instanceof RepositoryError` match and falls back to a generic
 * 500 INTERNAL_ERROR. There is also no retry-on-conflict logic anywhere in
 * packages/db, so a transient deadlock/serialization failure is a hard
 * failure for the end user (waiter/cashier), not an automatic retry.
 *
 * Runs ONLY against pos_test for the live deadlock sub-test (DATABASE_URL
 * env). The static sub-tests need no DB. Never touches pos_dev.
 */
const DB_URL = process.env['DATABASE_URL'];

describe('DB-TX-03 — errors.ts: contention/type PG codes unmapped (findings, expected RED)', () => {
  it('DB-TX-03a: mapPgError() should map serialization_failure (40001) to a RepositoryError', () => {
    const mapped = mapPgError({ code: '40001', message: 'could not serialize access due to concurrent update' });
    expect(mapped).not.toBeNull();
  });

  it('DB-TX-03b: mapPgError() should map deadlock_detected (40P01) to a RepositoryError', () => {
    const mapped = mapPgError({ code: '40P01', message: 'deadlock detected' });
    expect(mapped).not.toBeNull();
  });

  it('DB-TX-03c: mapPgError() should map invalid_text_representation (22P02) to a RepositoryError', () => {
    const mapped = mapPgError({ code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' });
    expect(mapped).not.toBeNull();
  });

  it('DB-TX-03d: mapPgError() should map numeric_value_out_of_range (22003) to a RepositoryError', () => {
    const mapped = mapPgError({ code: '22003', message: 'integer out of range' });
    expect(mapped).not.toBeNull();
  });

  describe.skipIf(!DB_URL)('live deadlock reproduction (pos_test)', () => {
    it('DB-TX-03e: a REAL PG deadlock (40P01) between two order-row locks is unmapped by mapPgError()', async () => {
      const pool = createPool({ connectionString: DB_URL as string });
      const db = createKysely(pool);
      const tenantId = randomUUID();
      const orderAId = randomUUID();
      const orderBId = randomUUID();

      try {
        await db
          .insertInto('tenants')
          .values({ id: tenantId, name: 'QA3C DB-TX-03', slug: `qa-3c-dbtx03-${tenantId.slice(0, 8)}` })
          .execute();
        // orders_populate_store_date trigger requires a tenant_settings row
        // (looks up timezone) — without it, INSERT INTO orders is rejected
        // before we ever reach the deadlock scenario.
        await db.insertInto('tenant_settings').values({ tenant_id: tenantId }).execute();
        const today = new Date();
        await db
          .insertInto('orders')
          .values([
            {
              id: orderAId,
              tenant_id: tenantId,
              table_id: null,
              order_type: 'dine_in',
              order_no: 1,
              store_date: today,
            },
            {
              id: orderBId,
              tenant_id: tenantId,
              table_id: null,
              order_type: 'dine_in',
              order_no: 2,
              store_date: today,
            },
          ])
          .execute();

        const clientA = new Client({ connectionString: DB_URL as string });
        const clientB = new Client({ connectionString: DB_URL as string });
        await clientA.connect();
        await clientB.connect();

        try {
          await clientA.query('BEGIN');
          await clientB.query('BEGIN');

          // A locks order A, B locks order B — no contention yet.
          await clientA.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderAId]);
          await clientB.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderBId]);

          // Cross-request in REVERSE order: A now wants B's row, B wants A's
          // row — classic circular wait. Fire both without sequential
          // awaits so PG's deadlock detector (deadlock_timeout, default 1s)
          // has to intervene.
          const pA = clientA.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderBId]);
          const pB = clientB.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderAId]);

          const results = await Promise.allSettled([pA, pB]);
          const rejected = results.find(
            (r): r is PromiseRejectedResult => r.status === 'rejected',
          );
          expect(rejected).toBeDefined();
          const err = rejected?.reason as { code?: string; message?: string };
          // Proves PG really raises deadlock_detected for this interaction —
          // not a hypothetical error shape.
          expect(err.code).toBe('40P01');

          // DB-TX-03 (HIGH): today mapPgError() has no case for '40P01' →
          // falls through to `default: return null` — a real deadlock error
          // from a repo method would leak as a raw, unmapped pg
          // DatabaseError. This assertion FAILS today (mapped === null).
          const mapped = mapPgError(err);
          expect(mapped).not.toBeNull();
        } finally {
          await Promise.allSettled([clientA.query('ROLLBACK'), clientB.query('ROLLBACK')]);
          await clientA.end();
          await clientB.end();
        }
      } finally {
        await db.deleteFrom('orders').where('tenant_id', '=', tenantId).execute();
        await db.deleteFrom('tenant_settings').where('tenant_id', '=', tenantId).execute();
        await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
        await db.destroy();
      }
    });
  });
});
