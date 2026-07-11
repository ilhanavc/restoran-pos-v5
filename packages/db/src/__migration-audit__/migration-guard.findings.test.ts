/**
 * Migration audit — FINDINGS suite (Blok 3 HAT A). INTENTIONALLY RED.
 *
 * Each test encodes an open finding as a failing assertion (DB-MIG-NN). When the
 * finding is fixed, the test flips green and moves to the audit suite. These are
 * deliberate red markers (project convention "kasıtlı kırmızı"), DB-gated so they
 * only assert against pos_test.
 *
 * NOTE: static+live analysis found NO BLOCKER/HIGH in the 42-file series (the
 * team fixed its own bug classes in later migrations: 043←027/032 composite
 * SET NULL, 042←041 blacklist→whitelist, 028←026 smallint cast). The finding
 * below is MEDIUM (latent integrity gap), tracked here for visibility.
 */
import { describe, expect, it } from 'vitest';
import pg from 'pg';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Migration findings (intentionally red)', () => {
  it('DB-MIG-01 [MEDIUM]: 040 tables.display_no lacks a per-(tenant,area) UNIQUE guard', async () => {
    // Migration 040 assigns display_no via app-side MAX+1 but adds NO DB uniqueness
    // constraint. Two tables in the same area can share a display_no (concurrent
    // create / sync bug) → duplicate "Masa N" labels → wrong-table service, the
    // exact hazard 040's own header says it was created to eliminate. A partial
    // UNIQUE INDEX ... (tenant_id, area_id, display_no) WHERE display_no IS NOT NULL
    // would close it. This assertion FAILS until such an index exists.
    const pool = new pg.Pool({ connectionString: DB_URL });
    try {
      const { rows } = await pool.query(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename='tables'
            AND indexdef ILIKE '%UNIQUE%'
            AND indexdef ILIKE '%display_no%'`,
      );
      expect(rows.length).toBeGreaterThan(0); // RED: no such unique index today
    } finally {
      await pool.end();
    }
  });
});
