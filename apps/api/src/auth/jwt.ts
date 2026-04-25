import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

/**
 * Access token payload. ADR-002: HS256, kid='v1', aud+iss claim, ttl=30m.
 * `jti` her token için yeni UUID — replay defense / logout-by-jti gelecekte.
 */
export interface JwtPayload {
  sub: string;
  tenant_id: string;
  role: string;
  jti: string;
  type: 'access';
}

const AUDIENCE = 'restoran-pos-v5';
const ISSUER = 'restoran-pos-v5-api';
const ACCESS_TTL = '30m';
const KID = 'v1';

/**
 * Access JWT imzalar. Payload'a `type: 'access'` ve fresh `jti` eklenir.
 * Header'a `kid: 'v1'` konur — gelecekte secret rotation için.
 */
export function signAccessToken(
  payload: Omit<JwtPayload, 'type' | 'jti'>,
  secret: string,
): string {
  const fullPayload: JwtPayload = {
    ...payload,
    type: 'access',
    jti: randomUUID(),
  };
  return jwt.sign(fullPayload, secret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL,
    audience: AUDIENCE,
    issuer: ISSUER,
    header: { kid: KID, alg: 'HS256' },
  });
}

/**
 * Access JWT doğrular. Hata durumunda jenerik Error fırlatır —
 * payload detayı veya iç hata mesajı dışarı sızmaz.
 */
export function verifyAccessToken(token: string, secret: string): JwtPayload {
  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      audience: AUDIENCE,
      issuer: ISSUER,
    });
  } catch {
    throw new Error('AUTH_TOKEN_INVALID');
  }
  if (typeof decoded === 'string') {
    throw new Error('AUTH_TOKEN_INVALID');
  }
  if (
    typeof decoded.sub !== 'string' ||
    typeof decoded['tenant_id'] !== 'string' ||
    typeof decoded['role'] !== 'string' ||
    typeof decoded['jti'] !== 'string' ||
    decoded['type'] !== 'access'
  ) {
    throw new Error('AUTH_TOKEN_INVALID');
  }
  return {
    sub: decoded.sub,
    tenant_id: decoded['tenant_id'],
    role: decoded['role'],
    jti: decoded['jti'],
    type: 'access',
  };
}
