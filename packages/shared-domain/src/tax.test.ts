import { describe, expect, it } from 'vitest';
import {
  VAT_BEVERAGE_BPS,
  VAT_FOOD_BPS,
  calculateVat,
  calculateVatInclusive,
  getCategoryVatRateBps,
} from './tax.js';

describe('getCategoryVatRateBps', () => {
  it('yemek → %10', () => { expect(getCategoryVatRateBps('Yemek')).toBe(VAT_FOOD_BPS); });
  it('içecek → %20', () => { expect(getCategoryVatRateBps('İçecek')).toBe(VAT_BEVERAGE_BPS); });
  it('alkol → %20', () => { expect(getCategoryVatRateBps('Alkol')).toBe(VAT_BEVERAGE_BPS); });
  it('tatlı → %10', () => { expect(getCategoryVatRateBps('Tatlı')).toBe(VAT_FOOD_BPS); });
  it('unknown → fallback %10', () => { expect(getCategoryVatRateBps('bilinmeyen')).toBe(VAT_FOOD_BPS); });
});

describe('calculateVat', () => {
  it('%10 of 1000 = 100', () => { expect(calculateVat(1000 as never, 1000)).toBe(100); });
  it('%20 of 1000 = 200', () => { expect(calculateVat(1000 as never, 2000)).toBe(200); });
  it('rounds fractional', () => { expect(calculateVat(1 as never, 1000)).toBe(0); });
  it('zero subtotal', () => { expect(calculateVat(0 as never, 1000)).toBe(0); });
  it('throws on negative rate', () => { expect(() => calculateVat(1000 as never, -1)).toThrow(RangeError); });
});

describe('calculateVatInclusive', () => {
  it('extracts %10 VAT from gross', () => {
    const vat = calculateVatInclusive(1100 as never, 1000);
    expect(vat).toBe(100);
  });
  it('throws on negative rate', () => {
    expect(() => calculateVatInclusive(1100 as never, -1)).toThrow(RangeError);
  });
});
