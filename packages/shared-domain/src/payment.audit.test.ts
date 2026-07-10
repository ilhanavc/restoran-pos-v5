// Blok 1 derin denetim — HAT A (para çekirdeği). Sınır-zorlama testleri.
// Bu dosya YEŞİL kalmalı. BLOCKER/HIGH bulgular payment.findings.test.ts'e taşındı.
// Rapor: C:\Users\ilhan\AppData\Local\Temp\claude\D--restoran-pos-v5\87e5dd93-086e-432a-9251-14ddd7376f7b\scratchpad\qa-A-money-report.md
import { describe, expect, it } from 'vitest';
import type { MoneyCents } from '@restoran-pos/shared-types';
import { calculatePayableCents, canCloseOrder, validateCashTendered } from './payment.js';

const c = (n: number): MoneyCents => n as MoneyCents;

let seed = 7;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
}
function rndInt(min: number, max: number): number {
  return Math.floor(min + rnd() * (max - min + 1));
}

describe('payment.ts — sınır-zorlama & property audit', () => {
  describe('calculatePayableCents — uçlar', () => {
    it('MAX_SAFE_INTEGER civarında tam sonuç verir', () => {
      const total = Number.MAX_SAFE_INTEGER;
      expect(calculatePayableCents({ totalCents: c(total), compedAmountCents: c(0) })).toBe(total);
    });

    it('compedAmountCents === totalCents için payable tam 0 (fully-comped sınırı)', () => {
      expect(
        calculatePayableCents({ totalCents: c(500_000), compedAmountCents: c(500_000) }),
      ).toBe(0);
    });

    it('rastgele total >= comped >= 0 için payable = total - comped, hiçbir zaman negatif değil (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const total = rndInt(0, 10_000_000);
        const comped = rndInt(0, total);
        const payable = calculatePayableCents({ totalCents: c(total), compedAmountCents: c(comped) });
        expect(payable).toBe(total - comped);
        expect(payable).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('canCloseOrder — sıfır ve büyük tutar uçları', () => {
    it('MAX_SAFE_INTEGER payable/ödeme tam eşleşince kapanır', () => {
      const v = Number.MAX_SAFE_INTEGER;
      expect(
        canCloseOrder({
          isFullyComped: false,
          payableCents: c(v),
          paymentsTotalCents: c(v),
          paymentsCount: 1,
        }),
      ).toEqual({ ok: true });
    });

    it('1 kuruşluk fark bile "overpaid"/"underpaid" olarak reddedilir (float tolerans YOK — doğru, integer kuruşta epsilon gerekmez)', () => {
      expect(
        canCloseOrder({
          isFullyComped: false,
          payableCents: c(1000),
          paymentsTotalCents: c(1001),
          paymentsCount: 1,
        }),
      ).toEqual({ ok: false, reason: 'overpaid' });
      expect(
        canCloseOrder({
          isFullyComped: false,
          payableCents: c(1000),
          paymentsTotalCents: c(999),
          paymentsCount: 1,
        }),
      ).toEqual({ ok: false, reason: 'underpaid' });
    });

    it('rastgele payable için yalnız tam eşit ödeme "ok" döner, diğer her şey reddedilir (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const payable = rndInt(0, 5_000_000);
        const delta = rndInt(-1000, 1000);
        const paid = payable + delta;
        if (paid < 0) continue; // MoneyCents negatif olamaz, gerçekçi girdi değil
        const result = canCloseOrder({
          isFullyComped: false,
          payableCents: c(payable),
          paymentsTotalCents: c(paid),
          paymentsCount: 1,
        });
        if (delta === 0) {
          expect(result).toEqual({ ok: true });
        } else if (delta > 0) {
          expect(result).toEqual({ ok: false, reason: 'overpaid' });
        } else {
          expect(result).toEqual({ ok: false, reason: 'underpaid' });
        }
      }
    });
  });

  describe('validateCashTendered — property', () => {
    it('rastgele tendered >= amount için changeCents = tendered - amount tam sonuç (500 iterasyon)', () => {
      for (let i = 0; i < 500; i++) {
        const amount = rndInt(0, 5_000_000);
        const extra = rndInt(0, 5_000_000);
        const tendered = amount + extra;
        const result = validateCashTendered({ amountCents: c(amount), tenderedCents: c(tendered) });
        expect(result).toEqual({ ok: true, changeCents: extra });
      }
    });

    it('MAX_SAFE_INTEGER tutarında tam ödeme sıfır para üstü verir', () => {
      const v = Number.MAX_SAFE_INTEGER;
      expect(validateCashTendered({ amountCents: c(v), tenderedCents: c(v) })).toEqual({
        ok: true,
        changeCents: 0,
      });
    });
  });
});
