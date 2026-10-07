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
  /**
   * Token lookup — hash globally unique'tir, ama sorgu yine de tenant-scoped'dur.
   *
   * ADR-041 Amd7 K4(1) — imzaya `tenantId` EKLENDİ (F4e-2). Eskiden tenant
   * filtresi "gerek yok" diye atlanıyordu; `refresh_tokens` force-RLS altına
   * girdiği için artık policy'nin çözdüğü kolon uygulama katmanında da yüklem
   * olarak bulunmalı (base ADR-041'in "tek unutulan WHERE" sınıfı). Tenant
   * kaynağı login ile birebir aynıdır: `deps.tenantId` sunucu sabiti.
   */
  findByTokenHash(
    tenantId: string,
    tokenHash: Buffer,
  ): Promise<RefreshTokenRow | null>;
  /**
   * ADR-002 §11.5 (Amd5) — Aile satırlarını `FOR UPDATE` ile kilitler ve ailenin
   * aktif başını (head) döner. Kilit TÜM aile satırlarını kapsar; böylece iki
   * eşzamanlı rotasyon/kurtarma isteği serileştirilir ve "her family_id için en
   * fazla bir aktif token" invaryantı korunur. YALNIZ transaction içinde çağrılır.
   *
   * Head = `revoked_at IS NULL` + `expires_at > now()`. Aile ölüyse null.
   *
   * ADR-041 Amd7 K4(1) — imzaya `tenantId` EKLENDİ (F4e-2); gerekçe
   * `findByTokenHash`'teki ile aynı.
   */
  findActiveByFamilyForUpdate(
    tenantId: string,
    familyId: string,
  ): Promise<RefreshTokenRow | null>;
  /**
   * ADR-002 §11.6.4 (Amd5) — Suistimal tavanı sayacı: verilen pencere içinde
   * ailede kaç kurtarma (`revoked_reason='rotated_grace'`) yapıldığını döner.
   */
  countGraceRecoveries(
    tenantId: string,
    familyId: string,
    sinceMs: number,
  ): Promise<number>;
  /** RTR rotation: eski token'ı soft-revoke eder (revoked_at + reason). */
  revokeByTokenHash(
    tenantId: string,
    tokenHash: Buffer,
    reason: string,
  ): Promise<void>;
  /** Reuse detection: family'nin tüm aktif token'larını invalidate eder. */
  revokeFamilyAll(
    tenantId: string,
    familyId: string,
    reason: string,
  ): Promise<void>;
  /** All-sessions logout: kullanıcının tüm token'larını hard-delete eder. */
  deleteAllForUser(tenantId: string, userId: string): Promise<void>;
}
/*
 * ⚠️ `deleteExpired()` KALDIRILDI (S136, KVKK m.7 retention dilimi).
 *
 * Metot hiçbir zaman çağrılmamıştı ve retention artık
 * `apps/api/src/cron/ttl-cleanup.ts` → `purgeRefreshTokens` içinde, diğer üç
 * TTL task'ıyla BİREBİR aynı desenle (advisory lock + tenant-loop + CTE batch
 * + `audit.purge` self-audit) uygulanıyor. Bu task'a bağlanmak yerine
 * silinmesinin gerekçesi — metot **yanlış politikayı** kodluyordu ve canlı bir
 * tuzaktı:
 *   • Yüklemi `expires_at < now()` idi, yani beyan edilen **37 günlük** süreyi
 *     değil 30 günü uyguluyordu: bir saniye önce expire olmuş token'ı da
 *     silerdi. Bu, grace/soruşturma payını sıfırlar.
 *   • Batch'lemesi yoktu (tek DELETE, lock yığma riski) ve `audit.purge` izi
 *     bırakmıyordu → Amd6 watchdog'u onu göremezdi.
 *   • Tenant yüklemi yoktu; repo'nun diğer tüm metotları `tenantId` alır.
 * İleride onu "hazır" sanıp bağlayan bir çağıran, sessizce yanlış retention
 * uygulardı. Kaldırmak, bu dilimin ürettiği davranışın tek kaynağı olmasını
 * sağlar.
 */

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

    async findByTokenHash(tenantId, tokenHash) {
      const row = await db
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      return row ?? null;
    },

    async findActiveByFamilyForUpdate(tenantId, familyId) {
      // 1) KİLİT: tüm aile satırları kilitlenir (yalnız aktif olan değil) —
      // kurtarma yolu revoke edilmiş bir satırı da okuyup karar verdiği için
      // lock kapsamı aileyi bütün olarak içermeli.
      await db
        .selectFrom('refresh_tokens')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('family_id', '=', familyId)
        .forUpdate()
        .execute();

      // 2) TAZE OKUMA — AYRI statement (KRİTİK, security-review BLOCKER):
      // READ COMMITTED altında bloke olmuş bir `SELECT ... FOR UPDATE`
      // unblock olduğunda yalnız KENDİ kilitlediği satırların güncel halini
      // görür; rakip transaction'ın bu arada COMMIT ettiği YENİ satır (rakip
      // rotasyonun ürettiği yeni head) o statement'ın snapshot'ına GİRMEZ.
      // Kilit alındıktan sonra atılan yeni bir SELECT taze snapshot alır →
      // yeni head görünür. Bu ikinci sorgu da `FOR UPDATE` ile gider: aksi
      // halde yeni head kilitsiz kalır ve üçüncü bir istek onu paralel
      // rotate edebilirdi.
      const rows = await db
        .selectFrom('refresh_tokens')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('family_id', '=', familyId)
        .forUpdate()
        .execute();
      const now = Date.now();
      const active = rows.filter(
        (r) => r.revoked_at === null && r.expires_at.getTime() > now,
      );
      if (active.length === 0) return null;
      // Invaryant gereği en fazla bir aktif satır olmalı; savunmacı olarak en
      // yeni issued_at seçilir (geçmiş çatallanmış veriye karşı dayanıklılık).
      active.sort((a, b) => b.issued_at.getTime() - a.issued_at.getTime());
      return active[0] ?? null;
    },

    async countGraceRecoveries(tenantId, familyId, sinceMs) {
      const row = await db
        .selectFrom('refresh_tokens')
        .select(({ fn }) => fn.countAll<string>().as('cnt'))
        .where('tenant_id', '=', tenantId)
        .where('family_id', '=', familyId)
        .where('revoked_reason', '=', 'rotated_grace')
        .where('revoked_at', '>', new Date(Date.now() - sinceMs))
        .executeTakeFirst();
      return row === undefined ? 0 : Number(row.cnt);
    },

    async revokeByTokenHash(tenantId, tokenHash, reason) {
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date(), revoked_reason: reason })
        .where('tenant_id', '=', tenantId)
        .where('token_hash', '=', tokenHash)
        .where('revoked_at', 'is', null)
        .execute();
    },

    async revokeFamilyAll(tenantId, familyId, reason) {
      await db
        .updateTable('refresh_tokens')
        .set({ revoked_at: new Date(), revoked_reason: reason })
        .where('tenant_id', '=', tenantId)
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
  };
}
