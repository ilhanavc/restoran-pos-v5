import { describe, expect, it } from 'vitest';
import {
  assertNonNegativeCents,
  assertPositiveCents,
  isValidNormalizedPhone,
  maskPhone,
} from './validation.js';

describe('assertPositiveCents / assertNonNegativeCents — ROB (NaN/Infinity/-0)', () => {
  it('assertPositiveCents(NaN) throws TypeError (controlled, no crash)', () => {
    expect(() => assertPositiveCents(NaN)).toThrow(TypeError);
  });

  it('assertPositiveCents(Infinity) throws TypeError (not integer)', () => {
    expect(() => assertPositiveCents(Infinity)).toThrow(TypeError);
  });

  it('assertPositiveCents(-Infinity) throws TypeError (not integer)', () => {
    expect(() => assertPositiveCents(-Infinity)).toThrow(TypeError);
  });

  it('assertPositiveCents(-0) throws RangeError (negatif-sıfır pozitif değildir)', () => {
    expect(() => assertPositiveCents(-0)).toThrow(RangeError);
  });

  it('assertNonNegativeCents(-0) throw ETMEZ (-0 === 0, non-negative)', () => {
    expect(() => assertNonNegativeCents(-0)).not.toThrow();
  });

  it('assertNonNegativeCents(NaN) throws TypeError', () => {
    expect(() => assertNonNegativeCents(NaN)).toThrow(TypeError);
  });

  it('assertNonNegativeCents(Infinity) throws TypeError', () => {
    expect(() => assertNonNegativeCents(Infinity)).toThrow(TypeError);
  });
});

describe('isValidNormalizedPhone — sınır (10/15 hane dahil, 9/16 hariç)', () => {
  it('9 hane → false (alt sınırın 1 altı)', () => {
    expect(isValidNormalizedPhone('123456789')).toBe(false);
  });

  it('10 hane → true (alt sınır DAHİL)', () => {
    expect(isValidNormalizedPhone('1234567890')).toBe(true);
  });

  it('15 hane → true (üst sınır DAHİL)', () => {
    expect(isValidNormalizedPhone('123456789012345')).toBe(true);
  });

  it('16 hane → false (üst sınırın 1 üstü)', () => {
    expect(isValidNormalizedPhone('1234567890123456')).toBe(false);
  });

  it('boş string → false', () => {
    expect(isValidNormalizedPhone('')).toBe(false);
  });
});

describe('maskPhone — happy path + kısmi-maskeleme karakterizasyonu (BLOCKER SD-S-03 ayrı dosyada)', () => {
  it('11 haneli gerçekçi TR cep numarasında 7 hane gizlenir (güvenli)', () => {
    expect(maskPhone('05321234567')).toBe('****4567');
  });

  it('7 haneli girdide yalnız 3 hane gizlenir (zayıf ama tam-ifşa DEĞİL)', () => {
    expect(maskPhone('4441444')).toBe('****1444');
  });

  it('tam sınır (4 karakter, throw eşiği) — throw ETMEZ; maskeleme KALİTESİ SD-S-03\'te', () => {
    expect(() => maskPhone('1234')).not.toThrow();
  });

  it('3 karakter → RangeError (maskelemeye yetersiz)', () => {
    expect(() => maskPhone('123')).toThrow(RangeError);
  });
});
