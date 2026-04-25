import { describe, expect, it } from 'vitest';
import {
  assertNonNegativeCents,
  assertPositiveCents,
  isValidNormalizedPhone,
  maskPhone,
} from './validation.js';

describe('assertPositiveCents', () => {
  it('passes for positive integer', () => { expect(() => assertPositiveCents(100)).not.toThrow(); });
  it('throws for zero', () => { expect(() => assertPositiveCents(0)).toThrow(RangeError); });
  it('throws for negative', () => { expect(() => assertPositiveCents(-1)).toThrow(RangeError); });
  it('throws for float', () => { expect(() => assertPositiveCents(1.5)).toThrow(TypeError); });
});

describe('assertNonNegativeCents', () => {
  it('passes for zero', () => { expect(() => assertNonNegativeCents(0)).not.toThrow(); });
  it('passes for positive', () => { expect(() => assertNonNegativeCents(100)).not.toThrow(); });
  it('throws for negative', () => { expect(() => assertNonNegativeCents(-1)).toThrow(RangeError); });
  it('throws for float', () => { expect(() => assertNonNegativeCents(0.5)).toThrow(TypeError); });
});

describe('maskPhone', () => {
  it('masks all but last 4', () => { expect(maskPhone('+905551234567')).toBe('****4567'); });
  it('throws for short phone', () => { expect(() => maskPhone('123')).toThrow(RangeError); });
});

describe('isValidNormalizedPhone', () => {
  it('valid TR number', () => { expect(isValidNormalizedPhone('+905551234567')).toBe(true); });
  it('invalid with letters', () => { expect(isValidNormalizedPhone('abc')).toBe(false); });
  it('too short', () => { expect(isValidNormalizedPhone('123')).toBe(false); });
});
