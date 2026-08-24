import { z } from 'zod';

import { apiRequest } from './http';

/**
 * Müşteri API'si — mobil (ADR-039 K2/K3, DoD 9).
 *
 * **Kapsam kısıtı, yetki kısıtı DEĞİL.** ADR-039 S1=(c) ile garson sunucu
 * tarafında kasiyerle AYNI müşteri erişimine sahiptir (12 uç); bu modül Faz 1
 * paket-sipariş akışının ihtiyaç duyduğu ÜÇ yüzeyi taşır: arama, yeni müşteri,
 * adres okuma. Müşteri YÖNETİM ekranları (liste gezinme, düzenleme, telefon/
 * adres CRUD, sipariş geçmişi) bu fazda RENDER EDİLMEZ (K12.3) — v5.1 işi.
 *
 * **Rol-koşullu projeksiyon YOKTUR** (K3.1): sunucu garsona kasiyerle birebir
 * aynı gövdeyi döner, dolayısıyla burada da tek şema vardır. Sınırda zod ile
 * parse edilir; bilinmeyen alanlar düşer.
 *
 * **PII:** bu modül telefon/adres/not taşır. Hiçbir yerde log'lanmaz, arama
 * terimi de log'lanmaz (K8 — Caller ID log yasağının aynı ruhu).
 */

/** Telefon satırı — arama sonucunda `isMobile` gelmez, detayda gelir. */
const PhoneSchema = z.object({
  rawPhone: z.string(),
  normalizedPhone: z.string(),
  isPrimary: z.boolean(),
});

/** Adres satırı (`GET /customers/:id` projeksiyonu). */
const AddressSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  addressLine: z.string(),
  district: z.string().nullable(),
  neighborhood: z.string().nullable(),
  addressNote: z.string().nullable(),
  isDefault: z.boolean(),
});
export type CustomerAddress = z.infer<typeof AddressSchema>;

/** `GET /customers/search` satırı (özet projeksiyon — adres YOK). */
const CustomerSummarySchema = z.object({
  id: z.string(),
  fullName: z.string(),
  isBlacklisted: z.boolean(),
  totalOrders: z.number(),
  phones: z.array(PhoneSchema),
});
export type CustomerSummary = z.infer<typeof CustomerSummarySchema>;

const CustomerSearchResponseSchema = z.object({
  data: z.object({ customers: z.array(CustomerSummarySchema) }),
});

/**
 * `GET /customers/:id` + `POST /customers` yanıtı — **düz DTO**,
 * `{ data: { customer } }` DEĞİL (`{ data: <müşteri> }`). Sarmalayıcı yanlış
 * varsayılırsa hata yalnız canlı cihazda görünür
 * ([[feedback_mutation_response_shape_mismatch]]) → şekil burada birebir yazılır.
 */
const CustomerDetailSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  notes: z.string().nullable(),
  isBlacklisted: z.boolean(),
  totalOrders: z.number(),
  phones: z.array(PhoneSchema.extend({ isMobile: z.boolean().nullable() })),
  addresses: z.array(AddressSchema),
});
export type CustomerDetail = z.infer<typeof CustomerDetailSchema>;

const CustomerDetailResponseSchema = z.object({ data: CustomerDetailSchema });

/**
 * Müşteri arama (`GET /customers/search`).
 *
 * Minimum sorgu uzunluğu / sonuç tavanı / telefon maskeleme **uygulanmaz**
 * (K3.1 — kasiyerle birebir aynı davranış). Sunucu tarafında `limit` üst
 * sınırı 50'dir; burada 20 (sunucu varsayılanı) kullanılır.
 *
 * Çağıran taraf isteği **debounce** etmelidir (K11) — hem UX hem K4 rate
 * limit bütçesi için.
 */
export async function searchCustomers(
  search: string,
): Promise<CustomerSummary[]> {
  const json = await apiRequest(
    `/customers/search?search=${encodeURIComponent(search)}`,
  );
  return CustomerSearchResponseSchema.parse(json).data.customers;
}

/** Müşteri detayı (`GET /customers/:id`) — adres seçimi bunu kullanır. */
export async function getCustomerById(id: string): Promise<CustomerDetail> {
  const json = await apiRequest(`/customers/${encodeURIComponent(id)}`);
  return CustomerDetailResponseSchema.parse(json).data;
}

/**
 * Yeni müşteri (`POST /customers`) — ad + tek telefon.
 *
 * Gövde doğrulaması kasiyerinkiyle AYNI şemadan geçer (DoD 6): `fullName`
 * 2-120 karakter, en az 1 telefon zorunlu. Mobilde adres girişi YOKTUR
 * (S4=(a) / K12.4) → `addresses` gönderilmez.
 */
export async function createCustomer(input: {
  fullName: string;
  rawPhone: string;
}): Promise<CustomerDetail> {
  const json = await apiRequest('/customers', {
    method: 'POST',
    body: {
      fullName: input.fullName,
      phones: [{ rawPhone: input.rawPhone, isPrimary: true }],
    },
  });
  return CustomerDetailResponseSchema.parse(json).data;
}
