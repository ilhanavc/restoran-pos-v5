import { z } from 'zod';

/**
 * Salon bölgesi entity şeması — DB `areas` tablosuna birebir uyumlu
 * (Migration 007, ADR-009 Karar 1). `name` 1..40 char (DB CHECK ile bire bir),
 * `sortOrder` SMALLINT DEFAULT 0.
 */
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

/**
 * POST /areas request body — admin only (ADR-009 Karar 4).
 *
 * `name` `.trim()` + 1..40: DB CHECK `length(name) BETWEEN 1 AND 40` ve
 * partial UNIQUE `lower(trim(name)) WHERE deleted_at IS NULL` (Migration 007)
 * ile bire bir. `sortOrder` opsiyonel — DB DEFAULT 0.
 */
export const AreaCreateRequestSchema = z.object({
  name: z.string().min(1).max(40).trim(),
  sortOrder: z.number().int().min(0).max(32767).optional(),
});
export type AreaCreateRequest = z.infer<typeof AreaCreateRequestSchema>;

/**
 * PATCH /areas/:id request body — admin only.
 *
 * Partial update: en az bir alan dolu olmalı; boş body 400 VALIDATION_ERROR
 * (refine `patch:empty_body`, validateBody üzerinden errorHandler'a delege).
 * `id`/`tenantId`/`deletedAt`/timestamps API tarafından yönetilir.
 */
export const AreaUpdateRequestSchema = z
  .object({
    name: z.string().min(1).max(40).trim().optional(),
    sortOrder: z.number().int().min(0).max(32767).optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.sortOrder !== undefined,
    { message: 'patch:empty_body' },
  );
export type AreaUpdateRequest = z.infer<typeof AreaUpdateRequestSchema>;

/**
 * GET /areas response item — sort_order ASC, name ASC tiebreaker
 * (ADR-009 Domain service). Soft-deleted satırlar dönmez.
 */
export const AreaListResponseSchema = z.object({
  areas: z.array(AreaSchema),
});
export type AreaListResponse = z.infer<typeof AreaListResponseSchema>;

/**
 * PATCH /tables/:id/area request body — admin only (ADR-009 Karar 4).
 *
 * `area_id: null` → masayı bölgeden çıkar (unassign). Snake_case body
 * (REST endpoint v3 paritesi); diğer table response'lar zaten snake_case.
 */
export const TableAreaAssignRequestSchema = z.object({
  area_id: z.string().uuid().nullable(),
});
export type TableAreaAssignRequest = z.infer<typeof TableAreaAssignRequestSchema>;
