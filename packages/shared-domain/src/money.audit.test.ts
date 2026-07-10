// Blok 1 derin denetim — HAT A (para çekirdeği). Sınır-zorlama testleri.
// Bu dosya YEŞİL kalmalı: yalnız gerçekten doğru/savunulabilir davranışı assert eder.
// BLOCKER/HIGH bulgular money.findings.test.ts'e taşındı (KIRMIZI, kasıtlı).
// Rapor: C:\Users\ilhan\AppData\Local\Temp\claude\D--restoran-pos-v5\87e5dd93-086e-432a-9251-14ddd7376f7b\scratchpad\qa-A-money-report.md
import { describe, expect, it } from 'vitest';
import type { MoneyCents } from '@restoran-pos/shared-types';
import { addMoney, formatMoney, multiplyMoney, parseMoney, subtractMoney } from './money.js';

const c = (n: number): MoneyCents => n as MoneyCents;

// Seeded LCG PRNG — deterministic, no new dependency.
let seed = 42;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function rndInt(min: number, max: number): number {
  return Math.floor(min + rnd() * (max - min + 1));
}

describe('money.ts — sınır-zorlama & property audit', () => {
  describe('addMoney — MAX_SAFE_INTEGER civarı', () => {
    it('gerçekçi restoran büyüklüklerinde tam sonuç verir (10^12 kuruş = 10 milyar TL)', () => {
      // Tek-tenant restoranın ömür boyu cirosunun kat kat üzerinde; yine de
      // Number.MAX_SAFE_INTEGER'a (~9.007e15) kıyasla çok küçük.
      const big = 1_000_000_000_000;
      expect(addMoney(c(big), c(1))).toBe(big + 1);
    });

    it('[SD-M-11 LOW/NIT] belgeler: MAX_SAFE_INTEGER ötesinde taşma sessizdir, guard yok (pratikte erişilemez)', () => {
      // Doğru davranış olarak assert EDİLMİYOR — mevcut (korumasız) davranış
      // belgeleniyor. Gerçek bir restoranın kuruş cinsinden cirosu bu sınıra
      // asla yaklaşmaz (9 katrilyon kuruş = 90 trilyon TL).
      const max = Number.MAX_SAFE_INTEGER;
      const plusOne = addMoney(c(max), c(1));
      const plusTwo = addMoney(c(max), c(2));
      // 2^53+1 ve 2^53+2 aynı float'a yuvarlanır → sessizce ayırt edilemez.
      expect(plusTwo).toBe(plusOne);
    });

    it('rastgele gerçekçi değerlerde değişme (commutative) ve birleşme (associative) korunur (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const a = rndInt(0, 10_000_000);
        const b = rndInt(0, 10_000_000);
        const cc = rndInt(0, 10_000_000);
        expect(addMoney(c(a), c(b))).toBe(addMoney(c(b), c(a)));
        expect(addMoney(addMoney(c(a), c(b)), c(cc))).toBe(addMoney(c(a), addMoney(c(b), c(cc))));
      }
    });
  });

  describe('subtractMoney — -0 normalizasyonu', () => {
    it('a - a hiçbir zaman IEEE754 negatif-sıfır üretmez (temiz)', () => {
      for (const v of [0, 1, 100, 999_999, 1_000_000_000]) {
        const result = subtractMoney(c(v), c(v));
        expect(Object.is(result, -0)).toBe(false);
        expect(result).toBe(0);
      }
    });

    it('rastgele a >= b için sonuç her zaman a-b ve negatif değildir (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const b = rndInt(0, 5_000_000);
        const a = b + rndInt(0, 5_000_000);
        const result = subtractMoney(c(a), c(b));
        expect(result).toBe(a - b);
        expect(result).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('multiplyMoney — yuvarlama ve işaret uçları', () => {
    it('0.5 kuruş sınırında yarım-yukarı yuvarlar (Math.round semantiği)', () => {
      expect(multiplyMoney(c(3), 0.5)).toBe(2); // 1.5 -> 2
      expect(multiplyMoney(c(5), 0.5)).toBe(3); // 2.5 -> 3
    });

    it('[SD-M-12 LOW/NIT] belgeler: literal -0 çarpan "factor < 0" guard\'ını atlar ve -0 üretir', () => {
      // JS'te (-0 < 0) === false olduğu için RangeError fırlamaz.
      const result = multiplyMoney(c(100), -0);
      expect(Object.is(result, -0)).toBe(true);
      // Sonuç: formatMoney sıfır tutar için gereksiz eksi işareti gösterir.
      expect(formatMoney(result)).toContain('-');
    });

    it('rastgele tamsayı çarpanlarda tam sonuç verir, negatif çarpanı reddeder (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const a = rndInt(0, 100_000);
        const factor = rndInt(0, 20);
        expect(multiplyMoney(c(a), factor)).toBe(a * factor);
      }
      expect(() => multiplyMoney(c(100), -0.01)).toThrow(RangeError);
    });
  });

  describe('formatMoney — non-finite girdi', () => {
    it('NaN girdisinde sessizce değil, görünür biçimde "NaN" basar (throw değil ama en azından sessiz-yanlış değil)', () => {
      const out = formatMoney(NaN);
      expect(out).toContain('NaN');
    });
  });

  describe('parseMoney — güvenli yol (gruplama ayracı OLMAYAN girdi)', () => {
    it('binlik ayracı olmayan ondalık girdiyi doğru parse eder (temiz)', () => {
      expect(parseMoney('1234,56')).toBe(123456);
      expect(parseMoney('1234.56')).toBe(123456);
    });

    // NOT: binlik ayraçlı (gruplama) girdi — ör. parseMoney(formatMoney(123456)) —
    // burada kasıtlı olarak test EDİLMİYOR: buggy davranışı yeşil tutmak yasak.
    // Bkz. money.findings.test.ts [SD-M-01] (round-trip bugün 123456 yerine 123 döner).
  });
});
