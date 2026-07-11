/**
 * Migration audit — GREEN suite (Blok 3 HAT A, additive).
 *
 * Verifies that the head=044 schema in pos_test upholds the invariants the
 * migration series claims. Structural checks + live behavioral checks against
 * an ISOLATED test tenant (random UUID) with a full cleanup chain. Existing
 * pos_test data is never touched.
 *
 * Run: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pos_test \
 *      pnpm --filter @restoran-pos/db exec vitest run src/__migration-audit__
 *
 * Skips cleanly when DATABASE_URL is unset (CI-without-DB parity with the
 * existing repository integration tests).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DB_URL = process.env['DATABASE_URL'];
const TENANT_ID = randomUUID(); // isolated per run — no collision with pos_test data

interface PgErr {
  code?: string;
}

describe.skipIf(!DB_URL)('Migration guard — schema invariants (head 044)', () => {
  let pool: pg.Pool;

  const q = async (sql: string, params: unknown[] = []): Promise<pg.QueryResult> =>
    pool.query(sql, params);

  /** Insert an order; store_date is trigger-populated (000 populate_order_store_date). */
  const insertOrder = async (opts: {
    id: string;
    tableId: string | null;
    waiterId: string | null;
    orderNo: number;
    status?: string;
  }): Promise<void> => {
    await q(
      `INSERT INTO orders (id, tenant_id, table_id, order_type, status, order_no, waiter_user_id)
       VALUES ($1, $2, $3, 'dine_in', $4, $5, $6)`,
      [opts.id, TENANT_ID, opts.tableId, opts.status ?? 'open', opts.orderNo, opts.waiterId],
    );
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // Base fixture: tenant + tenant_settings (orders trigger requires settings row).
    await q(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)`, [
      TENANT_ID,
      'MIG-AUDIT Tenant',
      `mig-audit-${TENANT_ID.slice(0, 8)}`,
    ]);
    await q(`INSERT INTO tenant_settings (tenant_id, timezone) VALUES ($1, 'Europe/Istanbul')`, [
      TENANT_ID,
    ]);
  });

  afterAll(async () => {
    // Reverse-FK cleanup chain (pre-flight order matters — cross-FK lesson).
    if (pool) {
      for (const t of [
        'payments',
        'order_items',
        'call_logs',
        'orders',
        'tables',
        'areas',
        'users',
        'tenant_settings',
      ]) {
        await q(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_ID]).catch(() => undefined);
      }
      await q(`DELETE FROM tenants WHERE id = $1`, [TENANT_ID]).catch(() => undefined);
      await pool.end();
    }
  });

  // === STRUCTURAL ===

  it('money invariant: every *_cents column is integer/bigint (no float)', async () => {
    const { rows } = await q(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE column_name LIKE '%\\_cents' AND data_type NOT IN ('integer','bigint')`,
    );
    expect(rows).toEqual([]);
  });

  it('multi-tenant invariant: only "tenants" base table lacks tenant_id', async () => {
    const { rows } = await q(
      `SELECT t.table_name
         FROM information_schema.tables t
        WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
          AND t.table_name NOT IN ('pgmigrations','tenants')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
             WHERE c.table_name=t.table_name AND c.column_name='tenant_id')`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it('001+042: order_status enum has all 9 canonical states in order', async () => {
    const { rows } = await q(
      `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
        WHERE t.typname='order_status' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([
      'open',
      'sent_to_kitchen',
      'partially_served',
      'served',
      'billed',
      'paid',
      'cancelled',
      'void',
      'merged',
    ]);
  });

  it('043: every composite (>1 col) SET NULL FK is column-specific (tenant_id preserved)', async () => {
    // confdeltype='n' (SET NULL) + >1 key column MUST carry confdelsetcols,
    // otherwise a parent delete would null tenant_id → 23502 (the 043 bug class).
    const { rows } = await q(
      `SELECT c.conname, array_length(c.conkey,1) AS ncols
         FROM pg_constraint c
        WHERE c.contype='f' AND c.confdeltype='n'
          AND array_length(c.conkey,1) > 1
          AND (c.confdelsetcols IS NULL OR array_length(c.confdelsetcols,1) IS NULL)`,
    );
    expect(rows).toEqual([]); // no composite SET NULL FK may lack a column list
  });

  it('041→042: orders one-active-table partial index uses the terminal-status whitelist', async () => {
    const { rows } = await q(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename='orders' AND indexname='orders_tenant_table_open_uq'`,
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef as string;
    // whitelist: active statuses only; paid/cancelled/void/merged excluded (release slot)
    for (const active of ['open', 'sent_to_kitchen', 'partially_served', 'served', 'billed']) {
      expect(def).toContain(active);
    }
    expect(def).not.toContain("'void'");
    expect(def).not.toContain("'merged'");
  });

  it('044: payments_void_all_or_none CHECK ties voided_at<->reason and EXCLUDES actor', async () => {
    const { rows } = await q(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid='payments'::regclass AND conname='payments_void_all_or_none'`,
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].def as string;
    expect(def).toContain('voided_at');
    expect(def).toContain('void_reason_code');
    expect(def).not.toContain('voided_by_user_id'); // actor NOT in CHECK → user hard-delete safe
  });

  it('generated.ts drift guard: payments DB columns match the Payments interface keys', async () => {
    // Column set expected by src/generated.ts (Payments interface).
    const expected = [
      'amount_cents',
      'cash_received_cents',
      'change_amount_cents',
      'created_at',
      'created_by_user_id',
      'id',
      'idempotency_key',
      'note',
      'order_id',
      'payer_label',
      'payer_no',
      'payment_scope',
      'payment_type',
      'tenant_id',
      'tip_amount_cents',
      'void_reason_code',
      'voided_at',
      'voided_by_user_id',
    ].sort();
    const { rows } = await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='payments' ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(expected);
  });

  // === LIVE BEHAVIORAL (isolated tenant) ===

  it('043: hard-deleting a waiter user NULLs orders.waiter_user_id, preserves tenant_id', async () => {
    const userId = randomUUID();
    const tableId = randomUUID();
    const orderId = randomUUID();
    await q(
      `INSERT INTO users (id, tenant_id, role, username, password_hash)
       VALUES ($1, $2, 'waiter', $3, 'x')`,
      [userId, TENANT_ID, `w-${userId.slice(0, 8)}`],
    );
    await q(`INSERT INTO tables (id, tenant_id, code) VALUES ($1, $2, $3)`, [
      tableId,
      TENANT_ID,
      `TA-${tableId.slice(0, 6)}`,
    ]);
    await insertOrder({ id: orderId, tableId, waiterId: userId, orderNo: 9001 });

    // The key assertion: composite column-specific SET NULL must NOT raise 23503/23502.
    await q(`DELETE FROM users WHERE id = $1`, [userId]);

    const { rows } = await q(
      `SELECT waiter_user_id, tenant_id FROM orders WHERE id = $1`,
      [orderId],
    );
    expect(rows[0].waiter_user_id).toBeNull();
    expect(rows[0].tenant_id).toBe(TENANT_ID); // tenant_id survives (043 fix)
  });

  it('044: void a payment then hard-delete actor — voided_at+reason remain, actor NULLs', async () => {
    const userId = randomUUID();
    const tableId = randomUUID();
    const orderId = randomUUID();
    const payId = randomUUID();
    await q(
      `INSERT INTO users (id, tenant_id, role, username, password_hash)
       VALUES ($1, $2, 'cashier', $3, 'x')`,
      [userId, TENANT_ID, `c-${userId.slice(0, 8)}`],
    );
    await q(`INSERT INTO tables (id, tenant_id, code) VALUES ($1, $2, $3)`, [
      tableId,
      TENANT_ID,
      `TB-${tableId.slice(0, 6)}`,
    ]);
    await insertOrder({ id: orderId, tableId, waiterId: null, orderNo: 9002 });
    await q(
      `INSERT INTO payments (id, tenant_id, order_id, payment_type, payment_scope, amount_cents, idempotency_key, created_by_user_id)
       VALUES ($1, $2, $3, 'cash', 'full', 1500, $4, $5)`,
      [payId, TENANT_ID, orderId, randomUUID(), userId],
    );
    // Soft-void: all three columns atomically.
    await q(
      `UPDATE payments SET voided_at = now(), void_reason_code = 'duplicate', voided_by_user_id = $2
        WHERE id = $1`,
      [payId, userId],
    );

    // Hard-delete the void actor — must NOT raise 23514 (actor excluded from CHECK).
    await q(`DELETE FROM users WHERE id = $1`, [userId]);

    const { rows } = await q(
      `SELECT voided_at, void_reason_code, voided_by_user_id FROM payments WHERE id = $1`,
      [payId],
    );
    expect(rows[0].voided_at).not.toBeNull(); // void record survives
    expect(rows[0].void_reason_code).toBe('duplicate');
    expect(rows[0].voided_by_user_id).toBeNull(); // actor set null
  });

  it('044: partial void (voided_at without reason) is rejected by all-or-none CHECK', async () => {
    const tableId = randomUUID();
    const orderId = randomUUID();
    const payId = randomUUID();
    await q(`INSERT INTO tables (id, tenant_id, code) VALUES ($1, $2, $3)`, [
      tableId,
      TENANT_ID,
      `TC-${tableId.slice(0, 6)}`,
    ]);
    await insertOrder({ id: orderId, tableId, waiterId: null, orderNo: 9003 });
    await q(
      `INSERT INTO payments (id, tenant_id, order_id, payment_type, payment_scope, amount_cents, idempotency_key)
       VALUES ($1, $2, $3, 'cash', 'full', 500, $4)`,
      [payId, TENANT_ID, orderId, randomUUID()],
    );

    let code: string | undefined;
    try {
      await q(`UPDATE payments SET voided_at = now() WHERE id = $1`, [payId]);
    } catch (e) {
      code = (e as PgErr).code;
    }
    expect(code).toBe('23514'); // check_violation
  });

  it('042: void/merged release the table slot; second concurrent-active order is rejected', async () => {
    const tableId = randomUUID();
    const o1 = randomUUID();
    const o2 = randomUUID();
    const o3 = randomUUID();
    await q(`INSERT INTO tables (id, tenant_id, code) VALUES ($1, $2, $3)`, [
      tableId,
      TENANT_ID,
      `TD-${tableId.slice(0, 6)}`,
    ]);
    await insertOrder({ id: o1, tableId, waiterId: null, orderNo: 9004 });

    // Second active order on same table → partial unique index violation.
    let code: string | undefined;
    try {
      await insertOrder({ id: o2, tableId, waiterId: null, orderNo: 9005 });
    } catch (e) {
      code = (e as PgErr).code;
    }
    expect(code).toBe('23505'); // unique_violation while o1 is active

    // Void o1 → slot released → o3 (active) inserts cleanly.
    await q(`UPDATE orders SET status = 'void' WHERE id = $1`, [o1]);
    await insertOrder({ id: o3, tableId, waiterId: null, orderNo: 9006 });
    const { rows } = await q(
      `SELECT count(*)::int AS c FROM orders WHERE table_id = $1 AND status = 'open'`,
      [tableId],
    );
    expect(rows[0].c).toBe(1); // only o3 active
  });
});
