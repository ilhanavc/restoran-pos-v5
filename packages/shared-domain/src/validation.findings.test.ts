// Blok 1 audit findings — intentionally RED until bugs fixed. See docs/audit/01-shared-domain.md
import { describe, expect, it } from 'vitest';
import { isValidNormalizedPhone, maskPhone } from './validation.js';
import { normalizePhoneTr } from './phone.js';

/**
 * [SD-S-03] BLOCKER — `maskPhone`'un TEK amacı "v3 domain rule: store last 4
 * digits only (KVKK orantılılık ilkesi)" (validation.ts dosya içi yorum,
 * satır 13). `length < 4` durumunda throw eder ama `length === 4` durumunda
 * (throw eşiğinin TAM sınırı) `****${slice(-4)}` orijinal 4 karakterin
 * TAMAMINI döner — `****` öneki "maskelendi" izlenimi verse de gizlenen
 * hane SIFIRDIR. 4-6 karakterlik her girdi için de (throw etmeyen ama
 * `head` payı olmayan aralık) aynı risk artan oranda geçerli.
 */
describe('[SD-S-03] maskPhone: throw-eşiğinin (4 karakter) tam sınırında sıfır hane gizlenir', () => {
  it('4 karakterlik girdide maskelenmiş çıktı orijinal 4 haneyi TAMAMEN içermemeli', () => {
    const raw = '1234';
    const masked = maskPhone(raw);
    // "store last 4 digits only" kontratı: geri kalanı GİZLİ olmalı. 4
    // karakterlik girdide "geri kalan" zaten yok — bu da fonksiyonun bu
    // uzunluk aralığında amacına hizmet ETMEDİĞİNİ kanıtlıyor.
    expect(masked).not.toContain(raw);
  });
});

/**
 * [SD-S-04] HIGH — `isValidNormalizedPhone` (`/^\+?[0-9]{10,15}$/`, 10-15
 * hane) ile `normalizePhoneTr` (phone.ts) arasında sözleşme çelişkisi.
 * phone.ts'nin KENDİ test dosyası (phone.test.ts satır 29-31: "sabit hat (7
 * hane) — rakamlar aynen") 7 haneli "sabit hat" çıktısını GEÇERLİ bir
 * normalize sonucu sayar. `isValidNormalizedPhone` bu ÇIKTIYI reddeder (7 <
 * 10). İki fonksiyon `NormalizedPhone` adını paylaşır ama "geçerli
 * normalize edilmiş telefon" tanımında ANLAŞMAZLAR — bu satır sırayla
 * çağrılırsa (normalize → validate, en olası kullanım kalıbı) sabit hat
 * numaraları HER ZAMAN "geçersiz" olarak reddedilir.
 */
describe('[SD-S-04] isValidNormalizedPhone, normalizePhoneTr\'nin kendi belgelediği "sabit hat" çıktısını reddeder', () => {
  it('normalizePhoneTr\'nin 7 haneli sabit-hat çıktısı isValidNormalizedPhone tarafından geçerli sayılmalı', () => {
    const normalized = normalizePhoneTr('5288300');
    expect(normalized).toBe('5288300'); // phone.test.ts ile aynı davranış (regresyon değil)
    expect(isValidNormalizedPhone(normalized)).toBe(true);
  });
});
