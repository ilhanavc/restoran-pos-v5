import { sql } from 'kysely';
import type { DbExecutor } from './users.js';
import { mapPgError, RepositoryError } from '../errors.js';

export interface AttributeOptionRow {
  id: string;
  tenant_id: string;
  group_id: string;
  name: string;
  extra_price_cents: number;
  is_default: boolean;
  sort_order: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAttributeOptionParams {
  id: string;
  name: string;
  extraPriceCents?: number;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface UpdateAttributeOptionParams {
  name?: string;
  extraPriceCents?: number;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface AttributeOptionsRepository {
  /** Belirli grubun aktif seçenekleri (soft-deleted dahil değil). */
  findByGroupId(
    tenantId: string,
    groupId: string,
  ): Promise<AttributeOptionRow[]>;
  /** Tenant-scoped tek seçenek, soft-deleted satır dönmez. */
  findById(tenantId: string, id: string): Promise<AttributeOptionRow | null>;
  /**
   * INSERT. Duplicate name (case-insensitive partial UNIQUE per group_id) →
   * `RepositoryError('unique', 'ATTRIBUTE_OPTION_NAME_ALREADY_EXISTS')`.
   */
  create(
    tenantId: string,
    groupId: string,
    params: CreateAttributeOptionParams,
  ): Promise<AttributeOptionRow>;
  /**
   * Partial update. Tenant-scoped, deleted_at IS NULL. Eşleşme yoksa null.
   * Duplicate name → 409.
   */
  update(
    tenantId: string,
    id: string,
    params: UpdateAttributeOptionParams,
  ): Promise<AttributeOptionRow | null>;
  /** Soft delete: deleted_at = now(). Idempotent. */
  softDelete(tenantId: string, id: string): Promise<void>;
  /**
   * Bulk soft delete — group cascade için (PR-F1c attribute_group.deleted
   * domain service: gruba bağlı tüm seçenekler aynı transaction'da soft-delete).
   */
  softDeleteByGroupId(tenantId: string, groupId: string): Promise<void>;
  /**
   * `is_default = true AND deleted_at IS NULL` olan seçenek sayısı (grup
   * içinde). `excludeId` verilirse bu id ignore edilir — UPDATE handler'ı
   * kendi satırını saymadan kontrol için kullanır (selection_type='single'
   * grupta default tekil olmalı).
   */
  countDefaultsInGroup(
    tenantId: string,
    groupId: string,
    excludeId?: string,
  ): Promise<number>;
}

/**
 * Attribute options repository (ADR-012). Transaction-aware.
 */
export function createAttributeOptionsRepository(
  db: DbExecutor,
): AttributeOptionsRepository {
  return {
    async findByGroupId(tenantId, groupId) {
      const rows = await db
        .selectFrom('attribute_options')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('group_id', '=', groupId)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .execute();
      return rows as AttributeOptionRow[];
    },

    async findById(tenantId, id) {
      const row = await db
        .selectFrom('attribute_options')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return (row ?? null) as AttributeOptionRow | null;
    },

    async create(tenantId, groupId, params) {
      try {
        const row = await db
          .insertInto('attribute_options')
          .values({
            id: params.id,
            tenant_id: tenantId,
            group_id: groupId,
            name: params.name,
            ...(params.extraPriceCents !== undefined
              ? { extra_price_cents: params.extraPriceCents }
              : {}),
            ...(params.isDefault !== undefined
              ? { is_default: params.isDefault }
              : {}),
            ...(params.sortOrder !== undefined
              ? { sort_order: params.sortOrder }
              : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return row as AttributeOptionRow;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError(
            'unique',
            'ATTRIBUTE_OPTION_NAME_ALREADY_EXISTS',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async update(tenantId, id, params) {
      const patch: Partial<{
        name: string;
        extra_price_cents: number;
        is_default: boolean;
        sort_order: number;
      }> = {};
      if (params.name !== undefined) patch.name = params.name;
      if (params.extraPriceCents !== undefined)
        patch.extra_price_cents = params.extraPriceCents;
      if (params.isDefault !== undefined) patch.is_default = params.isDefault;
      if (params.sortOrder !== undefined) patch.sort_order = params.sortOrder;

      try {
        const row = await db
          .updateTable('attribute_options')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst();
        return (row ?? null) as AttributeOptionRow | null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError(
            'unique',
            'ATTRIBUTE_OPTION_NAME_ALREADY_EXISTS',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async softDelete(tenantId, id) {
      await db
        .updateTable('attribute_options')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
    },

    async softDeleteByGroupId(tenantId, groupId) {
      await db
        .updateTable('attribute_options')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('group_id', '=', groupId)
        .where('deleted_at', 'is', null)
        .execute();
    },

    async countDefaultsInGroup(tenantId, groupId, excludeId) {
      let query = db
        .selectFrom('attribute_options')
        .select(sql<number>`COUNT(*)::int`.as('cnt'))
        .where('tenant_id', '=', tenantId)
        .where('group_id', '=', groupId)
        .where('is_default', '=', true)
        .where('deleted_at', 'is', null);
      if (excludeId !== undefined) {
        query = query.where('id', '!=', excludeId);
      }
      const row = await query.executeTakeFirstOrThrow();
      return Number(row.cnt);
    },
  };
}
