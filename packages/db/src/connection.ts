import { Pool } from 'pg';

/**
 * Pool yapılandırması. `connectionString` zorunlu, diğerleri default'lar:
 * - max: 10 connection (CX22 PG için makul)
 * - idleTimeoutMillis: 30s (idle bağlantıları geri ver)
 */
export interface PoolConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
}

/**
 * pg Pool fabrikası. Tüm app'ler bu fonksiyonla pool yaratır;
 * Kysely instance'ı `createKysely(pool)` ile bağlanır.
 */
export function createPool(config: PoolConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
  });
}
