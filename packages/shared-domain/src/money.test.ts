import { describe, expect, it } from 'vitest';
import { addMoney, formatMoney, multiplyMoney, parseMoney, subtractMoney } from './money.js';

describe('addMoney', () => {
  it('adds two cent values', () => { expect(addMoney(100, 50)).toBe(150); });
  it('adds zero', () => { expect(addMoney(100, 0)).toBe(100); });
  it('boundary: MAX_SAFE_INTEGER safe range', () => {
    expect(addMoney((Number.MAX_SAFE_INTEGER - 1) as never, 1 as never)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('subtractMoney', () => {
  it('subtracts', () => { expect(subtractMoney(200, 50)).toBe(150); });
  it('subtracts to zero', () => { expect(subtractMoney(100, 100)).toBe(0); });
  it('throws on negative result', () => { expect(() => subtractMoney(50, 100)).toThrow(RangeError); });
});

describe('multiplyMoney', () => {
  it('multiplies', () => { expect(multiplyMoney(100, 3)).toBe(300); });
  it('rounds fractional result', () => { expect(multiplyMoney(100, 1.5)).toBe(150); });
  it('rounds 0.5 kuruş', () => { expect(multiplyMoney(1, 0.5)).toBe(1); });
  it('throws on negative factor', () => { expect(() => multiplyMoney(100, -1)).toThrow(RangeError); });
  it('zero factor returns 0', () => { expect(multiplyMoney(100, 0)).toBe(0); });
});

describe('formatMoney', () => {
  it('formats 12345 cents as ₺123,45', () => {
    const result = formatMoney(12345);
    expect(result).toContain('123');
    expect(result).toContain('45');
  });
  it('formats 0 cents', () => {
    const result = formatMoney(0);
    expect(result).toContain('0');
  });
});

describe('parseMoney', () => {
  it('parses 123.45', () => { expect(parseMoney('123.45')).toBe(12345); });
  it('parses with comma', () => { expect(parseMoney('123,45')).toBe(12345); });
  it('throws on invalid input', () => { expect(() => parseMoney('abc')).toThrow(TypeError); });
});
