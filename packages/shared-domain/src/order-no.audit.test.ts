// Blok 1 derin denetim — HAT A (para çekirdeği). Sınır-zorlama testleri.
// Bu dosya YEŞİL kalmalı. order-no.ts'de BLOCKER/HIGH bulgu YOK — findings dosyası açılmadı.
// Rapor: C:\Users\ilhan\AppData\Local\Temp\claude\D--restoran-pos-v5\87e5dd93-086e-432a-9251-14ddd7376f7b\scratchpad\qa-A-money-report.md
//
// NOT (kapsam sınırı): bu dosya yalnız format/parse saf fonksiyonlarını içerir.
// Sipariş numarası ÜRETİMİ (sequence/gün-sınırı/çakışma önleme) burada YOK —
// bkz. rapor "kapsam dışı" notu.
import { describe, expect, it } from 'vitest';
import { formatOrderNo, parseOrderNo } from './order-no.js';

let seed = 2024;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function rndInt(min: number, max: number): number {
  return Math.floor(min + rnd() * (max - min + 1));
}

describe('order-no.ts — sınır-zorlama & property audit', () => {
  describe('formatOrderNo / parseOrderNo — round-trip', () => {
    it('gerçekçi aralıkta (1..999999, günlük birkaç yüz sipariş × yıllarca) round-trip korunur (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const n = rndInt(1, 999_999);
        expect(parseOrderNo(formatOrderNo(n))).toBe(n);
      }
    });

    it('MAX_SAFE_INTEGER sınırında hâlâ round-trip korunur (String() henüz exponential\'a geçmemiş)', () => {
      const n = Number.MAX_SAFE_INTEGER;
      expect(parseOrderNo(formatOrderNo(n))).toBe(n);
    });

    it('[SD-M-13 LOW/NIT] belgeler: no >= 1e21 için formatOrderNo throw etmez ama garbled çıktı üretir (pratikte erişilemez)', () => {
      // Number.isInteger(1e21) === true (float'ın kesir kısmı yok) ama
      // String(1e21) === "1e+21" (exponential gösterim) — guard bunu
      // yakalamıyor. Bir restoranın 10^21 sipariş üretmesi evrenin yaşından
      // uzun sürer; doğru davranış olarak assert EDİLMİYOR, sadece belgeleniyor.
      const result = formatOrderNo(1e21);
      expect(result).toBe('#1e+21');
      expect(() => parseOrderNo(result)).toThrow(TypeError); // en azından geri-parse güvenle reddediyor
    });
  });

  describe('formatOrderNo — throw uçları (temiz: hepsi guard\'lı)', () => {
    it('0, negatif, float, NaN, Infinity, -0 hepsi throw eder (sessiz yanlış YOK)', () => {
      expect(() => formatOrderNo(0)).toThrow(RangeError);
      expect(() => formatOrderNo(-1)).toThrow(RangeError);
      expect(() => formatOrderNo(1.5)).toThrow(RangeError);
      expect(() => formatOrderNo(NaN)).toThrow(RangeError);
      expect(() => formatOrderNo(Infinity)).toThrow(RangeError);
      expect(() => formatOrderNo(-0)).toThrow(RangeError);
    });
  });

  describe('parseOrderNo — kötü niyetli/malformed girdi (temiz: hepsi throw)', () => {
    it('eksi işaretli, ondalıklı, boşluklu veya harfli gövde reddedilir', () => {
      expect(() => parseOrderNo('#-1')).toThrow(TypeError);
      expect(() => parseOrderNo('#1.5')).toThrow(TypeError);
      expect(() => parseOrderNo('# 42')).toThrow(TypeError);
      expect(() => parseOrderNo('#42a')).toThrow(TypeError);
      expect(() => parseOrderNo('#0000')).toThrow(RangeError);
    });
  });
});
