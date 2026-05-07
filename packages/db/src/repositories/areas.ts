import { type Selectable } from 'kysely';
import type { Areas } from '../generated.js';
import type { DbExecutor } from './users.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type AreaRow = Selectable<Areas>;

export interface CreateAreaParams {
  id: string;
  name: string;
  sortOrder?: number;
}

export interface UpdateAreaParams {
  name?: string;
  sortOrder?: number;
}

export interface AreasRepository {
  /**
   * Tek bölge lookup, tenant-scoped, soft-deleted satır dönmez. Cross-tenant
   * id → null (handler 404 AREA_NOT_FOUND fırlatır, enumeration sızdırılmaz).
   */
  findById(tenantId: string, id: string): Promise<AreaRow | null>;
  /**
   * Aktif bölgeler, tenant-scoped. Sıralama: sort_order ASC, name ASC tiebreaker
   * (ADR-009 Domain service). Soft-deleted satırlar düşürülür.
   */
  findAll(tenantId: string): Promise<AreaRow[]>;
  /**
   * INSERT. Duplicate name (case-insensitive partial UNIQUE
   * `lower(trim(name)) WHERE deleted_at IS NULL`, Migration 007) →
   * `RepositoryError('unique', 'AREA_NAME_ALREADY_EXISTS')` → handler 409.
   */
  create(tenantId: string, params: CreateAreaParams): Promise<AreaRow>;
  /**
   * Partial update. En az bir alan dolu olmalı (handler refine garanti eder).
   * Tenant-scoped, deleted_at IS NULL filtresi. Hiçbir satır eşleşmezse `null`
   * döner — handler 404 AREA_NOT_FOUND fırlatır. Duplicate name → 409.
   */
  update(
    tenantId: string,
    id: string,
    params: UpdateAreaParams,
  ): Promise<AreaRow | null>;
  /**
   * Hard delete (Session 53b — ADR-003 + ADR-009 Amendment 2026-05-05).
   * `DELETE FROM areas WHERE tenant_id = $1 AND id = $2`. Tenant-scoped,
   * idempotent (yoksa 0 satır siler).
   *
   * Caller (DELETE handler) önce `unlinkTablesFromArea` çağırır (cascade NULL
   * pattern korunur), sonra `hardDelete` ile bölgeyi siler — hepsi tek
   * transaction (ADR-002 §10.4).
   */
  hardDelete(tenantId: string, id: string): Promise<void>;
  /**
   * ADR-009 Domain service Karar 5 — service-level cascade NULL (KORUNUR).
   * Hard delete yapılacak bölgeye bağlı tables satırlarını `area_id = NULL`
   * ile günceller ve etkilenen satır sayısını döndürür. Service handler
   * aynı transaction içinde önce bu çağrıyı sonra `hardDelete` çağırır.
   */
  unlinkTablesFromArea(tenantId: string, areaId: string): Promise<number>;
}

/**
 * Areas repository. Transaction-aware (`Kysely<DB>` veya `Transaction<DB>`).
 * DELETE handler'ında `softDelete + unlinkTablesFromArea + writeAudit` tek
 * transaction içinde çağrılır (ADR-002 §10.4 atomicity, ADR-009 Domain
 * service Karar 5).
 */
export function createAreasRepository(db: DbExecutor): AreasRepository {
  return {
    async findById(tenantId, id) {
      const row = await db
        .selectFrom('areas')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return row ?? null;
    },

    async findAll(tenantId) {
      return db
        .selectFrom('areas')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .execute();
    },

    async create(tenantId, params) {
      try {
        return await db
          .insertInto('areas')
          .values({
            id: params.id,
            tenant_id: tenantId,
            name: params.name,
            ...(params.sortOrder !== undefined
              ? { sort_order: params.sortOrder }
              : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError(
            'unique',
            'AREA_NAME_ALREADY_EXISTS',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async update(tenantId, id, params) {
      const patch: Partial<{ name: string; sort_order: number }> = {};
      if (params.name !== undefined) patch.name = params.name;
      if (params.sortOrder !== undefined) patch.sort_order = params.sortOrder;

      try {
        const row = await db
          .updateTable('areas')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst();
        return row ?? null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError(
            'unique',
            'AREA_NAME_ALREADY_EXISTS',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async hardDelete(tenantId, id) {
      // Session 53b: hard delete. Caller önce unlinkTablesFromArea
      // çağırmış olmalı; FK violation defansif (yine de tx atomicity).
      await db
        .deleteFrom('areas')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();
    },

    async unlinkTablesFromArea(tenantId, areaId) {
      // Session 53b: tables artık hard-delete pattern'inde — `deleted_at IS NULL`
      // filtresine gerek yok (tüm satırlar zaten "aktif"). Filter kaldırıldı.
      const result = await db
        .updateTable('tables')
        .set({ area_id: null })
        .where('tenant_id', '=', tenantId)
        .where('area_id', '=', areaId)
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },
  };
}
