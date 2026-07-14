// Blok 1 derin denetim — HAT A (para çekirdeği). Sınır-zorlama testleri.
// Bu dosya YEŞİL kalmalı. tax.ts'de BLOCKER/HIGH bulgu YOK — findings dosyası açılmadı.
// Rapor: C:\Users\ilhan\AppData\Local\Temp\claude\D--restoran-pos-v5\87e5dd93-086e-432a-9251-14ddd7376f7b\scratchpad\qa-A-money-report.md
import { describe, expect, it } from 'vitest';
import type { MoneyCents } from '@restoran-pos/shared-types';
import { calculateVat, calculateVatInclusive } from './tax.js';

const c = (n: number): MoneyCents => n as MoneyCents;

let seed = 1337;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function rndInt(min: number, max: number): number {
  return Math.floor(min + rnd() * (max - min + 1));
}

describe('tax.ts — sınır-zorlama & property audit', () => {
  describe('calculateVat — Türkiye oranları uçları', () => {
    it('%0 oranında her zaman 0 döner', () => {
      expect(calculateVat(c(999_999), 0)).toBe(0);
    });

    it('%100 oranında (10000 bps) vergi = matrah', () => {
      expect(calculateVat(c(12_345), 10_000)).toBe(12_345);
    });

    it('1 kuruşluk tabanda %10/%20 için 0\'a yuvarlanır (kayıp değil, kasıtlı yuvarlama)', () => {
      expect(calculateVat(c(1), 1000)).toBe(0);
      expect(calculateVat(c(1), 2000)).toBe(0);
    });

    it('çok ondalıklı oranlarda (8.5 → 850 bps, 18.03 → 1803 bps) doğru yuvarlar', () => {
      // 1000 kuruş * 850 / 10000 = 85 (tam bölünüyor, float sızıntısı yok)
      expect(calculateVat(c(1000), 850)).toBe(85);
      // 1000 kuruş * 1803 / 10000 = 180.3 -> 180
      expect(calculateVat(c(1000), 1803)).toBe(180);
    });

    it('rastgele matrah × oran için 0 <= vergi <= matrah invaryantı korunur (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const subtotal = rndInt(0, 10_000_000);
        const rateBps = rndInt(0, 10_000); // %0..%100
        const vat = calculateVat(c(subtotal), rateBps);
        expect(vat).toBeGreaterThanOrEqual(0);
        expect(vat).toBeLessThanOrEqual(subtotal);
      }
    });
  });

  describe('calculateVatInclusive — dahil fiyattan geri hesaplama', () => {
    it('%0 oranında her zaman 0 döner', () => {
      expect(calculateVatInclusive(c(10_000), 0)).toBe(0);
    });

    it('%100 oranında (gross = 2x net) vergi = net = gross/2', () => {
      expect(calculateVatInclusive(c(2000), 10_000)).toBe(1000);
    });

    it('rastgele gross × oran için 0 <= vergi <= gross invaryantı korunur (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const gross = rndInt(0, 10_000_000);
        const rateBps = rndInt(0, 10_000);
        const vat = calculateVatInclusive(c(gross), rateBps);
        expect(vat).toBeGreaterThanOrEqual(0);
        expect(vat).toBeLessThanOrEqual(gross);
      }
    });

    it('ileri (calculateVat) → geri (calculateVatInclusive) yuvarlama round-trip tutarlıdır (500 iterasyon, temiz)', () => {
      // net -> vat -> gross -> geri-çıkarılan vat aynı kalmalı (tek taraflı
      // yuvarlama hatası aranıyor). 500 rastgele net/oran çiftinde 0 uyuşmazlık.
      for (let i = 0; i < 500; i++) {
        const net = rndInt(0, 5_000_000);
        const rateBps = rndInt(1, 10_000); // 0 hariç (aşağıda ayrı test var)
        const vatFromNet = calculateVat(c(net), rateBps);
        const gross = net + vatFromNet;
        const vatFromGross = calculateVatInclusive(c(gross), rateBps);
        expect(vatFromGross).toBe(vatFromNet);
      }
    });
  });

  describe('[SD-M-09 MEDIUM, ADR-gerekli] satır-bazlı vs toplam-bazlı KDV farkı — belgeleme (bkz. rapor)', () => {
    it('N satırın ayrı ayrı KDV\'si toplamı, birleşik toplamın KDV\'sine EŞİT OLMAK ZORUNDA DEĞİL (mevcut API bunu garanti etmiyor)', () => {
      // Doğru/yanlış iddiası yok — hangi politikanın (satır-bazlı mı toplam-
      // bazlı mı) kanonik olduğu henüz bir ADR ile karara bağlanmadı (tax.ts
      // şu an hiçbir üretim çağrısı almıyor, bkz. rapor "KDV v5.1" notu).
      const rate = 1000; // %10
      const perLineSum = calculateVat(c(333), rate) * 3;
      const combined = calculateVat(c(999), rate);
      expect(perLineSum).toBe(99);
      expect(combined).toBe(100);
      expect(perLineSum).not.toBe(combined); // 1 kuruşluk sapım — kanıt
    });
  });
});
