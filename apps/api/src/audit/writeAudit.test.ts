import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '@restoran-pos/db';
import { writeAudit } from './writeAudit.js';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('writeAudit() — integration (ADR-003 §12.4)', () => {
  let pool: Pool;
  let db: Kysely<DB>;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy(); // PostgresDialect.destroy() closes the pool internally
  });

  it('valid payload INSERT geçer', async () => {
    await expect(
      writeAudit(db, {
        tenantId: null,
        eventType: 'auth.login',
        rawPayload: { success: true, reason_code: 'OK' },
      }),
    ).resolves.toBeUndefined();
  });

  it("sanitizer PII throw'u — Error('error.audit.piiDetected')", async () => {
    await expect(
      writeAudit(db, {
        tenantId: null,
        eventType: 'auth.login',
        rawPayload: { success: true, email: 'a@b.com' },
      }),
    ).rejects.toThrow('error.audit.piiDetected');
  });
});
