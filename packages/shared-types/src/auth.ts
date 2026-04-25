import { z } from 'zod';
import { UserPublicSchema } from './user.js';

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  user: UserPublicSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().optional(),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(['admin', 'cashier', 'waiter', 'kitchen']),
  tenantId: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtPayload = z.infer<typeof JwtPayloadSchema>;
