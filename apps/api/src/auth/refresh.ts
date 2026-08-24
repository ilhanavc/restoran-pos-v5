import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  createRefreshTokensRepository,
  createUsersRepository,
  type DB,
} from '@restoran-pos/db';
import { signAccessToken } from './jwt';
import { getRefreshGraceMs } from '../config/authConfig';
import { logger } from '../logger';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 32;

/**
 * Grace kurtarması sırasında revoke edilen head'in reason'ı (ADR-002 §11.6.1).
 * Davranışsal etkisi yok — `rotated` ile eşdeğer; yalnız ayırt edilebilir iz.
 */
const REASON_ROTATED_GRACE = 'rotated_grace';

/** Grace koşuluna giren reason'lar (ADR-002 §11.3 adım 2a). */
const GRACE_ELIGIBLE_REASONS: readonly string[] = ['rotated', REASON_ROTATED_GRACE];

/** Suistimal tavanı penceresi — ADR-002 §11.6.4. */
const GRACE_ABUSE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Tavan: pencerede bu kadar kurtarma zaten yapılmışsa yeni istek kurtarılmaz.
 * 5 kurtarma serbest; 6. deneme "yarış" değil "oynatma" imzası sayılır
 * (kurtarılsaydı pencerede 5'ten fazla `rotated_grace` kaydı oluşurdu).
 */
const GRACE_ABUSE_MAX_RECOVERIES = 5;

/**
 * Plain refresh token üretir: 32 byte random → base64url (43 karakter).
 */
function generatePlainToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 Buffer hash. Plain token DB'ye ASLA yazılmaz, sadece hash.
 */
function hashToken(plain: string): Buffer {
  return createHash('sha256').update(plain).digest();
}

export interface IssueRefreshParams {
  db: Kysely<DB>;
  userId: string;
  tenantId: string;
  deviceLabel?: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Yeni login için refresh token üret. Yeni `family_id` (rotasyon zincirinin kökü).
 * Plain token döner — caller bunu cookie'ye yazar, bir daha asla görmez.
 */
export async function issueRefreshToken(
  params: IssueRefreshParams,
): Promise<string> {
  const repo = createRefreshTokensRepository(params.db);
  const plain = generatePlainToken();
  const tokenHash = hashToken(plain);
  const now = Date.now();
  await repo.create({
    id: randomUUID(),
    tenantId: params.tenantId,
    userId: params.userId,
    tokenHash,
    familyId: randomUUID(),
    expiresAt: new Date(now + THIRTY_DAYS_MS),
    ...(params.deviceLabel !== undefined && { deviceLabel: params.deviceLabel }),
    ...(params.userAgent !== undefined && { userAgent: params.userAgent }),
    ...(params.ipAddress !== undefined && { ipAddress: params.ipAddress }),
  });
  return plain;
}

export interface RotateRefreshParams {
  db: Kysely<DB>;
  plainToken: string;
  accessSecret: string;
}

export interface RotateRefreshResult {
  accessToken: string;
  newPlainToken: string;
  userId: string;
  tenantId: string;
  role: string;
}

export class RefreshTokenError extends Error {
  public readonly code: 'AUTH_REFRESH_INVALID' | 'AUTH_REFRESH_REUSE';
  constructor(code: 'AUTH_REFRESH_INVALID' | 'AUTH_REFRESH_REUSE') {
    super(code);
    this.code = code;
    this.name = 'RefreshTokenError';
  }
}

/** Transaction içinde alınan karar — hata durumunda da COMMIT gerekir. */
type RotateOutcome =
  | {
      kind: 'rotated';
      userId: string;
      tenantId: string;
      role: string;
      familyId: string;
      /** Grace kurtarması yapıldıysa revoke edilen head'in yaşı (ms). */
      graceAgeMs: number | null;
    }
  | { kind: 'error'; code: 'AUTH_REFRESH_INVALID' | 'AUTH_REFRESH_REUSE' };

/**
 * RTR (Refresh Token Rotation) — ADR-002 §4.3 + §11 (Amendment 5):
 *  1. Hash hesapla → DB lookup (aileyi bulmak için ön-okuma)
 *  2. Yoksa → 401 (AUTH_REFRESH_INVALID)
 *  3. Tek transaction: aile `FOR UPDATE` ile kilitlenir, durum YENİDEN okunur
 *     (lock-then-recheck, §11.5) — eşzamanlı istekler serileştirilir.
 *  4. revoked_at IS NOT NULL:
 *     a. reason ∈ {rotated, rotated_grace} VE yaş ≤ grace penceresi VE suistimal
 *        tavanı aşılmamış → KURTARMA: ailenin aktif başı (head) rotate edilir
 *        (re-anchor, §11.3). Head yoksa → 401 INVALID, aile TEKRAR revoke edilmez.
 *     b. aksi halde (logout/admin_force/all_sessions/reuse_detected veya pencere
 *        dışı) → tüm family revoke + 401 (AUTH_REFRESH_REUSE) — davranış değişmez.
 *  5. expires_at < now → 401
 *  6. Geçerli → yeni token üret, parent_id=anchor.id, family_id korunur,
 *     anchor'ı 'rotated' (kurtarmada 'rotated_grace') ile revoke et.
 *
 * Aile invaryantı: her `family_id` için en fazla BİR aktif token (§11.7).
 */
export async function rotateRefreshToken(
  params: RotateRefreshParams,
): Promise<RotateRefreshResult> {
  const repo = createRefreshTokensRepository(params.db);
  const oldHash = hashToken(params.plainToken);

  // Ön-okuma: yalnız family_id'yi öğrenip kilidi daraltmak için. Karar bu satıra
  // göre VERİLMEZ — kilit alındıktan sonra her şey yeniden okunur.
  const preliminary = await repo.findByTokenHash(oldHash);
  if (preliminary === null) {
    throw new RefreshTokenError('AUTH_REFRESH_INVALID');
  }

  const graceMs = getRefreshGraceMs();
  const newPlain = generatePlainToken();
  const newHash = hashToken(newPlain);

  const outcome: RotateOutcome = await params.db
    .transaction()
    .execute(async (trx): Promise<RotateOutcome> => {
      const trxRepo = createRefreshTokensRepository(trx);
      const usersRepo = createUsersRepository(trx);

      // Aile satırlarını kilitle + aktif başı al (§11.5).
      const head = await trxRepo.findActiveByFamilyForUpdate(
        preliminary.family_id,
      );
      // Lock-then-recheck: sunulan token'ın durumu kilit altında yeniden okunur.
      const current = await trxRepo.findByTokenHash(oldHash);
      if (current === null) {
        return { kind: 'error', code: 'AUTH_REFRESH_INVALID' };
      }

      let anchor = current;
      let graceAgeMs: number | null = null;

      if (current.revoked_at !== null) {
        const ageMs = Date.now() - current.revoked_at.getTime();
        const reason = current.revoked_reason ?? '';
        const inGrace =
          GRACE_ELIGIBLE_REASONS.includes(reason) && ageMs <= graceMs;
        if (!inGrace) {
          // Gerçek reuse imzası → mevcut davranış birebir (§11.4).
          await trxRepo.revokeFamilyAll(current.family_id, 'reuse_detected');
          return { kind: 'error', code: 'AUTH_REFRESH_REUSE' };
        }

        // Suistimal tavanı (§11.6.4): tekrarlayan kurtarma = oynatma imzası.
        const recoveries = await trxRepo.countGraceRecoveries(
          current.family_id,
          GRACE_ABUSE_WINDOW_MS,
        );
        if (recoveries >= GRACE_ABUSE_MAX_RECOVERIES) {
          await trxRepo.revokeFamilyAll(current.family_id, 'reuse_detected');
          return { kind: 'error', code: 'AUTH_REFRESH_REUSE' };
        }

        if (head === null) {
          // Aile zaten ölü — gereksiz `reuse_detected` gürültüsü üretmeyiz.
          return { kind: 'error', code: 'AUTH_REFRESH_INVALID' };
        }
        anchor = head;
        graceAgeMs = ageMs;
      } else if (current.expires_at.getTime() < Date.now()) {
        return { kind: 'error', code: 'AUTH_REFRESH_INVALID' };
      }

      // User hâlâ aktif mi?
      const user = await usersRepo.findById(anchor.tenant_id, anchor.user_id);
      if (user === null) {
        return { kind: 'error', code: 'AUTH_REFRESH_INVALID' };
      }

      // Create + revoke aynı transaction'da — create başarılı / revoke başarısız
      // senaryosunda iki aktif token oluşmasını önler.
      await trxRepo.create({
        id: randomUUID(),
        tenantId: anchor.tenant_id,
        userId: anchor.user_id,
        tokenHash: newHash,
        familyId: anchor.family_id,
        parentId: anchor.id,
        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
      });
      await trxRepo.revokeByTokenHash(
        anchor.token_hash,
        graceAgeMs === null ? 'rotated' : REASON_ROTATED_GRACE,
      );

      return {
        kind: 'rotated',
        userId: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        familyId: anchor.family_id,
        graceAgeMs,
      };
    });

  if (outcome.kind === 'error') {
    throw new RefreshTokenError(outcome.code);
  }

  if (outcome.graceAgeMs !== null) {
    // KVKK: plain token / hash / tam IP loglanmaz (ADR-002 §11.6.2).
    logger.info(
      {
        event: 'auth.refresh.grace_recovered',
        user_id: outcome.userId,
        tenant_id: outcome.tenantId,
        family_id: outcome.familyId,
        age_ms: outcome.graceAgeMs,
      },
      'auth.refresh.grace_recovered',
    );
  }

  const accessToken = signAccessToken(
    {
      sub: outcome.userId,
      tenant_id: outcome.tenantId,
      role: outcome.role,
    },
    params.accessSecret,
  );

  return {
    accessToken,
    newPlainToken: newPlain,
    userId: outcome.userId,
    tenantId: outcome.tenantId,
    role: outcome.role,
  };
}

/**
 * Logout: plain token'ı hash'le ve revoke et.
 * Token bulunamazsa sessizce no-op (idempotent logout).
 */
export async function revokeRefreshToken(
  db: Kysely<DB>,
  plainToken: string,
): Promise<void> {
  const repo = createRefreshTokensRepository(db);
  await repo.revokeByTokenHash(hashToken(plainToken), 'logout');
}
