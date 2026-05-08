import type { Kysely, Selectable, Transaction } from 'kysely';
import type { DB, Users, UserRole } from '../generated.js';
import { mapPgError, RepositoryError } from '../errors.js';

/**
 * pg unique-violation hatasının `constraint` alanını user repository'ye özgü
 * messageKey'e çevirir (ADR-006 §5.2 stability — kod registry'deki birebir
 * isim). Bilinmeyen constraint için `null` döner; caller orijinal
 * `RepositoryError('unique', undefined, detail)`'i geçirir.
 *
 * - `users_tenant_username_ci_idx` (Migration 033) → USER_USERNAME_ALREADY_EXISTS
 * - `users_tenant_email_ci_idx`    (Migration 003) → USER_EMAIL_ALREADY_EXISTS
 */
function userUniqueMessageKey(
  constraint: string | undefined,
): 'USER_USERNAME_ALREADY_EXISTS' | 'USER_EMAIL_ALREADY_EXISTS' | null {
  if (constraint === 'users_tenant_username_ci_idx') {
    return 'USER_USERNAME_ALREADY_EXISTS';
  }
  if (constraint === 'users_tenant_email_ci_idx') {
    return 'USER_EMAIL_ALREADY_EXISTS';
  }
  return null;
}

/**
 * Raw pg hatasından `constraint` alanını güvenli şekilde okur (defensif type
 * guard). Kysely `pg` driver'ı `code === '23505'` durumunda `constraint`
 * alanını da iletir; aksi halde `undefined`.
 */
function getPgConstraint(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const c = (err as { constraint?: unknown }).constraint;
  return typeof c === 'string' ? c : undefined;
}

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
   */
  findByEmail(tenantId: string, email: string): Promise<UserRow | null>;
  findById(tenantId: string, id: string): Promise<UserRow | null>;
  /** Tüm kullanıcılar, tenant-scoped, max 500 hard-cap. */
  findMany(tenantId: string): Promise<UserRow[]>;
  create(params: CreateUserParams): Promise<UserRow>;
  /** Partial update; en az bir alan dolu olmalı (handler'da garanti edilir). */
  update(
    tenantId: string,
    id: string,
    params: UpdateUserParams,
  ): Promise<UserRow | null>;
  updatePassword(tenantId: string, id: string, newHash: string): Promise<void>;
  /**
   * Hard delete — DELETE FROM users (ADR-002 §10.10 Amendment, 2026-05-01).
   * audit_logs.actor_user_id ON DELETE SET NULL ile audit kaydı korunur.
   * orders.waiter_user_id ON DELETE SET NULL ile sipariş geçmişi korunur.
   * refresh_tokens user_id FK ON DELETE CASCADE (Migration 018) ile token
   * satırları otomatik silinir — manuel revoke transaction step'i kalkar.
   */
  hardDelete(tenantId: string, id: string): Promise<void>;
  /**
   * Tenant'taki admin satırlarını `FOR UPDATE` ile KİLİTLEYEREK sayar.
   * ADR-002 §10.3 / §10.4: DELETE / role-downgrade öncesi guard. Plain count
   * READ COMMITTED altında race'e açık (T1 + T2 paralel count = 2 görür, ikisi
   * farklı admin'i silmeye/değiştirmeye çalışır → tenant 0 admin kalır). Tüm
   * admin satırlarını kilitlersek paralel transaction'lar ikincisi birinciyi
   * bekler ve güncel state'i okur. Yalnız `Transaction<DB>` üzerinden anlamlı —
   * outer `Kysely<DB>` ile çağrılırsa kilit COMMIT'te düşer (no-op effekt).
   */
  countActiveAdmins(tenantId: string): Promise<number>;
}

/**
 * Users repository. Tüm sorgular tenant-scoped.
 *
 * Hard delete (ADR-002 §10.10 Amendment): `deleted_at` filtresi kaldırıldı,
 * `softDelete` → `hardDelete`. FK ON DELETE davranışları:
 *   - audit_logs.actor_user_id → SET NULL  (000_init.sql:358)
 *   - orders.waiter_user_id    → SET NULL  (005)
 *   - refresh_tokens user_id   → CASCADE   (Migration 018)
 *
 * Transaction-aware: `db` parametresi `Kysely<DB>` veya `Transaction<DB>` olabilir.
 * `hardDelete + countActiveAdmins` çağrıları DELETE handler'ında tek transaction
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
        .executeTakeFirst();
      return row ?? null;
    },

    async findById(tenantId, id) {
      const row = await db
        .selectFrom('users')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
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
        // ADR-002 §10.11 + ADR-006 §5.2 (Amendment 2026-05-08):
        // username/email çakışmaları → kararlı domain code → handler 409.
        if (mapped?.cause === 'unique') {
          const key = userUniqueMessageKey(getPgConstraint(err));
          if (key !== null) {
            throw new RepositoryError('unique', key, mapped.detail);
          }
        }
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
          .returningAll()
          .executeTakeFirst();
        return row ?? null;
      } catch (err) {
        const mapped = mapPgError(err);
        // ADR-002 §10.11 + ADR-006 §5.2: PATCH duplicate username/email → 409.
        if (mapped?.cause === 'unique') {
          const key = userUniqueMessageKey(getPgConstraint(err));
          if (key !== null) {
            throw new RepositoryError('unique', key, mapped.detail);
          }
        }
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
        .execute();
    },

    async hardDelete(tenantId, id) {
      await db
        .deleteFrom('users')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .execute();
    },

    async countActiveAdmins(tenantId) {
      // ADR-002 §10.4 atomicity: admin satırlarını FOR UPDATE ile kilitle,
      // sonra say. Paralel iki transaction farklı admin'i hedef alsa bile,
      // ikincisi birincinin COMMIT/ROLLBACK'ini bekler → "tenant 0 admin
      // kalır" race kapanır.
      const rows = await db
        .selectFrom('users')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('role', '=', 'admin')
        .forUpdate()
        .execute();
      return rows.length;
    },
  };
}
