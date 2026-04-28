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
  password: z.string().min(10),
  role: UserRoleSchema,
  name: z.string().min(1),
  tenantId: z.string().uuid(),
});
export type UserCreate = z.infer<typeof UserCreateSchema>;

/**
 * POST /users API request body. tenantId server tarafında req.user.tenantId
 * üzerinden bind edilir; istemci body'de göndermez (tenant spoofing engeli).
 */
export const UserCreateApiRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  role: UserRoleSchema,
  name: z.string().min(1),
});
export type UserCreateApiRequest = z.infer<typeof UserCreateApiRequestSchema>;

/**
 * PATCH /users/:id partial update. Boş body yasak — en az bir alan zorunlu.
 * Password bu rota üzerinden değişmez (ayrı endpoint: PATCH /users/:id/password).
 * `role` değişikliği son admin guard'ını atlatamaz: admin'in role'ünü düşürürken
 * countActiveAdmins kontrolü uygulanır (handler'da explicit).
 */
export const UserUpdateSchema = z
  .object({
    email: z.string().email().optional(),
    role: UserRoleSchema.optional(),
    name: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.email !== undefined || v.role !== undefined || v.name !== undefined,
    { message: 'at least one field is required' },
  );
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

/**
 * PATCH /users/:id/password — kendi şifresi (any role) veya admin başkasının
 * şifresi. `currentPassword` admin → başkası akışında opsiyonel; kendi şifresi
 * akışında zorunlu (handler'da explicit kontrol; schema iki akışı da kapsar).
 */
export const UserPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(10),
});
export type UserPasswordChange = z.infer<typeof UserPasswordChangeSchema>;

export const UserListResponseSchema = z.object({
  data: z.object({
    users: z.array(UserPublicSchema),
  }),
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
