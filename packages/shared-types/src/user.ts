import { z } from 'zod';

export const UserRoleSchema = z.enum(['admin', 'cashier', 'waiter', 'kitchen']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserPublicSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string().email().nullable(),  // nullable: DB Phase 3'te NOT NULL yapılana kadar
  role: UserRoleSchema,
  name: z.string(),
  createdAt: z.string().datetime(),
});
export type UserPublic = z.infer<typeof UserPublicSchema>;

export const UserCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: UserRoleSchema,
  name: z.string().min(1),
  tenantId: z.string().uuid(),
});
export type UserCreate = z.infer<typeof UserCreateSchema>;
