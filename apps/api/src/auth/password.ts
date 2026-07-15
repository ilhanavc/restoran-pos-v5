import bcrypt from 'bcryptjs';

/**
 * Bcrypt cost = 12 (ADR-002). Daha düşük cost compile-time'da reddedilir.
 */
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
