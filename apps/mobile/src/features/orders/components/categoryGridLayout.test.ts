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
