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

/**
 * Products entity şeması — DB `products` tablosuna birebir uyumlu (ADR-003 §8.6
 * Amendment 2026-04-27 prerequisite). Mevcut DB kolonları: id, tenant_id,
 * category_id, name, price_cents, deleted_at, timestamps. v3'teki `is_available`
 * / `sort_order` MVP kapsamı dışı (active-plan §18 kapsam kilidi).
 */
export const ProductSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string().min(1),
  priceCents: MoneyCentsSchema,
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Product = z.infer<typeof ProductSchema>;

/**
 * ProductVariant entity şeması — DB `product_variants` tablosuna birebir uyumlu
 * (Migration 006). `priceDeltaCents` ADR-003 §8.6 Amendment 2026-04-28: signed
 * integer (negative = küçük porsiyon, sıfır = base, positive = üst seviye).
 */
export const ProductVariantSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string().min(1),
  priceDeltaCents: z.number().int(),
  isDefault: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProductVariant = z.infer<typeof ProductVariantSchema>;

export const CategoryCreateRequestSchema = z.object({
  name: z.string().min(1).max(64).trim(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type CategoryCreateRequest = z.infer<typeof CategoryCreateRequestSchema>;

/**
 * PATCH /menu/categories/:id body — Sprint 4 Görev 20.
 *
 * Partial update: en az bir alan dolu olmalı; boş body 400 VALIDATION_ERROR
 * (refine `patch:empty_body`). DB `categories` tablosunda yalnız `name` ve
 * `sort_order` kolonları yazılabilir — `vat_rate_bps` MVP kapsamı dışı (kolon
 * yok, ADR-003 §8.6 amendment'larında tanımlanmadı). Eklenmek istenirse ayrı
 * migration + ADR amendment gerekir.
 *
 * `id`/`tenantId`/`deletedAt`/timestamps API tarafından yönetilir, body'de
 * gönderilemez (zod strict olmasa bile field whitelist'i sadece `name`,
 * `sortOrder` olduğu için fazla alanlar parse'da düşer).
 */
export const CategoryUpdateRequestSchema = z
  .object({
    name: z.string().min(1).max(64).trim().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.sortOrder !== undefined,
    { message: 'patch:empty_body' },
  );
export type CategoryUpdateRequest = z.infer<typeof CategoryUpdateRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Products/Variants CRUD request schemas — ADR-003 §8.6 (Görev 18)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tek variant write payload (POST/PATCH /products body içinde nested array
 * elemanı). `id` opsiyonel: yeni variant id'siz, mevcut variant id'li gelir
 * (PATCH declarative replace semantiği — ADR-003 §8.6 K1).
 *
 * `priceDeltaCents` signed (Amendment 2026-04-28). `sortOrder` SMALLINT range
 * (0..32767) — DB sınırını yansıtır.
 */
export const ProductVariantWriteSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(64).trim(),
  priceDeltaCents: z.number().int(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(32767).optional(),
});
export type ProductVariantWrite = z.infer<typeof ProductVariantWriteSchema>;

/**
 * `is_default` superRefine (ADR-003 §8.6 K1): variants array'i boş değilse
 *  - `is_default=true` en fazla 1 (birden fazla → 422 VALIDATION_ERROR)
 *  - `is_default=true` en az 1 (hiçbiri true değilse → 422)
 * Variants array boş veya undefined → kural devre dışı (variantsız ürün).
 */
function refineVariantsIsDefault(
  variants: ProductVariantWrite[] | undefined,
  ctx: z.RefinementCtx,
): void {
  if (variants === undefined || variants.length === 0) return;
  const defaults = variants.filter((v) => v.isDefault === true);
  if (defaults.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'variants:multiple_default',
      path: ['variants'],
    });
  }
  if (defaults.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'variants:no_default',
      path: ['variants'],
    });
  }
}

/**
 * POST /products body — admin nested write. ADR-003 §8.6 K1.
 */
export const ProductCreateRequestSchema = z
  .object({
    categoryId: z.string().uuid(),
    name: z.string().min(1).max(128).trim(),
    priceCents: MoneyCentsSchema,
    variants: z.array(ProductVariantWriteSchema).max(50).optional(),
  })
  .superRefine((data, ctx) => {
    refineVariantsIsDefault(data.variants, ctx);
  });
export type ProductCreateRequest = z.infer<typeof ProductCreateRequestSchema>;

/**
 * PATCH /products/:id body — partial update. `variants` body'de varsa declarative
 * replace (eksikler soft delete, yeniler insert, mevcutlar update). Yoksa
 * variants dokunulmaz. `variants: []` → tüm variantları sil. ADR-003 §8.6 K1 K3.
 *
 * `refine`: en az bir alan dolu olmalı (boş PATCH 400).
 */
export const ProductUpdateRequestSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    name: z.string().min(1).max(128).trim().optional(),
    priceCents: MoneyCentsSchema.optional(),
    variants: z.array(ProductVariantWriteSchema).max(50).optional(),
  })
  .refine(
    (data) =>
      data.categoryId !== undefined ||
      data.name !== undefined ||
      data.priceCents !== undefined ||
      data.variants !== undefined,
    { message: 'patch:empty_body' },
  )
  .superRefine((data, ctx) => {
    refineVariantsIsDefault(data.variants, ctx);
  });
export type ProductUpdateRequest = z.infer<typeof ProductUpdateRequestSchema>;

/**
 * GET /products response item — nested variants (deleted_at IS NULL filtreli).
 * ADR-003 §8.6 K4.
 */
export const ProductWithVariantsSchema = ProductSchema.extend({
  variants: z.array(ProductVariantSchema),
});
export type ProductWithVariants = z.infer<typeof ProductWithVariantsSchema>;
