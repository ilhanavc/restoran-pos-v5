import type { Kysely, Selectable, Transaction } from 'kysely';
import type { DB, Users, UserRole } from '../generated.js';
import { mapPgError } from '../errors.js';

export type UserRow = Selectable<Users>;

/** Repository metodları hem `Kysely<DB>` hem `Transaction<DB>` ile çalışır. */
export type DbExecutor = Kysely<DB> | Transaction<DB>;

export interface CreateUserParams {
  id: string;
  tenantId: string;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
}

export interface UpdateUserParams {
  email?: string;
  role?: UserRole;
  username?: string;
}

export interface UsersRepository {
  /**
   * Tenant-scoped email lookup. Login akışında kullanılır.
   * `email` nullable olduğundan, NULL email'li kullanıcılar dönmez (eşitlik NULL-safe değil).
   * `deleted_at IS NULL` filtresi dahil — silinmiş kullanıcı login edemez (ADR-002 §10.4).
   */
  findByEmail(tenantId: string, email: string): Promise<UserRow | null>;
  findById(tenantId: string, id: string): Promise<UserRow | null>;
  /** Tüm aktif kullanıcılar (deleted_at IS NULL), tenant-scoped, max 500 hard-cap. */
  findMany(tenantId: string): Promise<UserRow[]>;
  create(params: CreateUserParams): Promise<UserRow>;
  /** Partial update; en az bir alan dolu olmalı (handler'da garanti edilir). */
  update(
    tenantId: string,
    id: string,
    params: UpdateUserParams,
  ): Promise<UserRow | null>;
  updatePassword(tenantId: string, id: string, newHash: string): Promise<void>;
  softDelete(tenantId: string, id: string): Promise<void>;
  /**
   * Tenant'taki aktif (deleted_at IS NULL) admin satırlarını `FOR UPDATE` ile
   * KİLİTLEYEREK sayar. ADR-002 §10.3 / §10.4: DELETE / role-downgrade öncesi
   * guard. Plain count READ COMMITTED altında race'e açık (T1 + T2 paralel
   * count = 2 görür, ikisi farklı admin'i UPDATE eder → tenant 0 admin kalır).
   * Tüm admin satırlarını kilitlersek paralel transaction'lar ikincisi birinciyi
   * bekler ve güncel state'i okur. Yalnız `Transaction<DB>` üzerinden anlamlı —
   * outer `Kysely<DB>` ile çağrılırsa kilit COMMIT'te düşer (no-op effekt).
   */
  countActiveAdmins(tenantId: string): Promise<number>;
}

/**
 * Users repository. Tüm sorgular tenant-scoped.
 * `deleted_at IS NULL` filtresi find* fonksiyonlarına dahildir (soft-delete saygı).
 *
 * Transaction-aware: `db` parametresi `Kysely<DB>` veya `Transaction<DB>` olabilir.
 * `softDelete + countActiveAdmins` çağrıları DELETE handler'ında tek transaction
 * içinde çağrılır (ADR-002 §10.4 atomicity kontratı).
 */
export function createUsersRepository(db: DbExecutor): UsersRepository {
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

    async findMany(tenantId) {
      // Hard-cap 500 — tenant başına kullanıcı pratik üst sınırın altında;
      // pagination MVP kapsamı dışı (active-plan §17).
      return db
        .selectFrom('users')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'asc')
        .limit(500)
        .execute();
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
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
      }
    },

    async update(tenantId, id, params) {
      const patch: Partial<{
        email: string;
        role: UserRole;
        username: string;
      }> = {};
      if (params.email !== undefined) patch.email = params.email;
      if (params.role !== undefined) patch.role = params.role;
      if (params.username !== undefined) patch.username = params.username;

      try {
        const row = await db
          .updateTable('users')
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

    async countActiveAdmins(tenantId) {
      // ADR-002 §10.4 atomicity: aktif admin satırlarını FOR UPDATE ile
      // kilitle, sonra say. Paralel iki transaction farklı admin'i hedef
      // alsa bile, ikincisi birincinin COMMIT/ROLLBACK'ini bekler ve
      // güncel state'i görür → "tenant 0 admin kalır" race kapanır.
      const rows = await db
        .selectFrom('users')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('role', '=', 'admin')
        .where('deleted_at', 'is', null)
        .forUpdate()
        .execute();
      return rows.length;
    },
  };
}
