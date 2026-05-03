import { z } from 'zod';

/**
 * Müşteri yönetimi şemaları — ADR-016 §11 (Caller ID + müşteri rehberi).
 *
 * `rawPhone` ham giriş (UI'da gösterilir), `normalizedPhone` aramada UNIQUE
 * eşleştirmesi için kullanılır. Backend `normalizePhoneTr` ile her INSERT
 * öncesi türetir (zod input olarak yalnız `rawPhone` ister).
 */

export const PhoneSchema = z.object({
  rawPhone: z.string().min(1).max(30),
  normalizedPhone: z.string().min(1).max(20),
  isPrimary: z.boolean(),
  isMobile: z.boolean(),
});
export type CustomerPhone = z.infer<typeof PhoneSchema>;

export const AddressSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(40).default('Ev'),
  addressLine: z.string().min(5),
  district: z.string().max(80).nullable().optional(),
  neighborhood: z.string().max(80).nullable().optional(),
  addressNote: z.string().nullable().optional(),
  isDefault: z.boolean().default(false),
});
export type CustomerAddress = z.infer<typeof AddressSchema>;

/**
 * Yeni müşteri kayıt isteği. Telefonlar için `normalizedPhone` backend'de
 * türetildiği için input şeması yalnız `rawPhone` + `isPrimary` alır.
 */
export const CustomerCreateSchema = z.object({
  fullName: z.string().min(2).max(120),
  notes: z.string().nullable().optional(),
  phones: z
    .array(
      z.object({
        rawPhone: z.string().min(1).max(30),
        isPrimary: z.boolean().default(true),
      }),
    )
    .min(1, 'En az 1 telefon zorunlu'),
  addresses: z.array(AddressSchema.omit({ id: true })).default([]),
});
export type CustomerCreate = z.infer<typeof CustomerCreateSchema>;

export const CustomerUpdateSchema = CustomerCreateSchema.partial();
export type CustomerUpdate = z.infer<typeof CustomerUpdateSchema>;

export const CustomerResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  fullName: z.string(),
  notes: z.string().nullable(),
  isBlacklisted: z.boolean(),
  blacklistReason: z.string().nullable(),
  totalOrders: z.number().int().min(0),
  lastOrderAt: z.string().datetime().nullable(),
  phones: z.array(PhoneSchema),
  addresses: z.array(AddressSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Customer = z.infer<typeof CustomerResponseSchema>;

/**
 * Telefon prefix veya isim parçası ile arama (Caller ID popup + manuel arama).
 */
export const CustomerSearchQuerySchema = z.object({
  search: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CustomerSearchQuery = z.infer<typeof CustomerSearchQuerySchema>;

export const CustomerSearchResponseSchema = z.object({
  customers: z.array(
    CustomerResponseSchema.pick({
      id: true,
      fullName: true,
      phones: true,
      isBlacklisted: true,
      totalOrders: true,
    }),
  ),
});
export type CustomerSearchResponse = z.infer<typeof CustomerSearchResponseSchema>;

/**
 * Kara liste toggle. Listeye eklerken sebep en az 3 karakter zorunlu;
 * çıkarırken sebep ignore edilir (backend NULL'a çeker).
 */
/**
 * Sayfalı tüm müşteri listesi — admin müşteri yönetim ekranı.
 * v3 paritesi: 50/sayfa, "load more" şeklinde infinite-pagination.
 */
export const CustomerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuerySchema>;

export const CustomerListResponseSchema = z.object({
  customers: z.array(
    CustomerResponseSchema.pick({
      id: true,
      fullName: true,
      phones: true,
      isBlacklisted: true,
      totalOrders: true,
    }),
  ),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
});
export type CustomerListResponse = z.infer<typeof CustomerListResponseSchema>;

/**
 * Excel import — frontend SheetJS ile parse eder, satırları normalize JSON
 * olarak gönderir. Backend her satırı validate + dedupe, preview döner. Token
 * cache'lenir, kullanıcı onaylayınca commit'te DB INSERT yapılır.
 */
export const ImportRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  fullName: z.string().min(1).max(200),
  phone: z.string().max(40).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  addressTitle: z.string().max(60).nullable().optional(),
  district: z.string().max(80).nullable().optional(),
  neighborhood: z.string().max(80).nullable().optional(),
  addressNote: z.string().max(500).nullable().optional(),
  legacyV3No: z.string().max(40).nullable().optional(),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export const ImportPreviewRequestSchema = z.object({
  rows: z.array(ImportRowSchema).min(1).max(20000),
});
export type ImportPreviewRequest = z.infer<typeof ImportPreviewRequestSchema>;

export const ImportRowStatusSchema = z.enum(['create', 'skip']);
export type ImportRowStatus = z.infer<typeof ImportRowStatusSchema>;

export const ImportSkipReasonSchema = z.enum([
  'noPhone',
  'invalidPhone',
  'duplicate',
  'shortName',
  'duplicateInFile',
]);
export type ImportSkipReason = z.infer<typeof ImportSkipReasonSchema>;

export const ImportPreviewRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  fullName: z.string(),
  status: ImportRowStatusSchema,
  reason: ImportSkipReasonSchema.optional(),
  normalizedPhone: z.string().optional(),
  matchedCustomerId: z.string().uuid().optional(),
});
export type ImportPreviewRow = z.infer<typeof ImportPreviewRowSchema>;

export const ImportPreviewResponseSchema = z.object({
  previewToken: z.string().min(1),
  summary: z.object({
    total: z.number().int().min(0),
    willCreate: z.number().int().min(0),
    willSkip: z.number().int().min(0),
  }),
  rows: z.array(ImportPreviewRowSchema),
});
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;

export const ImportCommitRequestSchema = z.object({
  previewToken: z.string().min(1),
});
export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;

export const ImportCommitResponseSchema = z.object({
  created: z.number().int().min(0),
  skipped: z.number().int().min(0),
  errors: z.number().int().min(0),
});
export type ImportCommitResponse = z.infer<typeof ImportCommitResponseSchema>;

/**
 * Excel export — admin tüm müşteri rehberini CSV'ye düz tablo olarak indirir.
 * Backend JSON döner, frontend Blob ile CSV'ye çevirir (esneklik).
 */
export const CustomerExportRowSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  phones: z.array(z.string()),
  primaryPhone: z.string().nullable(),
  addresses: z.array(z.string()),
  totalOrders: z.number().int().min(0),
  isBlacklisted: z.boolean(),
  createdAt: z.string().datetime(),
});
export type CustomerExportRow = z.infer<typeof CustomerExportRowSchema>;

export const CustomerExportResponseSchema = z.object({
  customers: z.array(CustomerExportRowSchema),
  total: z.number().int().min(0),
});
export type CustomerExportResponse = z.infer<typeof CustomerExportResponseSchema>;

/**
 * Toplu HARD DELETE — admin only. CASCADE phones+addresses, orders.customer_id
 * SET NULL. Geri alınamaz; UI'da confirm dialog zorunlu.
 */
export const BulkDeleteRequestSchema = z.object({
  customerIds: z.array(z.string().uuid()).min(1).max(500),
});
export type BulkDeleteRequest = z.infer<typeof BulkDeleteRequestSchema>;

export const BulkDeleteResponseSchema = z.object({
  deleted: z.number().int().min(0),
});
export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponseSchema>;

export const BlacklistTogglePayloadSchema = z
  .object({
    isBlacklisted: z.boolean(),
    blacklistReason: z.string().min(3).max(500).optional(),
  })
  .refine((d) => !d.isBlacklisted || (d.blacklistReason !== undefined && d.blacklistReason.length >= 3), {
    message: 'Kara listeye eklerken sebep zorunlu (en az 3 karakter)',
    path: ['blacklistReason'],
  });
export type BlacklistTogglePayload = z.infer<typeof BlacklistTogglePayloadSchema>;
