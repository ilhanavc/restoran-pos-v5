import { sql } from 'kysely';
import type { DbExecutor } from './users.js';
import { mapPgError } from '../errors.js';
import type {
  AttributeGroupRow,
  AttributeGroupSelectionType,
} from './attributeGroups.js';

export interface ProductAttributeGroupRow {
  id: string;
  tenant_id: string;
  product_id: string;
  group_id: string;
  sort_order: number;
  created_at: Date;
}

/**
 * ADR-012 Karar 8 — effective groups for a product.
 * Product-assigned + category-assigned birleşimi; aynı group_id iki kaynaktan
 * geliyorsa product satırı kazanır (DISTINCT ON id, source DESC — 'product'
 * stringi 'category'den lexicographically sonra).
 */
export interface EffectiveAttributeGroupRow extends AttributeGroupRow {
  source: 'product' | 'category';
}

export interface ProductAttributeGroupsRepository {
  findByProductId(
    tenantId: string,
    productId: string,
  ): Promise<ProductAttributeGroupRow[]>;
  findByGroupId(
    tenantId: string,
    groupId: string,
  ): Promise<ProductAttributeGroupRow[]>;
  /**
   * Idempotent INSERT. (tenant_id, product_id, group_id) zaten varsa null.
   */
  assign(
    tenantId: string,
    productId: string,
    groupId: string,
    id: string,
    sortOrder?: number,
  ): Promise<ProductAttributeGroupRow | null>;
  /** Idempotent DELETE. Satır yoksa false döner. */
  unassign(
    tenantId: string,
    productId: string,
    groupId: string,
  ): Promise<boolean>;
  unassignByProductId(tenantId: string, productId: string): Promise<void>;
  unassignByGroupId(tenantId: string, groupId: string): Promise<void>;

  /**
   * ADR-012 Karar 8 — effective groups for a product.
   * Product-direct groups + category-inherited groups, dedup product wins.
   * Tek SQL (CTE + UNION + DISTINCT ON). Soft-deleted gruplar düşürülür.
   * Sıralama: sort_order ASC, name ASC.
   */
  findEffectiveForProduct(
    tenantId: string,
    productId: string,
  ): Promise<EffectiveAttributeGroupRow[]>;
}

/**
 * Product ↔ AttributeGroup link tablosu (ADR-012). Hard delete + idempotent.
 */
export function createProductAttributeGroupsRepository(
  db: DbExecutor,
): ProductAttributeGroupsRepository {
  return {
    async findByProductId(tenantId, productId) {
      const rows = await db
        .selectFrom('product_attribute_groups')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('product_id', '=', productId)
        .orderBy('sort_order', 'asc')
        .execute();
      return rows as ProductAttributeGroupRow[];
    },

    async findByGroupId(tenantId, groupId) {
      const rows = await db
        .selectFrom('product_attribute_groups')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('group_id', '=', groupId)
        .execute();
      return rows as ProductAttributeGroupRow[];
    },

    async assign(tenantId, productId, groupId, id, sortOrder) {
      try {
        const row = await db
          .insertInto('product_attribute_groups')
          .values({
            id,
            tenant_id: tenantId,
            product_id: productId,
            group_id: groupId,
            ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
          })
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'product_id', 'group_id']).doNothing(),
          )
          .returningAll()
          .executeTakeFirst();
        return (row ?? null) as ProductAttributeGroupRow | null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async unassign(tenantId, productId, groupId) {
      const result = await db
        .deleteFrom('product_attribute_groups')
        .where('tenant_id', '=', tenantId)
        .where('product_id', '=', productId)
        .where('group_id', '=', groupId)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    async unassignByProductId(tenantId, productId) {
      await db
        .deleteFrom('product_attribute_groups')
        .where('tenant_id', '=', tenantId)
        .where('product_id', '=', productId)
        .execute();
    },

    async unassignByGroupId(tenantId, groupId) {
      await db
        .deleteFrom('product_attribute_groups')
        .where('tenant_id', '=', tenantId)
        .where('group_id', '=', groupId)
        .execute();
    },

    async findEffectiveForProduct(tenantId, productId) {
      // ADR-012 Karar 8: product wins over category for the same group_id.
      // 'product' lex > 'category' so DISTINCT ON id ORDER BY id, source DESC
      // keeps the product row when both exist.
      const result = await sql<{
        id: string;
        tenant_id: string;
        name: string;
        selection_type: AttributeGroupSelectionType;
        is_required: boolean;
        sort_order: number;
        deleted_at: Date | null;
        created_at: Date;
        updated_at: Date;
        source: 'product' | 'category';
      }>`
        WITH unioned AS (
          SELECT ag.*, 'product'::text AS source
          FROM attribute_groups ag
          INNER JOIN product_attribute_groups pag
            ON pag.tenant_id = ag.tenant_id
           AND pag.group_id = ag.id
          WHERE ag.tenant_id = ${tenantId}
            AND ag.deleted_at IS NULL
            AND pag.product_id = ${productId}
          UNION ALL
          SELECT ag.*, 'category'::text AS source
          FROM attribute_groups ag
          INNER JOIN category_attribute_groups cag
            ON cag.tenant_id = ag.tenant_id
           AND cag.group_id = ag.id
          INNER JOIN products p
            ON p.tenant_id = cag.tenant_id
           AND p.category_id = cag.category_id
          WHERE ag.tenant_id = ${tenantId}
            AND ag.deleted_at IS NULL
            AND p.id = ${productId}
            AND p.deleted_at IS NULL
        ),
        deduped AS (
          SELECT DISTINCT ON (id) *
          FROM unioned
          ORDER BY id, source DESC
        )
        SELECT * FROM deduped
        ORDER BY sort_order ASC, name ASC
      `.execute(db);

      return result.rows as EffectiveAttributeGroupRow[];
    },
  };
}
