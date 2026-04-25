import bcrypt from 'bcryptjs';

/**
 * Bcrypt cost = 12 (ADR-002). Daha düşük cost compile-time'da reddedilir.
 */
const BCRYPT_COST = 12;

/**
 * NIST 800-63B: minimum 10 karakter, karmaşıklık kuralı YOK.
 * Daha uzun parolalar zorunlu kompozisyondan iyidir.
 */
const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function validatePasswordStrength(plain: string): boolean {
  return plain.length >= MIN_PASSWORD_LENGTH;
}
