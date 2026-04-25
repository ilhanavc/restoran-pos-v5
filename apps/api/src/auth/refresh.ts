import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  createRefreshTokensRepository,
  createUsersRepository,
  type DB,
} from '@restoran-pos/db';
import { signAccessToken } from './jwt';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_BYTES = 32;

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

/**
 * RTR (Refresh Token Rotation) — ADR-002 §4.3:
 *  1. Hash hesapla → DB lookup
 *  2. Yoksa → 401 (AUTH_REFRESH_INVALID)
 *  3. revoked_at IS NOT NULL → REUSE: tüm family revoke + 401 (AUTH_REFRESH_REUSE)
 *  4. expires_at < now → 401
 *  5. Geçerli → yeni token üret, parent_id=eski.id, family_id korunur,
 *     eski token'ı 'rotated' ile revoke et, yeni access token üret.
 */
export async function rotateRefreshToken(
  params: RotateRefreshParams,
): Promise<RotateRefreshResult> {
  const repo = createRefreshTokensRepository(params.db);
  const usersRepo = createUsersRepository(params.db);
  const oldHash = hashToken(params.plainToken);

  const existing = await repo.findByTokenHash(oldHash);
  if (existing === null) {
    throw new RefreshTokenError('AUTH_REFRESH_INVALID');
  }

  // Reuse detection: revoked token tekrar geldi → tüm family invalidate.
  if (existing.revoked_at !== null) {
    await repo.revokeFamilyAll(existing.family_id, 'reuse_detected');
    throw new RefreshTokenError('AUTH_REFRESH_REUSE');
  }

  if (existing.expires_at.getTime() < Date.now()) {
    throw new RefreshTokenError('AUTH_REFRESH_INVALID');
  }

  // User hâlâ aktif mi?
  const user = await usersRepo.findById(existing.tenant_id, existing.user_id);
  if (user === null) {
    throw new RefreshTokenError('AUTH_REFRESH_INVALID');
  }

  // Create + revoke tek transaction'da — create başarılı / revoke başarısız senaryosunda
  // iki aktif token oluşmasını önler.
  const newPlain = generatePlainToken();
  const newHash = hashToken(newPlain);
  await params.db.transaction().execute(async (trx) => {
    const trxRepo = createRefreshTokensRepository(trx);
    await trxRepo.create({
      id: randomUUID(),
      tenantId: existing.tenant_id,
      userId: existing.user_id,
      tokenHash: newHash,
      familyId: existing.family_id,
      parentId: existing.id,
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    });
    await trxRepo.revokeByTokenHash(oldHash, 'rotated');
  });

  const accessToken = signAccessToken(
    {
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
    },
    params.accessSecret,
  );

  return {
    accessToken,
    newPlainToken: newPlain,
    userId: user.id,
    tenantId: user.tenant_id,
    role: user.role,
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
