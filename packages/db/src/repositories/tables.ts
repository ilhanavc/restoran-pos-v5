import { sql, type Kysely } from 'kysely';
import type { DB } from '../generated.js';
import type { DbExecutor } from './users.js';
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

export interface UpdateTableParams {
  code?: string;
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
  /** Partial update; en az bir alan dolu olmalı (handler'da garanti edilir). */
  update(
    tenantId: string,
    id: string,
    params: UpdateTableParams,
  ): Promise<TableWithStatus | null>;
  /** Soft delete: deleted_at = now(). Tenant-scoped, idempotent. */
  softDelete(tenantId: string, id: string): Promise<void>;
  /**
   * DELETE guard (Sprint 4 Görev 19 Seçenek A): masa açık (open) bir siparişe
   * bağlıysa silinemez. ADR-003 §14.2.B `NOT IN ('paid','cancelled')` semantiği
   * şu an repository içindeki literal `status='open'` kuralıyla uyumlu —
   * Görev 12+ orders semantiği netleştiğinde tek noktadan güncellenir.
   */
  hasActiveOrders(tenantId: string, id: string): Promise<boolean>;
  /**
   * Sprint 5 Görev 23 — `PATCH /tables/:id/area` (ADR-009). Composite FK
   * `(area_id, tenant_id) → areas (id, tenant_id)` tenant scope'u DB seviyesinde
   * de zorlar; handler `areaId !== null` ise önce areas.findById ile var olduğunu
   * doğrular (404 AREA_NOT_FOUND erken). `areaId = null` → unassign (bölgeden çıkar).
   * Hiçbir satır eşleşmezse `null` döner — handler 404 TABLE_NOT_FOUND fırlatır.
   */
  updateAreaId(
    tenantId: string,
    id: string,
    areaId: string | null,
  ): Promise<TableWithStatus | null>;
}

/**
 * Tables repository. Status `orders.status='open'` JOIN'i ile türetilir.
 * Açık sipariş tanımı: status NOT IN ('paid','cancelled') §14.2.B ile uyumlu
 * olmasa da bu repo şimdilik literal 'open' kullanır — Görev 12+ siparişlere
 * geçildiğinde semantiği netleştir.
 *
 * Transaction-aware: `db` parametresi `Kysely<DB>` veya `Transaction<DB>` olabilir.
 * `softDelete + hasActiveOrders + writeAudit` çağrıları DELETE handler'ında
 * tek transaction içinde çağrılır (ADR-002 §10.4 atomicity kontratı).
 */
export function createTablesRepository(db: DbExecutor): TablesRepository {
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

    async update(tenantId, id, params) {
      const patch: Partial<{ code: string; capacity: number | null }> = {};
      if (params.code !== undefined) patch.code = params.code;
      if (params.capacity !== undefined) patch.capacity = params.capacity;

      try {
        const updated = await db
          .updateTable('tables')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) return null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError('unique', 'TABLE_ALREADY_EXISTS', mapped.detail);
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
      // Final state'i derived status ile birlikte oku.
      const row = await baseQuery(tenantId)
        .where('tables.id', '=', id)
        .executeTakeFirst();
      return (row ?? null) as TableWithStatus | null;
    },

    async softDelete(tenantId, id) {
      await db
        .updateTable('tables')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
    },

    async hasActiveOrders(tenantId, id) {
      // EXISTS semantiği: tek satır okumak yeter, count gerekmez.
      const row = await db
        .selectFrom('orders')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('table_id', '=', id)
        .where('status', '=', 'open')
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },

    async updateAreaId(tenantId, id, areaId) {
      // Composite FK violation (area_id, tenant_id) → 23503 foreign_key.
      // Handler genelde önce areas.findById ile guard ediyor, ama defansif
      // catch: cross-tenant area_id veya yarış ile silinmiş area_id durumunda
      // RepositoryError 'foreign_key' fırlatılır → handler AREA_NOT_FOUND'a
      // map edebilir.
      try {
        const updated = await db
          .updateTable('tables')
          .set({ area_id: areaId })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) return null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
      const row = await baseQuery(tenantId)
        .where('tables.id', '=', id)
        .executeTakeFirst();
      return (row ?? null) as TableWithStatus | null;
    },
  };
}
