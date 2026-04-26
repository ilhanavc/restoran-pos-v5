import { sql, type Kysely } from 'kysely';
import type { DB } from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';

/**
 * Türetilmiş masa durumu. `tables` tablosunda `status` kolonu yok —
 * açık siparişi olan masa = 'occupied', diğerleri = 'available'.
 */
export type DerivedTableStatus = 'available' | 'occupied';

export interface TableWithStatus {
  id: string;
  tenant_id: string;
  code: string;
  capacity: number | null;
  status: DerivedTableStatus;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTableParams {
  id: string;
  code: string;
  capacity?: number | null;
}

export interface TablesRepository {
  findAll(tenantId: string): Promise<TableWithStatus[]>;
  findById(tenantId: string, id: string): Promise<TableWithStatus | null>;
  findByStatus(
    tenantId: string,
    status: DerivedTableStatus,
  ): Promise<TableWithStatus[]>;
  create(tenantId: string, params: CreateTableParams): Promise<TableWithStatus>;
}

/**
 * Tables repository. Status `orders.status='open'` JOIN'i ile türetilir.
 * Açık sipariş tanımı: status NOT IN ('paid','cancelled') §14.2.B ile uyumlu
 * olmasa da bu repo şimdilik literal 'open' kullanır — Görev 12+ siparişlere
 * geçildiğinde semantiği netleştir.
 */
export function createTablesRepository(db: Kysely<DB>): TablesRepository {
  function baseQuery(tenantId: string) {
    return db
      .selectFrom('tables')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('orders')
            .select((s) => [
              'orders.table_id as table_id',
              sql<DerivedTableStatus>`'occupied'`.as('derived_status'),
            ])
            .where('orders.tenant_id', '=', tenantId)
            .where('orders.status', '=', 'open')
            .distinct()
            .as('open_orders'),
        (join) => join.onRef('open_orders.table_id', '=', 'tables.id'),
      )
      .select([
        'tables.id',
        'tables.tenant_id',
        'tables.code',
        'tables.capacity',
        'tables.deleted_at',
        'tables.created_at',
        'tables.updated_at',
        sql<DerivedTableStatus>`COALESCE(open_orders.derived_status, 'available')`.as(
          'status',
        ),
      ])
      .where('tables.tenant_id', '=', tenantId)
      .where('tables.deleted_at', 'is', null);
  }

  return {
    async findAll(tenantId) {
      const rows = await baseQuery(tenantId).execute();
      return rows as TableWithStatus[];
    },

    async findById(tenantId, id) {
      const row = await baseQuery(tenantId)
        .where('tables.id', '=', id)
        .executeTakeFirst();
      return (row ?? null) as TableWithStatus | null;
    },

    async findByStatus(tenantId, status) {
      // GROUP BY yok; HAVING yerine WHERE'in COALESCE üzerinde çalışması için
      // raw SQL fragment kullanıyoruz. Kysely 0.27'de bu en temiz yaklaşım.
      const rows = await baseQuery(tenantId)
        .where(
          sql<DerivedTableStatus>`COALESCE(open_orders.derived_status, 'available')`,
          '=',
          status,
        )
        .execute();
      return rows as TableWithStatus[];
    },

    async create(tenantId, params) {
      try {
        await db
          .insertInto('tables')
          .values({
            id: params.id,
            tenant_id: tenantId,
            code: params.code,
            capacity: params.capacity ?? null,
          })
          .execute();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError('unique', 'TABLE_ALREADY_EXISTS', mapped.detail);
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
      const row = await baseQuery(tenantId)
        .where('tables.id', '=', params.id)
        .executeTakeFirstOrThrow();
      return row as TableWithStatus;
    },
  };
}
