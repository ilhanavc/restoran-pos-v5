import { z } from 'zod';
import { UserPublicSchema } from './user.js';

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// `expiresIn` (access TTL saniye) route'ta her zaman dönüyordu ama şemada
// eksikti (drift) — kapatıldı. `refreshToken` yalnız mobil akışta (X-Client:
// mobile) gelir; web HttpOnly cookie kullandığından body'de dönmez → optional.
export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: UserPublicSchema,
  refreshToken: z.string().optional(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

// `.max(512)` savunma derinliği: gerçek refresh token base64url ~43 char;
// üst sınır, body-kaynaklı (mobil) refresh'te garbage/uzun girdiyi rotation
// lookup'ından önce eler (security-reviewer 2a).
export const RefreshRequestSchema = z.object({
  refreshToken: z.string().max(512).optional(),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

// `POST /auth/refresh` yanıtı. `refreshToken` yalnız body-kaynaklı (mobil)
// rotasyonda döner; cookie-kaynaklı (web) rotasyonda Set-Cookie ile döner,
// body'de yer almaz → optional. (ADR-002 §2 mobil body-refresh.)
export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  refreshToken: z.string().optional(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(['admin', 'cashier', 'waiter', 'kitchen']),
  tenantId: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;
