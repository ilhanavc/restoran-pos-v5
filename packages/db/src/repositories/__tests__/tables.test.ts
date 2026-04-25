import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createKysely,
  createPool,
  createTablesRepository,
  type TablesRepository,
} from '../../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../../generated.js';

const DB_URL = process.env['DATABASE_URL'];
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!DB_URL)('TablesRepository (integration)', () => {
  let pool: Pool;
  let db: Kysely<DB>;
  let repo: TablesRepository;
  const createdTableIds: string[] = [];

  beforeAll(() => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
    repo = createTablesRepository(db);
  });

  afterAll(async () => {
    if (createdTableIds.length > 0) {
      await db
        .deleteFrom('tables')
        .where('id', 'in', createdTableIds)
        .where('tenant_id', '=', TENANT_ID)
        .execute();
    }
    await db.destroy();
    await pool.end();
  });

  it('findAll() does not throw on (possibly empty) tenant tables', async () => {
    const rows = await repo.findAll(TENANT_ID);
    expect(Array.isArray(rows)).toBe(true);
  });

  it('findByStatus("available") finds an inserted, order-less table', async () => {
    const id = randomUUID();
    createdTableIds.push(id);
    const code = `T-${id.slice(0, 6)}`;
    await db
      .insertInto('tables')
      .values({
        id,
        tenant_id: TENANT_ID,
        code,
        capacity: 4,
      })
      .execute();

    const available = await repo.findByStatus(TENANT_ID, 'available');
    const found = available.find((t) => t.id === id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('available');
  });

  it('findById() returns null for unknown id', async () => {
    const result = await repo.findById(TENANT_ID, randomUUID());
    expect(result).toBeNull();
  });
});
