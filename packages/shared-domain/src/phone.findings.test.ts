// Blok 1 audit findings — intentionally RED until bugs fixed. See docs/audit/01-shared-domain.md
import { describe, expect, it } from 'vitest';
import { normalizePhoneTr } from './phone.js';

/**
 * [SD-S-05] HIGH — `digits.replace(/\D/g, '')` yalnız ASCII `[0-9]` tanır
 * (JS `\d`/`\D` `u`/`v` bayrağı olsa da Unicode-farkında DEĞİLDİR, yalnız
 * `\p{Nd}` bunu yapar). Arapça/Farsça/tam-genişlik rakamlar `\D`'ye
 * (rakam-DEĞİL sınıfına) düşer ve SESSİZCE silinir — dönüştürülmez,
 * reddedilmez. Sonuç: girdi ile hiçbir ilgisi olmayan, KISALTILMIŞ ve
 * YANLIŞ bir numara üretilir; ne hata ne uyarı verilir.
 */
describe('[SD-S-05] normalizePhoneTr Unicode rakamları dönüştürmez, sessizce siler → bozuk numara', () => {
  it('Arapça-Hint rakamları (٠٥٣٢...) ASCII eşdeğeriyle AYNI 11 haneye normalize olmalı', () => {
    const arabicIndicPrefix = '٠٥٣٢'; // "٠٥٣٢"
    const input = arabicIndicPrefix + '1234567';
    expect(normalizePhoneTr(input)).toBe('05321234567');
  });

  it('Farsça rakamları (۰۵۳۲...) ASCII eşdeğeriyle AYNI 11 haneye normalize olmalı', () => {
    const persianPrefix = '۰۵۳۲'; // "۰۵۳۲"
    const input = persianPrefix + '1234567';
    expect(normalizePhoneTr(input)).toBe('05321234567');
  });

  it('tam-genişlik rakamları (０５３２...) ASCII eşdeğeriyle AYNI 11 haneye normalize olmalı', () => {
    const fullwidthPrefix = '０５３２'; // "０５３２"
    const input = fullwidthPrefix + '1234567';
    expect(normalizePhoneTr(input)).toBe('05321234567');
  });
});

/**
 * [SD-S-06] HIGH — 12+ haneli, `'90'` ile başlayan girdilerde
 * `digits.slice(2, 12)` her zaman TAM 10 karakter döner (girdi ne kadar uzun
 * olursa olsun) ve `stripped.length === 10` koşulu bu yüzden HER ZAMAN true
 * olur. Yalnız 3. hanenin (`digits[2]`) `'5'` olması yeterli — geri kalan
 * onlarca/yüzlerce haneye hiç bakılmaz, sessizce atılır. `customer_phones.
 * normalized_phone` UNIQUE indeksi bu fonksiyonun çıktısı üzerinden
 * çalıştığından (phone.ts JSDoc), bozuk/aşırı-uzun bir girdi rastgele
 * "geçerli görünen" bir numarayla ÇAKIŞABİLİR (yanlış müşteri eşleşmesi).
 */
describe('[SD-S-06] normalizePhoneTr: uzun "905…" girdisi rastgele 11 haneli sahte-geçerli numaraya sessizce küçülür', () => {
  it('60 karakterlik anlamsız girdi (905 + 57×"9") 11 haneli bir numaraya çökmemeli', () => {
    const garbage = '905' + '9'.repeat(57); // 60 karakter, gerçek bir telefonla ilgisi yok
    const result = normalizePhoneTr(garbage);
    expect(result.length).not.toBe(11);
  });

  it('40 haneli girdi ile 60 haneli girdi (ikisi de "905"+tekrar rakam) AYNI sahte numarayı üretmemeli — veri kaybı kanıtı', () => {
    // Doğru davranış: farklı-uzunluktaki farklı girdiler farklı ele
    // alınmalı (reddedilmeli / bozulmamalı) — ikisinin de AYNI 11 haneye
    // "normalize" olması, aradaki bilginin sessizce atıldığının kanıtı.
    const garbage40 = '905' + '9'.repeat(37); // 40 karakter
    const garbage60 = '905' + '9'.repeat(57); // 60 karakter
    const result40 = normalizePhoneTr(garbage40);
    const result60 = normalizePhoneTr(garbage60);
    expect(result40).not.toBe(result60);
  });
});
