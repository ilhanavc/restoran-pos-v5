import { describe, expect, it } from 'vitest';
import { maskAddress, maskCustomerName, maskPhoneForExport } from './pii-mask.js';
import { maskPhone as validationMaskPhone } from './validation.js';

/**
 * Blok 1 derin denetim (Hat C) — sınır-zorlama matrisi, KVKK-kritik.
 *
 * Amaç: `maskPhoneForExport`'un GERÇEKTEN maskelediğini kanıtlamak. Format
 * spec'i `.claude/memory/decisions.md:9575` — "Telefon (...): `5XX***1234`
 * (ilk 3 + son 4, ortası `***`)." — yani ORTADA gerçekten gizli hane OLMALI.
 *
 * 7 haneden kısa girdide dejenere ("hiç maskelememe") davranışı
 * `pii-mask.findings.test.ts` (SD-S-02, BLOCKER) içinde ayrı karakterize
 * edilir — burada yalnız ">=7 hane, gerçekten gizleyen" durumlar yeşil
 * beklenir.
 */
describe('maskPhoneForExport — format matrisi (uydurma test verisi)', () => {
  const cases: Array<[string, string]> = [
    ['+905321234567', '905***4567'],
    ['05321234567', '053***4567'],
    ['5321234567', '532***4567'], // 10 hane, baştaki 0 yok
    ['0090 532 123 45 67', '009***4567'], // uluslararası + boşluklu
    ['0532-123-45-67', '053***4567'], // tireli
    ['(0532) 123 45 67', '053***4567'], // parantezli
  ];

  it.each(cases)('girdi %s → %s (orta hane gizli)', (input, expected) => {
    expect(maskPhoneForExport(input)).toBe(expected);
  });

  it('uluslararası (Almanya +49) numara da baş3+son4 formatında maskelenir', () => {
    // '+49 151 23456789' → digits '4915123456789' (13 hane)
    expect(maskPhoneForExport('+49 151 23456789')).toBe('491***6789');
  });

  it('güvenli uzunlukta (>=10 hane) hiçbir çıktı ham numaranın TAM dijit dizisini içermez', () => {
    const rawNumbers = ['05321234567', '+905321234567', '2123456789', '0212 345 67 89'];
    for (const raw of rawNumbers) {
      const digits = raw.replace(/\D/g, '');
      const masked = maskPhoneForExport(raw);
      expect(masked).not.toBe(digits);
      expect(masked.includes(digits)).toBe(false);
    }
  });

  it('boş string → *** (sentinel)', () => {
    expect(maskPhoneForExport('')).toBe('***');
  });

  it('null → ***', () => {
    expect(maskPhoneForExport(null)).toBe('***');
  });

  it('undefined → ***', () => {
    expect(maskPhoneForExport(undefined)).toBe('***');
  });

  it('3 haneli kısa girdi (112 gibi) → *** (maskelemeye yetersiz, sentinel)', () => {
    expect(maskPhoneForExport('112')).toBe('***');
  });

  it('yalnız harf/alfanumerik (rakam yok) → ***', () => {
    expect(maskPhoneForExport('abc-def')).toBe('***');
  });

  it('alfanümerik karışık (harf+rakam) → yalnız rakamlar maskelenir', () => {
    expect(maskPhoneForExport('GSM:05321234567')).toBe('053***4567');
  });

  it('TC Kimlik-şekilli 11 hane (0 ile başlamayan) de aynı head3+tail4 kuralıyla maskelenir (NIT — fonksiyon telefon-farkında değil)', () => {
    // Bilinçli tasarım: fonksiyon herhangi 7+ haneli diziyi aynı kurala tabi
    // tutar (pii-mask.ts JSDoc). TC Kimlik'e özel ayrı bir mask fonksiyonu YOK.
    expect(maskPhoneForExport('12345678901')).toBe('123***8901');
  });
});

describe('maskCustomerName — ek sınır durumları', () => {
  it('tek harfli isim → aynen döner (mask yok, soyad bilinmiyor)', () => {
    expect(maskCustomerName('A')).toBe('A');
  });

  it('yalnız boşluklardan oluşan isim → trim sonrası boş string', () => {
    expect(maskCustomerName('   ')).toBe('');
  });

  it('sayı içeren "isim" çökmeden maskelenir (savunma — kirli veri)', () => {
    expect(maskCustomerName('Ahmet 2. Kaya')).toBe('Ahmet 2***');
  });
});

describe('maskAddress — ek sınır durumları', () => {
  it('"Mah." adresin en başında → tüm string döner (silinecek prefix yok)', () => {
    expect(maskAddress('Mah. Sokak No 5')).toBe('Mah. Sokak No 5');
  });

  it('yalnız virgül → mahalle yok → boş string', () => {
    expect(maskAddress(',')).toBe('');
  });

  it('kelime-sınırı guard: "Mahallesi" bir kelimeye kaynaşmışsa (Birmahallesi) eşleşmez → boş string', () => {
    // isWordBoundary(idx) longIdx'ten hemen önceki karakterin boşluk/virgül
    // olmasını ister; "Birmahallesi" içinde 'mahallesi' bulunur ama önceki
    // karakter 'r' → reddedilir. shortIdx ('mah.') de bu string'te YOK
    // (nokta yok). Sonuç: keywordIdx=-1 → boş string. Guard'ın DOĞRU
    // çalıştığını kanıtlayan pozitif test.
    expect(maskAddress('Birmahallesi Sk, Ankara')).toBe('');
  });
});

describe('DUPLIKE LOGIC kanıtı — validation.ts maskPhone vs pii-mask.ts maskPhoneForExport (SD-S bulgusu, bkz. rapor)', () => {
  it('aynı girdi için iki farklı maskeleme fonksiyonu FARKLI algoritma + farklı reveal oranı üretir', () => {
    const raw = '05321234567'; // 11 hane gerçekçi TR cep
    const viaPiiMask = maskPhoneForExport(raw); // head3+tail4, orta ***
    const viaValidation = validationMaskPhone(raw); // yalnız son4, **** sabit önek
    expect(viaPiiMask).toBe('053***4567'); // 7/11 hane açık (%64 reveal)
    expect(viaValidation).toBe('****4567'); // 4/11 hane açık (%36 reveal)
    expect(viaPiiMask).not.toBe(viaValidation);
    // İki fonksiyon da paketin barrel'ından export edilir (index.ts) — hangi
    // context'te hangisinin kullanılması gerektiğine dair KOD İÇİ bir kural
    // yok. Her ikisi de apps/ içinde 0 kullanım (dead code, bkz. rapor DEAD
    // tablosu) — bu çakışma bugün canlı zarar vermiyor ama entegre edilirse
    // yanlış (zayıf) olanın seçilmesi riski var.
  });
});
