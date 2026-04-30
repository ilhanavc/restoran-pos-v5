import type { DbExecutor } from './users.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type AttributeGroupSelectionType = 'single' | 'multiple';

export interface AttributeGroupRow {
  id: string;
  tenant_id: string;
  name: string;
  selection_type: AttributeGroupSelectionType;
  is_required: boolean;
  sort_order: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAttributeGroupParams {
  id: string;
  name: string;
  selectionType: AttributeGroupSelectionType;
  isRequired?: boolean;
  sortOrder?: number;
}

export interface UpdateAttributeGroupParams {
  name?: string;
  selectionType?: AttributeGroupSelectionType;
  isRequired?: boolean;
  sortOrder?: number;
}

export interface AttributeGroupsRepository {
  /**
   * Aktif (deleted_at IS NULL) gruplar, tenant-scoped. Sıralama: sort_order ASC,
   * name ASC tiebreaker (ADR-012).
   */
  findAll(tenantId: string): Promise<AttributeGroupRow[]>;
  /** Tenant-scoped tek grup, soft-deleted satır dönmez. */
  findById(tenantId: string, id: string): Promise<AttributeGroupRow | null>;
  /**
   * INSERT. Duplicate name (case-insensitive partial UNIQUE
   * `lower(trim(name)) WHERE deleted_at IS NULL`, Migration F1a) →
   * `RepositoryError('unique', 'ATTRIBUTE_GROUP_NAME_ALREADY_EXISTS')`.
   */
  create(
    tenantId: string,
    params: CreateAttributeGroupParams,
  ): Promise<AttributeGroupRow>;
  /**
   * Partial update. Tenant-scoped, deleted_at IS NULL. Eşleşme yoksa null.
   * Duplicate name → 409.
   */
  update(
    tenantId: string,
    id: string,
    params: UpdateAttributeGroupParams,
  ): Promise<AttributeGroupRow | null>;
  /** Soft delete: deleted_at = now(). Idempotent. */
  softDelete(tenantId: string, id: string): Promise<void>;
}

/**
 * Attribute groups repository (ADR-012). Transaction-aware.
 * DELETE handler'ında softDelete + options.softDeleteByGroupId +
 * categoryAttributeGroups.unassignByGroupId + productAttributeGroups.unassignByGroupId
 * tek transaction içinde çağrılır (PR-F1c domain service).
 */
export function createAttributeGroupsRepository(
  db: DbExecutor,
): AttributeGroupsRepository {
  return {
    async findAll(tenantId) {
      const rows = await db
        .selectFrom('attribute_groups')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .execute();
      return rows as AttributeGroupRow[];
    },

    async findById(tenantId, id) {
      const row = await db
        .selectFrom('attribute_groups')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return (row ?? null) as AttributeGroupRow | null;
    },

    async create(tenantId, params) {
      try {
        const row = await db
          .insertInto('attribute_groups')
          .values({
            id: params.id,
            tenant_id: tenantId,
            name: params.name,
            selection_type: params.selectionType,
            ...(params.isRequired !== undefined
              ? { is_required: params.isRequired }
              : {}),
            ...(params.sortOrder !== undefined
              ? { sort_order: params.sortOrder }
              : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return row as AttributeGroupRow;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError(
            'unique',
            'ATTRIBUTE_GROUP_NAME_ALREADY_EXISTS',
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
        selection_type: AttributeGroupSelectionType;
        is_required: boolean;
        sort_order: number;
      }> = {};
      if (params.name !== undefined) patch.name = params.name;
      if (params.selectionType !== undefined)
        patch.selection_type = params.selectionType;
      if (params.isRequired !== undefined) patch.is_required = params.isRequired;
      if (params.sortOrder !== undefined) patch.sort_order = params.sortOrder;

      try {
        const row = await db
          .updateTable('attribute_groups')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst();
        return (row ?? null) as AttributeGroupRow | null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError(
            'unique',
            'ATTRIBUTE_GROUP_NAME_ALREADY_EXISTS',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async softDelete(tenantId, id) {
      await db
        .updateTable('attribute_groups')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
    },
  };
}
