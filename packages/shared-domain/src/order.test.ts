import { describe, expect, it } from 'vitest';
import {
  calculateItemSubtotal,
  calculateOrderDiscount,
  calculateOrderSubtotal,
  calculateOrderTotal,
  computeUnitPriceCents,
  resolveEffectiveUnitPriceCents,
  sumExtraPriceCents,
} from './order.js';

const cents = (n: number) => n as never;

const item = (unitPrice: number, qty: number, isComp = false, isCancelled = false) => ({
  unitPriceCents: unitPrice as never,
  quantity: qty,
  isComp,
  isCancelled,
});

describe('calculateItemSubtotal', () => {
  it('normal item', () => { expect(calculateItemSubtotal(item(1000, 2))).toBe(2000); });
  it('comped item returns 0', () => { expect(calculateItemSubtotal(item(1000, 2, true))).toBe(0); });
  it('cancelled item returns 0', () => { expect(calculateItemSubtotal(item(1000, 2, false, true))).toBe(0); });
  it('zero price', () => { expect(calculateItemSubtotal(item(0, 5))).toBe(0); });
});

describe('calculateOrderSubtotal', () => {
  it('sums active items only', () => {
    expect(calculateOrderSubtotal([item(1000, 2), item(500, 1, true), item(300, 1)])).toBe(2300);
  });
  it('empty order', () => { expect(calculateOrderSubtotal([])).toBe(0); });
});

describe('calculateOrderDiscount', () => {
  it('applies discount', () => { expect(calculateOrderDiscount(1000 as never, 100 as never)).toBe(900); });
  it('zero discount', () => { expect(calculateOrderDiscount(1000 as never, 0 as never)).toBe(1000); });
  it('full discount', () => { expect(calculateOrderDiscount(1000 as never, 1000 as never)).toBe(0); });
  it('throws when discount exceeds subtotal', () => {
    expect(() => calculateOrderDiscount(500 as never, 600 as never)).toThrow(RangeError);
  });
});

describe('calculateOrderTotal', () => {
  it('subtotal - discount + tax', () => {
    expect(calculateOrderTotal(1000 as never, 0 as never, 100 as never)).toBe(1100);
  });
  it('with discount', () => {
    expect(calculateOrderTotal(1000 as never, 100 as never, 90 as never)).toBe(990);
  });
});

// ADR-013 Amendment 6 / KOD-4 — fiyat aritmetiği tekilleştirme (parite testleri).

describe('sumExtraPriceCents', () => {
  it('empty selection is 0', () => {
    expect(sumExtraPriceCents([])).toBe(0);
  });
  it('single extra', () => {
    expect(sumExtraPriceCents([{ extraPriceCents: cents(250) }])).toBe(250);
  });
  it('sums multiple extras', () => {
    expect(
      sumExtraPriceCents([
        { extraPriceCents: cents(250) },
        { extraPriceCents: cents(100) },
        { extraPriceCents: cents(50) },
      ]),
    ).toBe(400);
  });
  it('handles zero-priced extras', () => {
    expect(
      sumExtraPriceCents([
        { extraPriceCents: cents(0) },
        { extraPriceCents: cents(300) },
      ]),
    ).toBe(300);
  });
  it('handles negative extras (discount-type attribute option, e.g. "az porsiyon")', () => {
    // extraPriceCents is a signed integer (shared-types attribute.ts, cap ±100_000) —
    // a discount option is a legitimate domain value, not an invalid one.
    expect(
      sumExtraPriceCents([
        { extraPriceCents: cents(-100) },
        { extraPriceCents: cents(250) },
      ]),
    ).toBe(150);
  });
  it('sums to a negative total when negative extras dominate', () => {
    expect(
      sumExtraPriceCents([
        { extraPriceCents: cents(-300) },
        { extraPriceCents: cents(50) },
      ]),
    ).toBe(-250);
  });
});

describe('computeUnitPriceCents', () => {
  it('base only (no variant, no extras)', () => {
    expect(computeUnitPriceCents(cents(1000), cents(0), cents(0))).toBe(1000);
  });
  it('base + positive variant delta', () => {
    expect(computeUnitPriceCents(cents(1000), cents(500), cents(0))).toBe(1500);
  });
  it('base + negative variant delta (cheaper variant)', () => {
    expect(computeUnitPriceCents(cents(1000), cents(-300), cents(0))).toBe(700);
  });
  it('base + variant + multiple extras', () => {
    expect(computeUnitPriceCents(cents(1000), cents(500), cents(400))).toBe(1900);
  });
});

describe('resolveEffectiveUnitPriceCents', () => {
  it('null override returns computed', () => {
    expect(resolveEffectiveUnitPriceCents(null, cents(1500))).toBe(1500);
  });
  it('override wins over computed (absolute, Amd5 K2)', () => {
    expect(resolveEffectiveUnitPriceCents(cents(2000), cents(1500))).toBe(2000);
  });
  it('override of 0 is honoured (free item, not treated as absent)', () => {
    expect(resolveEffectiveUnitPriceCents(cents(0), cents(1500))).toBe(0);
  });
});

describe('web read-time fold ≡ mobile build-time fold parity (Amd6)', () => {
  // Web keeps override separate and folds the effective price at READ time;
  // mobile folds base + variant into unitPriceCents at BUILD time. With the same
  // inputs both flows must produce the same effective unit price AND line total.
  interface Scenario {
    name: string;
    basePriceCents: number;
    variantDeltaCents: number;
    extras: number[];
    overrideCents: number | null;
    quantity: number;
    isComp?: boolean;
    isCancelled?: boolean;
  }

  const scenarios: Scenario[] = [
    { name: 'plain', basePriceCents: 1000, variantDeltaCents: 0, extras: [], overrideCents: null, quantity: 2 },
    { name: 'variant + extras', basePriceCents: 1000, variantDeltaCents: 500, extras: [250, 100], overrideCents: null, quantity: 3 },
    { name: 'negative variant', basePriceCents: 1000, variantDeltaCents: -300, extras: [50], overrideCents: null, quantity: 1 },
    { name: 'negative extra (discount option)', basePriceCents: 1000, variantDeltaCents: 0, extras: [-100, 50], overrideCents: null, quantity: 2 },
    { name: 'override wins', basePriceCents: 1000, variantDeltaCents: 500, extras: [250], overrideCents: 3000, quantity: 2 },
    { name: 'override 0 (free)', basePriceCents: 1000, variantDeltaCents: 0, extras: [100], overrideCents: 0, quantity: 4 },
    { name: 'comped', basePriceCents: 1000, variantDeltaCents: 500, extras: [250], overrideCents: null, quantity: 2, isComp: true },
    { name: 'cancelled', basePriceCents: 1000, variantDeltaCents: 0, extras: [], overrideCents: 4000, quantity: 3, isCancelled: true },
  ];

  for (const s of scenarios) {
    it(`${s.name}: web fold ≡ mobile fold`, () => {
      const extrasSum = sumExtraPriceCents(s.extras.map((e) => ({ extraPriceCents: cents(e) })));
      const computed = computeUnitPriceCents(cents(s.basePriceCents), cents(s.variantDeltaCents), extrasSum);

      // Web: override kept separate, effective resolved at read time.
      const webEffective = resolveEffectiveUnitPriceCents(
        s.overrideCents === null ? null : cents(s.overrideCents),
        computed,
      );
      // Mobile: effective folded into unitPriceCents at build time.
      const mobileUnit =
        s.overrideCents === null
          ? computed
          : resolveEffectiveUnitPriceCents(cents(s.overrideCents), computed);

      expect(webEffective).toBe(mobileUnit);

      const webLine = calculateItemSubtotal({
        unitPriceCents: cents(webEffective),
        quantity: s.quantity,
        isComp: s.isComp ?? false,
        isCancelled: s.isCancelled ?? false,
      });
      const mobileLine = calculateItemSubtotal({
        unitPriceCents: cents(mobileUnit),
        quantity: s.quantity,
        isComp: s.isComp ?? false,
        isCancelled: s.isCancelled ?? false,
      });
      expect(webLine).toBe(mobileLine);
    });
  }
});

describe('calculateItemSubtotal comp/cancel guard with resolved effective price', () => {
  it('comped line is 0 regardless of override', () => {
    const eff = resolveEffectiveUnitPriceCents(cents(5000), cents(1000));
    expect(calculateItemSubtotal({ unitPriceCents: cents(eff), quantity: 3, isComp: true, isCancelled: false })).toBe(0);
  });
  it('cancelled line is 0 regardless of computed price', () => {
    const eff = resolveEffectiveUnitPriceCents(null, computeUnitPriceCents(cents(1000), cents(500), cents(250)));
    expect(calculateItemSubtotal({ unitPriceCents: cents(eff), quantity: 2, isComp: false, isCancelled: true })).toBe(0);
  });
});

describe('no float leakage (integer kuruş)', () => {
  it('all Amd6 helpers return integers', () => {
    const extrasSum = sumExtraPriceCents([{ extraPriceCents: cents(333) }, { extraPriceCents: cents(167) }]);
    const computed = computeUnitPriceCents(cents(1999), cents(-499), extrasSum);
    const effective = resolveEffectiveUnitPriceCents(null, computed);
    const line = calculateItemSubtotal({ unitPriceCents: cents(effective), quantity: 3, isComp: false, isCancelled: false });
    for (const v of [extrasSum, computed, effective, line]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
