import { describe, expect, it } from 'vitest';
import {
  calculateItemSubtotal,
  calculateOrderDiscount,
  calculateOrderSubtotal,
  calculateOrderTotal,
} from './order.js';

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
