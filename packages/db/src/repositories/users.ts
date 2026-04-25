import type { Kysely, Selectable } from 'kysely';
import type { DB, Users, UserRole } from '../generated.js';
import { mapPgError } from '../errors.js';

export type UserRow = Selectable<Users>;

export interface CreateUserParams {
  id: string;
  tenantId: string;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
}

export interface UsersRepository {
  /**
   * Tenant-scoped email lookup. Login akışında kullanılır.
   * `email` nullable olduğundan, NULL email'li kullanıcılar dönmez (eşitlik NULL-safe değil).
   */
  findByEmail(tenantId: string, email: string): Promise<UserRow | null>;
  findById(tenantId: string, id: string): Promise<UserRow | null>;
  create(params: CreateUserParams): Promise<UserRow>;
  updatePassword(tenantId: string, id: string, newHash: string): Promise<void>;
  softDelete(tenantId: string, id: string): Promise<void>;
}

/**
 * Users repository. Tüm sorgular tenant-scoped.
 * `deleted_at IS NULL` filtresi find* fonksiyonlarına dahildir (soft-delete saygı).
 */
export function createUsersRepository(db: Kysely<DB>): UsersRepository {
  return {
    async findByEmail(tenantId, email) {
      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('email', '=', email)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return row ?? null;
    },

    async findById(tenantId, id) {
      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      return row ?? null;
    },

    async create(params) {
      try {
        return await db
          .insertInto('users')
          .values({
            id: params.id,
            tenant_id: params.tenantId,
            email: params.email,
            username: params.username,
            password_hash: params.passwordHash,
            role: params.role,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        throw mapPgError(err);
      }
    },

    async updatePassword(tenantId, id, newHash) {
      await db
        .updateTable('users')
        .set({ password_hash: newHash })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
    },

    async softDelete(tenantId, id) {
      await db
        .updateTable('users')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
    },
  };
}
