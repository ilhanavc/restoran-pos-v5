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

// Font kurgusunun dayandığı ölçüler — modülün sabitlerinin aynası.
const WIDEST_WORD_CHARS = 9;
const CHAR_WIDTH_FACTOR = 1.35;
const TILE_H_PADDING = 4;

describe('computeAndroidTileLayout — telefon', () => {
  it('her telefon genişliğinde 3 sütun verir', () => {
    for (const width of PHONE_WIDTHS) {
      expect(computeAndroidTileLayout(width).numColumns, `${width}dp`).toBe(3);
    }
  });

  it('font hiçbir telefon genişliğinde MIN_FONT tabanına çakılmaz', () => {
    // Regresyon kapısı: 4 sütunlu kalibrasyonda bu değer her genişlikte 6'ydı.
    for (const width of PHONE_WIDTHS) {
      expect(computeAndroidTileLayout(width).fontSize, `${width}dp`).toBeGreaterThan(6);
    }
  });

  it('bilinen genişliklerde beklenen font boyunu verir', () => {
    expect(computeAndroidTileLayout(360).fontSize).toBe(7);
    expect(computeAndroidTileLayout(392).fontSize).toBe(8);
    expect(computeAndroidTileLayout(412).fontSize).toBe(9);
    expect(computeAndroidTileLayout(480).fontSize).toBe(11);
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
  it('tablette sütun sayısı 3 sütunun üstüne çıkar', () => {
    expect(computeAndroidTileLayout(600).numColumns).toBeGreaterThan(3);
    expect(computeAndroidTileLayout(800).numColumns).toBeGreaterThan(
      computeAndroidTileLayout(600).numColumns,
    );
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
    expect(computeAndroidTileLayout(240).numColumns).toBe(3);
  });

  it('çok dar ekranda font MIN_FONT tabanında durur, altına inmez', () => {
    expect(computeAndroidTileLayout(240).fontSize).toBe(6);
  });

  it('font hiçbir genişlikte MAX_FONT üstüne çıkmaz', () => {
    expect(computeAndroidTileLayout(4000).fontSize).toBeLessThanOrEqual(15);
  });
});
