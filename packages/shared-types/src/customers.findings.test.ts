import { describe, it, expect } from 'vitest';
import { CustomerUpdateSchema } from './customers.js';

/**
 * QA — Blok 2 / Hat C — KASITLI KIRMIZI test.
 *
 * Bulgu: SD-T-C-02 [HIGH] [BUG] customers.ts — `CustomerUpdateSchema`
 * (PATCH /customers/:id sözleşmesi) gerçek backend rotasıyla UYUŞMUYOR.
 *
 * Kanıt:
 *   - `packages/shared-types/src/customers.ts:49` —
 *     `export const CustomerUpdateSchema = CustomerCreateSchema.partial();`
 *     → `fullName`, `notes`, `phones`, `addresses` dahil TÜM alanları
 *     opsiyonel olarak kabul eder (tip: `CustomerUpdate`).
 *   - `apps/web/src/features/customers/api/customers.ts:111` —
 *     `useUpdateCustomer()` hook'u `patch: CustomerUpdate` tipiyle PATCH
 *     body'sini tipler (yani `phones`/`addresses` göndermek TypeScript'e
 *     göre GEÇERLİ).
 *   - `apps/api/src/routes/customers/index.ts:106-114` — GERÇEK PATCH
 *     `/customers/:id` rotası shared-types'tan `CustomerUpdateSchema`'yı
 *     HİÇ import etmiyor; onun yerine yerel, DAR bir
 *     `CustomerPatchSchema = z.object({ fullName, notes }).refine(...)`
 *     kullanıyor — yalnız `fullName` + `notes` kabul eder.
 *
 * Senaryo: Bir geliştirici `useUpdateCustomer()` çağırırken TS tipine
 * güvenip `{ phones: [...] }` gönderirse: zod'un varsayılan "strip" modu
 * (`.strict()` yok) bilinmeyen alanları SESSİZCE atar değil — burada
 * durum tersi: backend'in KENDİ şeması `phones` alanını hiç tanımıyor,
 * dolayısıyla `fullName`/`notes` dışındaki her şey backend'e ulaşmadan
 * önce ya TS seviyesinde yanıltıcı onay alır ya da backend'de sessizce
 * strip edilip 200 OK döner — telefon/adres güncellenmemiş olur.
 * Kullanıcı "kaydedildi" sanır, veri DEĞİŞMEZ (sessiz veri kaybı).
 *
 * Etki: Müşteri telefon/adres güncelleme akışı — eğer biri bu genel
 * `CustomerUpdate` tipini phones/addresses için kullanırsa sessiz no-op.
 * Bu paket referans sözleşme (`@restoran-pos/shared-types`) olduğu için
 * yanlış zemin oluşturuyor.
 *
 * Öneri: `CustomerUpdateSchema`'yı gerçek PATCH rotasıyla eşleştir
 * (yalnız `fullName`+`notes`, `.pick()` ile) VEYA hiç export etme —
 * phones/addresses için ayrı dedicated schema'lar zaten var
 * (PhonePayloadSchema/AddressCreateSchema/AddressUpdateSchema, route-local).
 * Etiket: MVP-fix (yanıltıcı public sözleşme; sessiz veri kaybı riski).
 *
 * Bu test KASITLI KIRMIZI — doğru sözleşmeyi (yalnız fullName+notes)
 * assert eder; mevcut şema phones/addresses'i de kabul ettiği için
 * başarısız olur.
 */
describe('SD-T-C-02 customers.ts — CustomerUpdateSchema gerçek PATCH sözleşmesiyle eşleşmeli (KASITLI KIRMIZI)', () => {
  it('SD-T-C-02a CustomerUpdateSchema şemasında "phones" alanı OLMAMALI (gerçek route kabul etmiyor)', () => {
    expect(Object.keys(CustomerUpdateSchema.shape)).not.toContain('phones');
  });

  it('SD-T-C-02b CustomerUpdateSchema şemasında "addresses" alanı OLMAMALI (gerçek route kabul etmiyor)', () => {
    expect(Object.keys(CustomerUpdateSchema.shape)).not.toContain('addresses');
  });

  it('SD-T-C-02c yalnız phones içeren bir patch reddedilmeli (gerçek route\'ta anlamsız/no-op)', () => {
    const r = CustomerUpdateSchema.safeParse({
      phones: [{ rawPhone: '0555 111 22 33', isPrimary: true }],
    });
    // Beklenen (doğru) davranış: bu şema gerçek PATCH sözleşmesini yansıtsaydı
    // reddederdi (phones alanı tanımlı olmamalı). Mevcut şema kabul ediyor.
    expect(r.success).toBe(false);
  });
});
