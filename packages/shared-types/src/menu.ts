import { z } from 'zod';
import { MoneyCentsSchema } from './money.js';

export const CategorySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  vatRateBps: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Category = z.infer<typeof CategorySchema>;

export const ProductSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string().min(1),
  priceCents: MoneyCentsSchema,
  isAvailable: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Product = z.infer<typeof ProductSchema>;

export const ProductVariantSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string().min(1),
  priceDeltaCents: z.number().int(),
  isDefault: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

export const CategoryCreateRequestSchema = z.object({
  name: z.string().min(1).max(64).trim(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CategoryCreateRequest = z.infer<typeof CategoryCreateRequestSchema>;
