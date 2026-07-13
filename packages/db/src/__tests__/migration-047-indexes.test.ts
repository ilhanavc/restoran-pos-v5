import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createKysely, createPool } from '../index.js';
import type { Pool } from 'pg';
import type { Kysely } from 'kysely';
import type { DB } from '../generated.js';

/**
 * Migration 047 — order_items + orders performans index'leri regression.
 *
 * DB-TX-04 (order_items order_id Seq Scan) + R7-AGG-PERF-01 (orders rapor
 * tarih-aralığı) denetim bulguları. Bu test index'lerin migrate sonrası
 * GERÇEKTEN var olduğunu + doğru kolonlarda olduğunu kanıtlar; migration
 * silinir/kolon sırası bozulursa kırılır (canlı-veride Seq Scan sessizce geri
 * dönmesin). Kolon sırası leading-column optimizasyonunun garantisidir.
 */

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Migration 047 perf index regression', () => {
  let pool: Pool;
  let db: Kysely<DB>;

  beforeAll(() => {
    pool = createPool({ connectionString: DB_URL as string });
    db = createKysely(pool);
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function indexDef(indexName: string): Promise<string | undefined> {
    const res = await sql<{ indexdef: string }>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ${indexName}
    `.execute(db);
    return res.rows[0]?.indexdef;
  }

  it('order_items_order_id_idx var ve (order_id, tenant_id) sırasında', async () => {
    const def = await indexDef('order_items_order_id_idx');
    expect(def).toBeDefined();
    // Leading column order_id (yüksek seçicilik), tenant_id ikincil.
    expect(def).toMatch(/ON public\.order_items[\s\S]*\(order_id, tenant_id\)/);
  });

  it('orders_tenant_created_at_idx var ve (tenant_id, created_at) sırasında', async () => {
    const def = await indexDef('orders_tenant_created_at_idx');
    expect(def).toBeDefined();
    // Leading column tenant_id (her rapor eşitlik-filtresi), created_at range.
    expect(def).toMatch(/ON public\.orders[\s\S]*\(tenant_id, created_at\)/);
  });
});
