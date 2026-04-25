import { describe, expect, it } from 'vitest';
import { formatOrderNo, parseOrderNo } from './order-no.js';

describe('formatOrderNo', () => {
  it('pads to 4 digits', () => { expect(formatOrderNo(42)).toBe('#0042'); });
  it('no padding needed for large number', () => { expect(formatOrderNo(12345)).toBe('#12345'); });
  it('1 → #0001', () => { expect(formatOrderNo(1)).toBe('#0001'); });
  it('throws on zero', () => { expect(() => formatOrderNo(0)).toThrow(RangeError); });
  it('throws on negative', () => { expect(() => formatOrderNo(-1)).toThrow(RangeError); });
  it('throws on float', () => { expect(() => formatOrderNo(1.5)).toThrow(RangeError); });
});

describe('parseOrderNo', () => {
  it('parses #0042 → 42', () => { expect(parseOrderNo('#0042')).toBe(42); });
  it('parses #12345 → 12345', () => { expect(parseOrderNo('#12345')).toBe(12345); });
  it('throws on invalid format', () => { expect(() => parseOrderNo('42')).toThrow(TypeError); });
  it('throws on empty', () => { expect(() => parseOrderNo('')).toThrow(TypeError); });
});
