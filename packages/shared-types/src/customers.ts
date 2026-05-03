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
