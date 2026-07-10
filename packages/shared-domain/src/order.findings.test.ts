// Blok 1 audit findings — intentionally RED until bugs fixed.
// See docs/audit/01-shared-domain.md (Blok 1 HAT A — packages/shared-domain para çekirdeği).
//
// Bu dosyadaki testler DOĞRU/beklenen davranışı assert eder; bug yüzünden
// bugün FAIL olurlar. Fix sonrası bu dosya yeşile döner ve regresyon
// paketine geçer.
import { describe, expect, it } from 'vitest';
import { calculateItemSubtotal, calculateOrderDiscount } from './order.js';

describe('[SD-M-06] calculateItemSubtotal must always return an integer cents value', () => {
  it('rejects (or rounds) a fractional quantity instead of returning fractional "cents"', () => {
    // Bugün: 333 * 1.5 = 499.5 döner — CLAUDE.md çekirdek direktifi ("Asla:
    // ödeme tutarını float/double ile tutmak") burada ihlal ediliyor. Fonksiyon
    // bugün canlıda çağrılmıyor (bkz. rapor DEAD-code bulgusu) ama exported ve
    // "MoneyCents" tipini iddia ediyor.
    const result = calculateItemSubtotal({
      unitPriceCents: 333,
      quantity: 1.5,
      isComp: false,
      isCancelled: false,
    });
    expect(Number.isInteger(result)).toBe(true);
  });

  it('does not silently produce NaN for a zero-price item with non-finite quantity (0 * Infinity = NaN)', () => {
    const result = calculateItemSubtotal({
      unitPriceCents: 0,
      quantity: Infinity,
      isComp: false,
      isCancelled: false,
    });
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe('[SD-M-07] calculateOrderDiscount must not let a negative discount silently increase the total', () => {
  it('rejects a negative discountCents instead of adding it to the subtotal', () => {
    // Bugün: `-100 > 1000` === false → guard atlamaz → `1000 - (-100) = 1100`
    // döner: "indirim" adı altında sessizce fazla tahsilat (surcharge).
    expect(() => calculateOrderDiscount(1000, -100)).toThrow();
  });

  it('rejects NaN discountCents instead of returning NaN as the discounted subtotal', () => {
    // Bugün: `NaN > 1000` === false → guard atlanır → `1000 - NaN = NaN` döner.
    expect(() => calculateOrderDiscount(1000, NaN)).toThrow();
  });
});
