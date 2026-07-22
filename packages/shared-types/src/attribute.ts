import { z } from 'zod';

/**
 * ADR-012 Karar 3 — selection_type CHECK ('single', 'multiple').
 * Yeni enum tipi yerine string + CHECK (ADR-003 §9.1 az değerli kümeler).
 */
export const AttributeSelectionTypeEnum = z.enum(['single', 'multiple']);
export type AttributeSelectionType = z.infer<typeof AttributeSelectionTypeEnum>;

/**
 * Attribute grubu entity şeması — DB `attribute_groups` (Migration 008).
 * `name` 1..60 char (DB CHECK char_length(trim) ile bire bir).
 * `sortOrder` SMALLINT DEFAULT 0; soft-delete `deletedAt`.
 */
export const AttributeGroupSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(60),
  selectionType: AttributeSelectionTypeEnum,
  isRequired: z.boolean(),
  sortOrder: z.number().int().min(0).max(32767),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AttributeGroup = z.infer<typeof AttributeGroupSchema>;

/**
 * POST /attribute-groups request body — admin only (ADR-012 RBAC).
 * Partial UNIQUE (tenant_id, lower(trim(name))) WHERE deleted_at IS NULL ile bire bir.
 */
export const AttributeGroupCreateRequestSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  selectionType: AttributeSelectionTypeEnum,
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(32767).default(0),
});
export type AttributeGroupCreateRequest = z.infer<typeof AttributeGroupCreateRequestSchema>;

/**
 * PATCH /attribute-groups/:id — partial update; boş body 400 VALIDATION_ERROR.
 */
export const AttributeGroupUpdateRequestSchema = z
  .object({
    name: z.string().min(1).max(60).trim().optional(),
    selectionType: AttributeSelectionTypeEnum.optional(),
    isRequired: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(32767).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.selectionType !== undefined ||
      d.isRequired !== undefined ||
      d.sortOrder !== undefined,
    { message: 'patch:empty_body' },
  );
export type AttributeGroupUpdateRequest = z.infer<typeof AttributeGroupUpdateRequestSchema>;

/**
 * Özellik ek ücreti tavanı (kuruş, işaretli): **±100000 = ±1.000 TL**
 * — ADR-012 Karar 4, **Amendment 1 (2026-07-22)** ile ±100 TL'den yükseltildi
 * (130 TL'lik "duble kaşarlı" eklenemiyordu).
 *
 * ⚠️ Aynı sınır DB'de de CHECK olarak duruyor
 * (`attribute_options_extra_price_cents_check`, Migration 050). **İkisi birlikte
 * değişir** — yalnız burayı gevşetmek isteği doğrulamadan geçirir, INSERT 23514
 * ile patlar; yalnız DB'yi gevşetmek ise zod'a takılır.
 */
export const ATTRIBUTE_EXTRA_PRICE_CAP_CENTS = 100_000;

/**
 * Attribute option entity — DB `attribute_options` (Migration 009).
 * `extraPriceCents`: signed INTEGER, cap ±`ATTRIBUTE_EXTRA_PRICE_CAP_CENTS`.
 * Float yasağı (CLAUDE.md): kuruş integer.
 */
export const AttributeOptionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  groupId: z.string().uuid(),
  name: z.string().min(1).max(60),
  extraPriceCents: z
    .number()
    .int()
    .min(-ATTRIBUTE_EXTRA_PRICE_CAP_CENTS)
    .max(ATTRIBUTE_EXTRA_PRICE_CAP_CENTS),
  isDefault: z.boolean(),
  sortOrder: z.number().int().min(0).max(32767),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AttributeOption = z.infer<typeof AttributeOptionSchema>;

/**
 * POST /attribute-groups/:id/options — admin only.
 */
export const AttributeOptionCreateRequestSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  extraPriceCents: z
    .number()
    .int()
    .min(-ATTRIBUTE_EXTRA_PRICE_CAP_CENTS)
    .max(ATTRIBUTE_EXTRA_PRICE_CAP_CENTS)
    .default(0),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(32767).default(0),
});
export type AttributeOptionCreateRequest = z.infer<typeof AttributeOptionCreateRequestSchema>;

/**
 * PATCH /attribute-groups/:id/options/:optId — partial update.
 */
export const AttributeOptionUpdateRequestSchema = z
  .object({
    name: z.string().min(1).max(60).trim().optional(),
    extraPriceCents: z
      .number()
      .int()
      .min(-ATTRIBUTE_EXTRA_PRICE_CAP_CENTS)
      .max(ATTRIBUTE_EXTRA_PRICE_CAP_CENTS)
      .optional(),
    isDefault: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(32767).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.extraPriceCents !== undefined ||
      d.isDefault !== undefined ||
      d.sortOrder !== undefined,
    { message: 'patch:empty_body' },
  );
export type AttributeOptionUpdateRequest = z.infer<typeof AttributeOptionUpdateRequestSchema>;

/**
 * Category ↔ attribute_group link entity (hard-delete, ADR-012 Karar 5).
 */
export const CategoryAttributeAssignmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  categoryId: z.string().uuid(),
  groupId: z.string().uuid(),
  sortOrder: z.number().int().min(0).max(32767),
  createdAt: z.string().datetime(),
});
export type CategoryAttributeAssignment = z.infer<typeof CategoryAttributeAssignmentSchema>;

/**
 * Product ↔ attribute_group link entity (hard-delete).
 */
export const ProductAttributeAssignmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  productId: z.string().uuid(),
  groupId: z.string().uuid(),
  sortOrder: z.number().int().min(0).max(32767),
  createdAt: z.string().datetime(),
});
export type ProductAttributeAssignment = z.infer<typeof ProductAttributeAssignmentSchema>;

/**
 * Effective attribute group: ürün için resolve edilmiş grup
 * (kaynağı product-direct mı, kategoriden inheritance mi).
 */
export const EffectiveAttributeGroupSchema = AttributeGroupSchema.extend({
  source: z.enum(['product', 'category']),
  options: z.array(AttributeOptionSchema),
});
export type EffectiveAttributeGroup = z.infer<typeof EffectiveAttributeGroupSchema>;
