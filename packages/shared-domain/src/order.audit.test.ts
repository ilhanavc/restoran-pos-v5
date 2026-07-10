// Blok 1 derin denetim — HAT A (para çekirdeği). Sınır-zorlama testleri.
// Bu dosya YEŞİL kalmalı. BLOCKER/HIGH bulgular order.findings.test.ts'e taşındı.
// Rapor: C:\Users\ilhan\AppData\Local\Temp\claude\D--restoran-pos-v5\87e5dd93-086e-432a-9251-14ddd7376f7b\scratchpad\qa-A-money-report.md
import { describe, expect, it } from 'vitest';
import {
  calculateItemSubtotal,
  calculateOrderDiscount,
  calculateOrderSubtotal,
  calculateOrderTotal,
} from './order.js';

interface Item {
  unitPriceCents: number;
  quantity: number;
  isComp: boolean;
  isCancelled: boolean;
}

const item = (unitPrice: number, qty: number, isComp = false, isCancelled = false): Item => ({
  unitPriceCents: unitPrice,
  quantity: qty,
  isComp,
  isCancelled,
});

let seed = 99;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function rndInt(min: number, max: number): number {
  return Math.floor(min + rnd() * (max - min + 1));
}

describe('order.ts — sınır-zorlama & property audit', () => {
  describe('calculateOrderSubtotal — büyük sepet & comp/cancel dışlama', () => {
    it('100 satırlık gerçekçi bir Türk restoran sepetinde (pide/lokanta) yalnız aktif satırlar toplanır', () => {
      const items: Item[] = [];
      let expectedActive = 0;
      // Realistic menu prices in kuruş: pide 12000, lahmacun 4500, ayran 1500, kola 2500.
      const prices = [12_000, 4_500, 1_500, 2_500, 8_000];
      for (let i = 0; i < 100; i++) {
        const price = prices[i % prices.length] as number;
        const qty = rndInt(1, 4);
        const isComp = i % 17 === 0; // ~6% ikram
        const isCancelled = i % 23 === 0; // ~4% iptal
        items.push(item(price, qty, isComp, isCancelled));
        if (!isComp && !isCancelled) expectedActive += price * qty;
      }
      expect(calculateOrderSubtotal(items)).toBe(expectedActive);
    });

    it('tamamı comp/cancelled bir sepet 0 döner (sıfıra bölme veya throw yok)', () => {
      const items = [item(1000, 2, true), item(500, 1, false, true)];
      expect(calculateOrderSubtotal(items)).toBe(0);
    });

    it('rastgele sepetlerde toplam, aktif satırların tek tek toplamına eşittir (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const n = rndInt(0, 20);
        const items: Item[] = [];
        let expected = 0;
        for (let j = 0; j < n; j++) {
          const price = rndInt(0, 50_000);
          const qty = rndInt(1, 10);
          const isComp = rnd() < 0.1;
          const isCancelled = !isComp && rnd() < 0.1;
          items.push(item(price, qty, isComp, isCancelled));
          if (!isComp && !isCancelled) expected += price * qty;
        }
        expect(calculateOrderSubtotal(items)).toBe(expected);
      }
    });
  });

  describe('calculateOrderDiscount / calculateOrderTotal — sınırlar', () => {
    it('indirim tam subtotal\'a eşitse toplam 0 (throw değil)', () => {
      expect(calculateOrderDiscount(10_000, 10_000)).toBe(0);
    });

    it('rastgele 0 <= indirim <= subtotal için sonuç asla negatif değildir (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const subtotal = rndInt(0, 5_000_000);
        const discount = rndInt(0, subtotal);
        const result = calculateOrderDiscount(subtotal, discount);
        expect(result).toBe(subtotal - discount);
        expect(result).toBeGreaterThanOrEqual(0);
      }
    });

    it('rastgele subtotal/indirim/vergi üçlüsünde total = (subtotal-indirim)+vergi (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const subtotal = rndInt(0, 5_000_000);
        const discount = rndInt(0, subtotal);
        const tax = rndInt(0, 1_000_000);
        const total = calculateOrderTotal(subtotal, discount, tax);
        expect(total).toBe(subtotal - discount + tax);
      }
    });
  });
});
