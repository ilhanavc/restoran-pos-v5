import { type Selectable } from 'kysely';
import type { Categories } from '../generated.js';
import type { DbExecutor } from './users.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type CategoryRow = Selectable<Categories>;

export interface CreateCategoryParams {
  id: string;
  name: string;
  sortOrder?: number;
  icon?: string;
  color?: string;
}

export interface UpdateCategoryParams {
  name?: string;
  sortOrder?: number;
  icon?: string;
  color?: string;
}

export interface CategoriesRepository {
  create(tenantId: string, params: CreateCategoryParams): Promise<CategoryRow>;
  findById(tenantId: string, id: string): Promise<CategoryRow | null>;
  findAll(tenantId: string): Promise<CategoryRow[]>;
  /**
   * Sprint 4 Görev 20 — partial update. En az bir alan dolu olmalı (handler
   * tarafında zod refine garanti eder). Tenant-scoped, soft-deleted satır
   * döndürmez (deleted_at IS NULL). Hiçbir satır eşleşmezse `null` döner —
   * handler `MENU_CATEGORY_NOT_FOUND` (404) fırlatır (cross-tenant + missing
   * aynı sonuç, enumeration sızdırılmaz).
   *
   * Duplicate name → `RepositoryError('unique', 'MENU_CATEGORY_ALREADY_EXISTS')`
   * — `(tenant_id, lower(name))` partial UNIQUE çakışmasında.
   */
  update(
    tenantId: string,
    id: string,
    params: UpdateCategoryParams,
  ): Promise<CategoryRow | null>;
  /** Soft delete: deleted_at = now(). Tenant-scoped, idempotent. */
  softDelete(tenantId: string, id: string): Promise<void>;
  /**
   * DELETE guard (Sprint 4 Görev 20 Seçenek A — ADR-003 §8.6 Amendment
   * 2026-04-28b). Kategori altında aktif (`deleted_at IS NULL`) products
   * satırı varsa true döner — handler 409 `MENU_CATEGORY_HAS_PRODUCTS`
   * fırlatır. Cascade soft delete YAPILMAZ.
   */
  hasActiveProducts(tenantId: string, id: string): Promise<boolean>;
}

/**
 * Categories repository. Transaction-aware: `db` parametresi `Kysely<DB>` veya
 * `Transaction<DB>` olabilir (ADR-002 §10.4 atomicity — softDelete + writeAudit
 * tek transaction içinde).
 */
export function createCategoriesRepository(db: DbExecutor): CategoriesRepository {
  return {
    async create(tenantId, params) {
      try {
        return await db
          .insertInto('categories')
          .values({
            id: params.id,
            tenant_id: tenantId,
            name: params.name,
            ...(params.sortOrder !== undefined ? { sort_order: params.sortOrder } : {}),
            ...(params.icon !== undefined ? { icon: params.icon } : {}),
            ...(params.color !== undefined ? { color: params.color } : {}),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped?.cause === 'unique') {
          throw new RepositoryError('unique', 'MENU_CATEGORY_ALREADY_EXISTS', mapped.detail);
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async findById(tenantId, id) {
      const row = await db
        .selectFrom('categories')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return row ?? null;
    },

    async findAll(tenantId) {
      return db
        .selectFrom('categories')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order', 'asc')
        .execute();
    },

    async update(tenantId, id, params) {
      const patch: Partial<{
        name: string;
        sort_order: number;
        icon: string;
        color: string;
      }> = {};
      if (params.name !== undefined) patch.name = params.name;
      if (params.sortOrder !== undefined) patch.sort_order = params.sortOrder;
      if (params.icon !== undefined) patch.icon = params.icon;
      if (params.color !== undefined) patch.color = params.color;

      try {
        const row = await db
          .updateTable('categories')
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
            'MENU_CATEGORY_ALREADY_EXISTS',
            mapped.detail,
          );
        }
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async softDelete(tenantId, id) {
      await db
        .updateTable('categories')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
    },

    async hasActiveProducts(tenantId, id) {
      // EXISTS semantiği: tek satır okumak yeter, count gerekmez.
      const row = await db
        .selectFrom('products')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('category_id', '=', id)
        .where('deleted_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },
  };
}
