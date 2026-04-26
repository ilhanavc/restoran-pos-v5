import { type Kysely, type Selectable } from 'kysely';
import type { Categories, DB } from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';

export type CategoryRow = Selectable<Categories>;

export interface CreateCategoryParams {
  id: string;
  name: string;
  sortOrder?: number;
}

export interface CategoriesRepository {
  create(tenantId: string, params: CreateCategoryParams): Promise<CategoryRow>;
  findById(tenantId: string, id: string): Promise<CategoryRow | null>;
  findAll(tenantId: string): Promise<CategoryRow[]>;
}

export function createCategoriesRepository(db: Kysely<DB>): CategoriesRepository {
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
  };
}
