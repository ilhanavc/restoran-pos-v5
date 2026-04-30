import type { DbExecutor } from './users.js';
import { mapPgError } from '../errors.js';

export interface CategoryAttributeGroupRow {
  id: string;
  tenant_id: string;
  category_id: string;
  group_id: string;
  sort_order: number;
  created_at: Date;
}

export interface CategoryAttributeGroupsRepository {
  findByCategoryId(
    tenantId: string,
    categoryId: string,
  ): Promise<CategoryAttributeGroupRow[]>;
  findByGroupId(
    tenantId: string,
    groupId: string,
  ): Promise<CategoryAttributeGroupRow[]>;
  /**
   * Idempotent INSERT. (tenant_id, category_id, group_id) zaten varsa null
   * (no-op). Yeni eklenirse satır döner.
   * SQL: INSERT ... ON CONFLICT (tenant_id, category_id, group_id) DO NOTHING
   * RETURNING *.
   */
  assign(
    tenantId: string,
    categoryId: string,
    groupId: string,
    id: string,
    sortOrder?: number,
  ): Promise<CategoryAttributeGroupRow | null>;
  /** Idempotent DELETE. Satır yoksa false döner (handler 204 idempotent). */
  unassign(
    tenantId: string,
    categoryId: string,
    groupId: string,
  ): Promise<boolean>;
  unassignByCategoryId(tenantId: string, categoryId: string): Promise<void>;
  unassignByGroupId(tenantId: string, groupId: string): Promise<void>;
}

/**
 * Category ↔ AttributeGroup link tablosu (ADR-012). Hard delete + idempotent.
 * Soft-delete YOK — link kayıtları operasyonel, audit ayrı tutuluyor.
 */
export function createCategoryAttributeGroupsRepository(
  db: DbExecutor,
): CategoryAttributeGroupsRepository {
  return {
    async findByCategoryId(tenantId, categoryId) {
      const rows = await db
        .selectFrom('category_attribute_groups')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('category_id', '=', categoryId)
        .orderBy('sort_order', 'asc')
        .execute();
      return rows as CategoryAttributeGroupRow[];
    },

    async findByGroupId(tenantId, groupId) {
      const rows = await db
        .selectFrom('category_attribute_groups')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('group_id', '=', groupId)
        .execute();
      return rows as CategoryAttributeGroupRow[];
    },

    async assign(tenantId, categoryId, groupId, id, sortOrder) {
      try {
        const row = await db
          .insertInto('category_attribute_groups')
          .values({
            id,
            tenant_id: tenantId,
            category_id: categoryId,
            group_id: groupId,
            ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
          })
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'category_id', 'group_id']).doNothing(),
          )
          .returningAll()
          .executeTakeFirst();
        return (row ?? null) as CategoryAttributeGroupRow | null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async unassign(tenantId, categoryId, groupId) {
      const result = await db
        .deleteFrom('category_attribute_groups')
        .where('tenant_id', '=', tenantId)
        .where('category_id', '=', categoryId)
        .where('group_id', '=', groupId)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    async unassignByCategoryId(tenantId, categoryId) {
      await db
        .deleteFrom('category_attribute_groups')
        .where('tenant_id', '=', tenantId)
        .where('category_id', '=', categoryId)
        .execute();
    },

    async unassignByGroupId(tenantId, groupId) {
      await db
        .deleteFrom('category_attribute_groups')
        .where('tenant_id', '=', tenantId)
        .where('group_id', '=', groupId)
        .execute();
    },
  };
}
