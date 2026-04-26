import { z } from 'zod';

export const TableStatusSchema = z.enum(['available', 'occupied', 'reserved', 'cleaning']);
export type TableStatus = z.infer<typeof TableStatusSchema>;

export const TableRowSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tableNo: z.number().int().positive(),
  label: z.string(),
  capacity: z.number().int().positive().nullable(),
  zone: z.string().nullable(),
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
