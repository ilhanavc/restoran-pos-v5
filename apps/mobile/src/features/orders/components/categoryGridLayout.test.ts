import { describe, expect, it } from 'vitest';

import { computeAndroidTileLayout } from './categoryGridLayout';

/**
 * Android kategori ızgarası kalibrasyon testleri (S148).
 *
 * Bu dosya bir bug'ın üzerine yazıldı: 4 sütunlu kalibrasyonda hesaplanan font,
 * test edilen TÜM telefon genişliklerinde `MIN_FONT`'a (6px) çakılıyordu —
 * iOS'un 15px'inin %40'ı. Hiçbir test aritmetiği kontrol etmediği için iki ay
 * görünmedi (garsonun cihazı eski bir APK'da donmuştu, bkz. S146).
 *
 * Eşikler bilinçli olarak mutlak değerlerle yazıldı: sabitler yeniden kalibre
 * edilirse bu dosya kırmızı verir ve kalibrasyon kararı yeniden gözden geçirilir.
 */

// Yaygın Android telefon genişlikleri (dp).
const PHONE_WIDTHS = [360, 384, 392, 412, 428, 480];

// `docs/hci/pos-checklist.md` satır 113 — minimum font eşiği.
const HCI_MIN_FONT_PT = 14;

// Font kurgusunun dayandığı ölçüler — modülün sabitlerinin aynası.
const WIDEST_WORD_CHARS = 9;
const CHAR_WIDTH_FACTOR = 1.35;
const TILE_H_PADDING = 4;

describe('computeAndroidTileLayout — telefon', () => {
  it('her telefon genişliğinde 2 sütun verir', () => {
    for (const width of PHONE_WIDTHS) {
      expect(computeAndroidTileLayout(width).numColumns, `${width}dp`).toBe(2);
    }
  });

  it('font hiçbir telefon genişliğinde MIN_FONT tabanına çakılmaz', () => {
    // Regresyon kapısı: 4 sütunlu kalibrasyonda bu değer her genişlikte 6'ydı.
    for (const width of PHONE_WIDTHS) {
      expect(computeAndroidTileLayout(width).fontSize, `${width}dp`).toBeGreaterThan(6);
    }
  });

  it('412dp ve üstünde HCI 14pt eşiğini karşılar', () => {
    // Sahadaki cihaz bu aralıkta. 360-392dp'de 12-13px kalır — eşiğin biraz
    // altı, ama 4 sütundaki 6px'in iki katından fazlası. Küçük telefon
    // kullanıma girerse eşik yeniden ele alınmalı (ızgara yüksekliği / ad boyu).
    for (const width of [412, 428, 480]) {
      expect(computeAndroidTileLayout(width).fontSize, `${width}dp`).toBeGreaterThanOrEqual(
        HCI_MIN_FONT_PT,
      );
    }
  });

  it('bilinen genişliklerde beklenen font boyunu verir', () => {
    expect(computeAndroidTileLayout(360).fontSize).toBe(12);
    expect(computeAndroidTileLayout(392).fontSize).toBe(13);
    expect(computeAndroidTileLayout(412).fontSize).toBe(14);
    expect(computeAndroidTileLayout(480).fontSize).toBe(15);
  });

  it('en uzun tek kelime döşemeye tek satırda sığar', () => {
    // Kurgunun asıl amacı: "SALATALAR" (9 harf) kelime ortasından kırılmamalı.
    for (const width of PHONE_WIDTHS) {
      const { tileWidth, fontSize } = computeAndroidTileLayout(width);
      const needed = WIDEST_WORD_CHARS * CHAR_WIDTH_FACTOR * fontSize;
      const room = tileWidth - TILE_H_PADDING * 2;
      expect(needed, `${width}dp`).toBeLessThanOrEqual(room);
    }
  });
});

describe('computeAndroidTileLayout — geniş ekran', () => {
  it('tablette sütun sayısı asgari 2 sütunun üstüne çıkar', () => {
    expect(computeAndroidTileLayout(800).numColumns).toBeGreaterThan(2);
    expect(computeAndroidTileLayout(1024).numColumns).toBeGreaterThan(
      computeAndroidTileLayout(800).numColumns,
    );
  });

  it('sütun eklendiğinde font tavanda kalır (eşiğin amacı)', () => {
    // TARGET_TILE_WIDTH, MAX_FONT'un elde edilebildiği genişlik olarak
    // türetildi; o yüzden sütun eklemek okunurluğu düşürmemeli.
    for (const width of [800, 1024, 1280]) {
      expect(computeAndroidTileLayout(width).fontSize, `${width}dp`).toBe(15);
    }
  });

  it('sütun sayısı genişlikle azalmaz (monotonluk)', () => {
    let previous = 0;
    for (const width of [360, 412, 480, 600, 800, 1024]) {
      const { numColumns } = computeAndroidTileLayout(width);
      expect(numColumns, `${width}dp`).toBeGreaterThanOrEqual(previous);
      previous = numColumns;
    }
  });
});

describe('computeAndroidTileLayout — köşe durumları', () => {
  it('çok dar ekranda bile asgari sütun sayısının altına inmez', () => {
    expect(computeAndroidTileLayout(240).numColumns).toBe(2);
  });

  it('font hiçbir genişlikte MIN_FONT altına inmez', () => {
    for (const width of [120, 200, 240, 320, ...PHONE_WIDTHS, 1024]) {
      expect(computeAndroidTileLayout(width).fontSize, `${width}dp`).toBeGreaterThanOrEqual(6);
    }
  });

  it('taban gerçekten bağlayıcı olduğu genişlikte MIN_FONT verir', () => {
    // 2 sütunda döşemeler geniş olduğu için taban ancak ~226dp altında bağlar;
    // 240dp'de font 7'ye çıkar. Tabanın yaşadığını kanıtlayan genişlik bu.
    expect(computeAndroidTileLayout(200).fontSize).toBe(6);
  });

  it('font hiçbir genişlikte MAX_FONT üstüne çıkmaz', () => {
    expect(computeAndroidTileLayout(4000).fontSize).toBeLessThanOrEqual(15);
  });
});

/**
 * `fontScale` ekseni (#771) — kullanıcının sistem yazı boyutu ayarı.
 *
 * RN varsayılanı `allowFontScaling={true}`, yani ekrandaki boy
 * `fontSize * fontScale`. Hesap çarpanı bilmezse 9 harfli kelime döşemeye
 * sığmaz ve S105'in asıl bug'ı (kelime ortasından kırılma) geri döner.
 *
 * Buradaki iddiaların ÇOĞU taban `fontSize`'ı değil **ekranda görünen boyu**
 * ölçer: korunması gereken değişmez o.
 */
describe('computeAndroidTileLayout — fontScale', () => {
  // Android'in yazı boyutu ayarındaki tipik çarpanlar.
  const SCALES = [0.85, 1, 1.15, 1.3, 1.5, 2];

  it('varsayılan çarpan 1 — parametresiz çağrı davranışı DEĞİŞMEZ', () => {
    // Geriye uyumluluk: #771 öncesi tüm çağrılar tek argümanlıydı.
    for (const w of PHONE_WIDTHS) {
      expect(computeAndroidTileLayout(w, 1)).toEqual(computeAndroidTileLayout(w));
    }
  });

  it('en uzun tek kelime HER çarpanda döşemeye sığar (asıl güvence)', () => {
    for (const w of PHONE_WIDTHS) {
      for (const scale of SCALES) {
        const { tileWidth, fontSize } = computeAndroidTileLayout(w, scale);
        // Ekranda kapladığı gerçek genişlik — taban değil, çarpanlı boy.
        const renderedWordWidth =
          fontSize * scale * WIDEST_WORD_CHARS * CHAR_WIDTH_FACTOR;
        const textRoom = tileWidth - TILE_H_PADDING * 2;
        expect(
          renderedWordWidth,
          `${w}dp @ ${scale}x: kelime döşemeye sığmıyor`,
        ).toBeLessThanOrEqual(textRoom);
      }
    }
  });

  it('çarpan büyüdükçe TABAN font küçülür (bütçe bölünüyor)', () => {
    // Mekanizmanın kendisi: 412dp'de 1x → 14, 2x → ~7.
    const base = computeAndroidTileLayout(412, 1).fontSize;
    const scaled = computeAndroidTileLayout(412, 2).fontSize;
    expect(scaled).toBeLessThan(base);
  });

  it('ekrandaki boy çarpandan BAĞIMSIZ — çarpansız tabana eşit kalır', () => {
    // Takasın tanımı bu. İlk uygulama tabanı tam sayıya yuvarlıyordu ve
    // ekrandaki boy hedefin ALTINA kayıyordu (ölçüldü: 1.5x → 13.5px,
    // 2.2x → 13.2px) — yani 1.5x ayarlı kullanıcı varsayılan ayarlıdan DAHA
    // KÜÇÜK yazı görüyordu, ters yönde bir hata. Kesirli taban bunu kapattı.
    // Üst sınır 2.0 — Android sistem ayarının sunduğu en büyük çarpan.
    // Ötesi için aşağıdaki "taban bağlıyor" testine bak.
    for (const w of PHONE_WIDTHS) {
      const target = computeAndroidTileLayout(w, 1).fontSize;
      for (const scale of [1.15, 1.3, 1.5, 1.7, 2]) {
        const { fontSize } = computeAndroidTileLayout(w, scale);
        expect(
          fontSize * scale,
          `${w}dp @ ${scale}x: ekrandaki boy çarpansız tabandan saptı`,
        ).toBeCloseTo(target, 5);
      }
    }
  });

  it('🔴 BİLİNEN SINIR: 2.0 üstünde dar telefonda taban bağlar, taşma geri gelir', () => {
    // Bu test bir GARANTİYİ değil, garantinin NEREDE bittiğini çiviliyor.
    //
    // 360dp'de çarpansız taban 12px; 2.0'da 12/2 = 6 = MIN_FONT, yani
    // garanti tam kenarda tutuyor. 2.2'de 12/2.2 = 5.45 tabanın altına
    // düşüyor, taban 6'da kilitleniyor ve ekrandaki boy 13.2'ye ÇIKIYOR —
    // yani kelime döşemeye sığmıyor.
    //
    // Android sistem ayarı 2.0'da bittiği için saha riski yok sayılabilir,
    // ama bazı OEM'ler daha ileri gidebiliyor. Gerçek çözüm tek sütuna
    // düşmek; ayrı karar (#770 ile birlikte değerlendirilmeli).
    const target = computeAndroidTileLayout(360, 1).fontSize;
    expect(computeAndroidTileLayout(360, 2).fontSize * 2).toBeCloseTo(target, 5);
    expect(computeAndroidTileLayout(360, 2.2).fontSize * 2.2).toBeGreaterThan(target);
  });

  it('412dp ve üstünde HCI eşiği HER çarpanda korunur', () => {
    // Çarpansız hâl zaten 14pt'yi karşılıyor; boy çarpandan bağımsız
    // olduğu için eşik artık büyük ayarlarda da geçerli.
    for (const w of [412, 428, 480]) {
      for (const scale of [1, 1.15, 1.3, 1.5, 1.7, 2, 2.2]) {
        const { fontSize } = computeAndroidTileLayout(w, scale);
        expect(
          fontSize * scale,
          `${w}dp @ ${scale}x: 14pt eşiğinin altına düştü`,
        ).toBeGreaterThanOrEqual(HCI_MIN_FONT_PT);
      }
    }
  });

  it('çarpan 1 ALTINDA telafi YAPILMAZ (kullanıcı küçük yazı istedi)', () => {
    // Simetrik davranmak yanlış olurdu: 0.85x diyen kullanıcıya tabanı
    // büyüterek "yine de 14px göreceksin" demek tercihini ters yönden bozar.
    const base = computeAndroidTileLayout(412, 1).fontSize;
    expect(computeAndroidTileLayout(412, 0.85).fontSize).toBe(base);
    expect(computeAndroidTileLayout(412, 0.85).fontSize * 0.85).toBeLessThan(base);
  });

  it('küçük çarpanda taban MAX_FONT tavanını AŞMAZ', () => {
    // 0.85x'te bütçe genişler ama taban yine 15'te kapanır.
    expect(computeAndroidTileLayout(412, 0.85).fontSize).toBeLessThanOrEqual(15);
    expect(computeAndroidTileLayout(4000, 0.5).fontSize).toBeLessThanOrEqual(15);
  });

  it('sütun sayısı ve döşeme genişliği çarpandan ETKİLENMEZ', () => {
    // `fontScale` yalnız fontu ilgilendirir; ızgara geometrisi genişlikten
    // türer. Karışırsa ızgara yazı ayarıyla birlikte zıplardı.
    for (const scale of SCALES) {
      const a = computeAndroidTileLayout(412, 1);
      const b = computeAndroidTileLayout(412, scale);
      expect(b.numColumns).toBe(a.numColumns);
      expect(b.tileWidth).toBe(a.tileWidth);
    }
  });

  it('bozuk çarpan (0, negatif, NaN) 1 gibi davranır — bütçe patlamaz', () => {
    const expected = computeAndroidTileLayout(412, 1);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeAndroidTileLayout(412, bad), `çarpan ${bad}`).toEqual(expected);
    }
  });

  it('aşırı çarpanda taban MIN_FONT altına inmez (taşma kayıt altında)', () => {
    // ≳2.4'te taban bağlar ve kelime taşabilir — modül bunu dürüstçe
    // belgeliyor; doğru çözüm tek sütuna düşmek, o ayrı bir karar.
    expect(computeAndroidTileLayout(360, 5).fontSize).toBe(6);
  });
});
