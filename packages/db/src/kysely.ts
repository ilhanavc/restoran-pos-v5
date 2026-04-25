import { Kysely, PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import type { DB } from './generated.js';

/**
 * Kysely<DB> instance fabrikası. Pool ayrı yönetilir (test/prod farklı pool).
 */
export function createKysely(pool: Pool): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}
