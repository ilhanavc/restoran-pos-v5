import { z } from 'zod';

export const AreaSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(40),
  sortOrder: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Area = z.infer<typeof AreaSchema>;
