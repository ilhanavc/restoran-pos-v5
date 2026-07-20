import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KITCHEN_STATION,
  isKitchenStation,
  KITCHEN_STATION_KINDS,
  PrintJobKindSchema,
} from './print-agent.js';

/**
 * ADR-032 Amendment 1 — istasyon yönlendirmesinin tip güvenliği.
 *
 * Buradaki asıl sözleşme `isKitchenStation`'ın **`'bill'`'i reddetmesi**dir;
 * gerisi onun etrafındaki koruma bandı.
 */

describe('PrintJobKindSchema', () => {
  it('üç iş türünü kabul eder (kitchen/bill geriye uyum + grill)', () => {
    for (const kind of ['kitchen', 'bill', 'grill']) {
      expect(PrintJobKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("bilinmeyen değeri reddeder — agent config typo boot'ta fail-fast olsun", () => {
    for (const kind of ['izgara', 'GRILL', 'kitchen2', '', 'oven']) {
      expect(PrintJobKindSchema.safeParse(kind).success).toBe(false);
    }
  });
});

describe('isKitchenStation — K5 tip güvenliği', () => {
  /**
   * EN KRİTİK TEST. `'bill'` `PrintJobKindSchema`'nın GEÇERLİ üyesidir; enqueue
   * doğrulamayı o şemaya karşı yapsaydı `print_station='bill'` yazım hatası
   * fallback'i tetiklemez ve **mutfak fişi kasa yazıcısından çıkardı** — v3'ün
   * tip-güvensiz yönlendirme hatasının birebir aynısı. Alt küme bunu yapısal
   * olarak imkânsız kılar.
   */
  it("'bill' bir mutfak istasyonu DEĞİLDİR (mutfak fişi kasadan çıkamaz)", () => {
    expect(PrintJobKindSchema.safeParse('bill').success).toBe(true); // enum'da geçerli
    expect(isKitchenStation('bill')).toBe(false); // ama istasyon DEĞİL
  });

  it('tanımlı mutfak istasyonlarını kabul eder', () => {
    for (const station of KITCHEN_STATION_KINDS) {
      expect(isKitchenStation(station)).toBe(true);
    }
  });

  it('atanmamış/bozuk/tip-dışı değerleri reddeder (fallback tetiklenir)', () => {
    const bogus: unknown[] = [
      null,
      undefined,
      '',
      'KITCHEN', // büyük harf — DB'de böyle yazılırsa tabana düşmeli
      'Grill',
      'izgara', // Türkçe slug DEĞİL; kod-içi İngilizce (CLAUDE.md)
      'firin',
      42,
      {},
      [],
      ['grill'],
    ];
    for (const value of bogus) {
      expect(isKitchenStation(value)).toBe(false);
    }
  });

  it('taban istasyon geçerli bir mutfak istasyonudur', () => {
    expect(isKitchenStation(DEFAULT_KITCHEN_STATION)).toBe(true);
    expect(DEFAULT_KITCHEN_STATION).toBe('kitchen');
  });

  it('her mutfak istasyonu aynı zamanda geçerli bir iş türüdür', () => {
    // Alt küme gerçekten alt küme olmalı; ayrışırsa claim filtresi 400 döner.
    for (const station of KITCHEN_STATION_KINDS) {
      expect(PrintJobKindSchema.safeParse(station).success).toBe(true);
    }
  });
});
