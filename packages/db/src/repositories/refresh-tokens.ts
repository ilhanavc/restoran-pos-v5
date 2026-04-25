import type { Kysely, Selectable } from 'kysely';
import type { DB, RefreshTokens } from '../generated.js';
import { mapPgError } from '../errors.js';

export type RefreshTokenRow = Selectable<RefreshTokens>;

export interface CreateRefreshTokenParams {
  id: string;
  tenantId: string;
  userId: string;
  /** SHA256 / bcrypt hash. Plain token DB'ye ASLA yazılmaz. */
  tokenHash: string;
  expiresAt: Date;
}

export interface RefreshTokensRepository {
  create(params: CreateRefreshTokenParams): Promise<RefreshTokenRow>;
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRow | null>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  /** RTR: parola değişimi / global logout için kullanıcının tüm token'larını siler. */
  deleteAllForUser(tenantId: string, userId: string): Promise<void>;
  /** Cron purger için: süresi dolmuş kayıt sayısını döner. */
  deleteExpired(): Promise<number>;
}

/**
 * Refresh tokens repository (ADR-002 RTR).
 * Lookup tek alan üzerinden yapılır: token_hash UNIQUE.
 * Tenant-scope yine ihlal edilmez — create/deleteAllForUser tenant_id alır;
 * lookup'lar (find/delete by hash) globally unique hash üzerinden çalışır.
 */
export function createRefreshTokensRepository(
  db: Kysely<DB>,
): RefreshTokensRepository {
  return {
    async create(params) {
      try {
        return await db
          .insertInto('refresh_tokens')
          .values({
            id: params.id,
            tenant_id: params.tenantId,
            user_id: params.userId,
            token_hash: params.tokenHash,
            expires_at: params.expiresAt,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        throw mapPgError(err);
      }
    },

    async findByTokenHash(tokenHash) {
      const row = await db
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row ?? null;
    },

    async deleteByTokenHash(tokenHash) {
      await db
        .deleteFrom('refresh_tokens')
        .where('token_hash', '=', tokenHash)
        .execute();
    },

    async deleteAllForUser(tenantId, userId) {
      await db
        .deleteFrom('refresh_tokens')
        .where('tenant_id', '=', tenantId)
        .where('user_id', '=', userId)
        .execute();
    },

    async deleteExpired() {
      const result = await db
        .deleteFrom('refresh_tokens')
        .where('expires_at', '<', new Date())
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
