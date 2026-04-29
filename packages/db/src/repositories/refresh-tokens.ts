import type { Selectable } from 'kysely';
import type { RefreshTokens } from '../generated.js';
import type { DbExecutor } from './users.js';
import { mapPgError } from '../errors.js';

export type RefreshTokenRow = Selectable<RefreshTokens>;

export interface CreateRefreshTokenParams {
  id: string;
  tenantId: string;
  userId: string;
  /** SHA-256(plain_token) — 32 byte Buffer. Plain token DB'ye ASLA yazılmaz. */
  tokenHash: Buffer;
  /** Login session tüm token'larını birbirine bağlar — reuse detection için. */
  familyId: string;
  /** RTR zinciri: önceki token id. İlk token'da undefined. */
  parentId?: string;
  expiresAt: Date;
  deviceLabel?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface RefreshTokensRepository {
  create(params: CreateRefreshTokenParams): Promise<RefreshTokenRow>;
  /** Token lookup — globally unique hash üzerinden (tenant filtresi gerek yok). */
  findByTokenHash(tokenHash: Buffer): Promise<RefreshTokenRow | null>;
  /** RTR rotation: eski token'ı soft-revoke eder (revoked_at + reason). */
  revokeByTokenHash(tokenHash: Buffer, reason: string): Promise<void>;
  /** Reuse detection: family'nin tüm aktif token'larını invalidate eder. */
  revokeFamilyAll(familyId: string, reason: string): Promise<void>;
  /** All-sessions logout: kullanıcının tüm token'larını hard-delete eder. */
  deleteAllForUser(tenantId: string, userId: string): Promise<void>;
  /** Cron purger: süresi dolmuş + revoked kayıt sayısını döner (hard-delete). */
  deleteExpired(): Promise<number>;
}

export function createRefreshTokensRepository(
  db: DbExecutor,
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
            family_id: params.familyId,
            parent_id: params.parentId ?? null,
            expires_at: params.expiresAt,
            device_label: params.deviceLabel ?? null,
            user_agent: params.userAgent ?? null,
            ip_address: params.ipAddress ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        const mapped = mapPgError(err);
        if (mapped !== null) throw mapped;
        throw err;
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

    async revokeByTokenHash(tokenHash, reason) {
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date(), revoked_reason: reason })
        .where('token_hash', '=', tokenHash)
        .where('revoked_at', 'is', null)
        .execute();
    },

    async revokeFamilyAll(familyId, reason) {
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date(), revoked_reason: reason })
        .where('family_id', '=', familyId)
        .where('revoked_at', 'is', null)
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
