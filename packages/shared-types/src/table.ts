import { z } from 'zod';

export const TableStatusSchema = z.enum(['available', 'occupied', 'reserved', 'cleaning']);
export type TableStatus = z.infer<typeof TableStatusSchema>;

/**
 * NOT: Bu schema şu an wire format ile uyumsuz (camelCase + tableNo/label/zone)
 * — tüketicisi yok. API/web `TableWithStatus` projection (snake_case) kullanır.
 * `areaId` Sprint 8c PR #1 ile eklendi (ADR-009); schema temizliği v5.1 backlog.
 */
export const TableRowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tableNo: z.number().int().positive(),
  label: z.string(),
  capacity: z.number().int().positive().nullable(),
  zone: z.string().nullable(),
  areaId: z.string().uuid().nullable(),
  status: TableStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TableRow = z.infer<typeof TableRowSchema>;

export const TablePublicSchema = TableRowSchema;
export type TablePublic = z.infer<typeof TablePublicSchema>;

export const TableCreateRequestSchema = z.object({
  code: z.string().min(1).max(32).trim(),
  capacity: z.number().int().positive().nullable().optional(),
});
export type TableCreateRequest = z.infer<typeof TableCreateRequestSchema>;

export const TableListQuerySchema = z.object({
  status: z.enum(['available', 'occupied']).optional(),
});
export type TableListQuery = z.infer<typeof TableListQuerySchema>;

/**
 * Sprint 4 Görev 19 — admin partial update (PATCH /tables/:id).
 * `status` kolonu YOK (orders JOIN ile türetilir — ADR-003 §14.2.B), bu yüzden
 * PATCH ile değişmez. `area_id` Sprint 5 / migration 007 sonrası eklenir.
 * `.refine()` ile en az bir alan zorunlu — boş body 422 VALIDATION_ERROR.
 */
export const TableUpdateRequestSchema = z
  .object({
    code: z.string().min(1).max(32).trim().optional(),
    capacity: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (data) => data.code !== undefined || data.capacity !== undefined,
    { message: 'En az bir alan girilmelidir.' },
  );
export type TableUpdateRequest = z.infer<typeof TableUpdateRequestSchema>;
