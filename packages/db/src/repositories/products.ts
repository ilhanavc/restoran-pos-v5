import type { Selectable } from 'kysely';
import type { Products, ProductVariants } from '../generated.js';
import type { DbExecutor } from './users.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type ProductRow = Selectable<Products>;
export type ProductVariantRow = Selectable<ProductVariants>;

export interface CreateProductParams {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  priceCents: number;
}

export interface UpdateProductParams {
  categoryId?: string;
  name?: string;
  priceCents?: number;
}

export interface CreateProductVariantParams {
  id: string;
  tenantId: string;
  productId: string;
  name: string;
  priceDeltaCents: number;
  isDefault: boolean;
  sortOrder: number;
}

export interface UpdateProductVariantParams {
  name?: string;
  priceDeltaCents?: number;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface ProductsRepository {
  create(params: CreateProductParams): Promise<ProductRow>;
  findById(tenantId: string, id: string): Promise<ProductRow | null>;
  /**
   * ADR-003 §8.6 K4: max 500 hard-cap, deleted_at IS NULL filtreli, tenant-scoped.
   * Variants ayrı SELECT IN ile çekilir (`findVariantsByProductIds`) — N+1 yasak.
   */
  findMany(tenantId: string): Promise<ProductRow[]>;
  update(
    tenantId: string,
    id: string,
    params: UpdateProductParams,
  ): Promise<ProductRow | null>;
  /**
   * ADR-003 §8.6 K2: product soft delete'i tetikleyici metot.
   * Cascade variant soft delete handler tarafında ÇAĞIRAN transaction içinde
   * `softDeleteVariantsByProductId` ile ayrıca uygulanır (handler tek BEGIN/COMMIT).
   */
  softDelete(tenantId: string, id: string): Promise<void>;

  // Variants — ADR-003 §8.6 K1, K3, K4
  /**
   * ADR-003 §8.6 K4: products listesi sonrası tek SELECT IN ile variantları çek.
   * `WHERE product_id = ANY($1)` — tenant filtresi eklenir, deleted_at IS NULL.
   * N+1 query döngüsü YASAK (DoD).
   */
  findVariantsByProductIds(
    tenantId: string,
    productIds: readonly string[],
  ): Promise<ProductVariantRow[]>;
  /** Tek product'ın aktif variantları, sort_order asc. is_default promote için. */
  findActiveVariantsByProductId(
    tenantId: string,
    productId: string,
  ): Promise<ProductVariantRow[]>;
  createVariant(params: CreateProductVariantParams): Promise<ProductVariantRow>;
  updateVariant(
    tenantId: string,
    id: string,
    params: UpdateProductVariantParams,
  ): Promise<ProductVariantRow | null>;
  /** Tek variant soft delete. */
  softDeleteVariant(tenantId: string, id: string): Promise<void>;
  /** ADR-003 §8.6 K2 cascade: bir product'ın tüm aktif variantlarını soft delete. */
  softDeleteVariantsByProductId(
    tenantId: string,
    productId: string,
  ): Promise<void>;
}

/**
 * Products + ProductVariants repository. ADR-003 §8.6 4 karar:
 * - K1 nested write: route handler tek transaction parent + variants
 * - K2 cascade soft delete: handler iki UPDATE
 * - K3 variant soft delete: defansif (v5.1 FK için)
 * - K4 N+1 yasak: findVariantsByProductIds tek SELECT IN
 *
 * Transaction-aware: outer Kysely<DB> veya Transaction<DB> ile çağrılabilir.
 */
export function createProductsRepository(db: DbExecutor): ProductsRepository {
  return {
    async create(params) {
      try {
        return await db
          .insertInto('products')
          .values({
            id: params.id,
            tenant_id: params.tenantId,
            category_id: params.categoryId,
            name: params.name,
            price_cents: params.priceCents,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'foreign_key') {
          // category_id geçersiz → handler 404 MENU_CATEGORY_NOT_FOUND'a çevirir.
          throw new RepositoryError(
            'foreign_key',
            'MENU_CATEGORY_NOT_FOUND',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async findById(tenantId, id) {
      const row = await db
        .selectFrom('products')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return row ?? null;
    },

    async findMany(tenantId) {
      // Hard-cap 500 — admin menü listesi MVP, pagination v5.1.
      return db
        .selectFrom('products')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .orderBy('name', 'asc')
        .limit(500)
        .execute();
    },

    async update(tenantId, id, params) {
      const patch: Partial<{
        category_id: string;
        name: string;
        price_cents: number;
      }> = {};
      if (params.categoryId !== undefined) patch.category_id = params.categoryId;
      if (params.name !== undefined) patch.name = params.name;
      if (params.priceCents !== undefined) patch.price_cents = params.priceCents;

      try {
        const row = await db
          .updateTable('products')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst();
        return row ?? null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'foreign_key') {
          throw new RepositoryError(
            'foreign_key',
            'MENU_CATEGORY_NOT_FOUND',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async softDelete(tenantId, id) {
      await db
        .updateTable('products')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
    },

    async findVariantsByProductIds(tenantId, productIds) {
      if (productIds.length === 0) return [];
      // ADR-003 §8.6 K4: tek SELECT IN ile tüm variantlar; N+1 query döngüsü YASAK.
      return db
        .selectFrom('product_variants')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('product_id', 'in', productIds as readonly string[])
        .where('deleted_at', 'is', null)
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .execute();
    },

    async findActiveVariantsByProductId(tenantId, productId) {
      return db
        .selectFrom('product_variants')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('product_id', '=', productId)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order', 'asc')
        .orderBy('name', 'asc')
        .execute();
    },

    async createVariant(params) {
      try {
        return await db
          .insertInto('product_variants')
          .values({
            id: params.id,
            tenant_id: params.tenantId,
            product_id: params.productId,
            name: params.name,
            price_delta_cents: params.priceDeltaCents,
            is_default: params.isDefault,
            sort_order: params.sortOrder,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async updateVariant(tenantId, id, params) {
      const patch: Partial<{
        name: string;
        price_delta_cents: number;
        is_default: boolean;
        sort_order: number;
      }> = {};
      if (params.name !== undefined) patch.name = params.name;
      if (params.priceDeltaCents !== undefined) {
        patch.price_delta_cents = params.priceDeltaCents;
      }
      if (params.isDefault !== undefined) patch.is_default = params.isDefault;
      if (params.sortOrder !== undefined) patch.sort_order = params.sortOrder;

      try {
        const row = await db
          .updateTable('product_variants')
          .set(patch)
          .where('tenant_id', '=', tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst();
        return row ?? null;
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async softDeleteVariant(tenantId, id) {
      await db
        .updateTable('product_variants')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
    },

    async softDeleteVariantsByProductId(tenantId, productId) {
      // ADR-003 §8.6 K2 cascade: product soft delete sırasında child variantların
      // hepsi tek UPDATE ile pasifleştirilir. Handler aynı transaction içinde çağırır.
      await db
        .updateTable('product_variants')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('product_id', '=', productId)
        .where('deleted_at', 'is', null)
        .execute();
    },
  };
}
