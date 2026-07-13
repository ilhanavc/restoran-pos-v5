import { describe, it, expect } from 'vitest';
import { MoneyCentsSchema, PositiveCentsSchema } from './money.js';

/**
 * Blok 2 / Hat A — derin denetim sınır testleri (ADDITIVE, prod kod dokunulmadı).
 * CLAUDE.md kuralı: "asla ödeme tutarını float/double ile tutmak" — integer
 * kuruş şema kuralı burada karakterize edilir.
 *
 * Bu dosya YEŞİL kalmalı: MoneyCentsSchema/PositiveCentsSchema'nın DOĞRU
 * uyguladığı sınırları kanıtlar. Eksik sınırlar (üst bound yokluğu) için
 * bkz. money.findings.test.ts (SD-T-A-01, kasıtlı KIRMIZI).
 */
describe('MoneyCentsSchema — sınır testleri', () => {
  it('0 kabul eder (nonnegative, sıfır dahil)', () => {
    expect(MoneyCentsSchema.safeParse(0).success).toBe(true);
  });

  it('pozitif integer kabul eder', () => {
    expect(MoneyCentsSchema.safeParse(12_345).success).toBe(true);
  });

  it('negatif tutarı reddeder', () => {
    const r = MoneyCentsSchema.safeParse(-1);
    expect(r.success).toBe(false);
  });

  it('float (1.5 kuruş) tutarı reddeder', () => {
    const r = MoneyCentsSchema.safeParse(1.5);
    expect(r.success).toBe(false);
  });

  it('NaN reddeder', () => {
    const r = MoneyCentsSchema.safeParse(NaN);
    expect(r.success).toBe(false);
  });

  it('Infinity / -Infinity reddeder', () => {
    expect(MoneyCentsSchema.safeParse(Infinity).success).toBe(false);
    expect(MoneyCentsSchema.safeParse(-Infinity).success).toBe(false);
  });

  it('sayısal string "100" coerce etmez, reddeder', () => {
    const r = MoneyCentsSchema.safeParse('100');
    expect(r.success).toBe(false);
  });

  it('null / undefined reddeder', () => {
    expect(MoneyCentsSchema.safeParse(null).success).toBe(false);
    expect(MoneyCentsSchema.safeParse(undefined).success).toBe(false);
  });

  it('boolean reddeder', () => {
    expect(MoneyCentsSchema.safeParse(true).success).toBe(false);
  });

  it('array / object reddeder', () => {
    expect(MoneyCentsSchema.safeParse([100]).success).toBe(false);
    expect(MoneyCentsSchema.safeParse({ amount: 100 }).success).toBe(false);
  });

  it('emoji/unicode string reddeder', () => {
    expect(MoneyCentsSchema.safeParse('💰100').success).toBe(false);
  });

  it('.parse throw eder, .safeParse döner (davranış farkı kanıtı)', () => {
    expect(() => MoneyCentsSchema.parse(-5)).toThrow();
    expect(MoneyCentsSchema.safeParse(-5).success).toBe(false);
  });
});

describe('PositiveCentsSchema — sınır testleri', () => {
  it('0 reddeder (positive, sıfır dahil değil)', () => {
    expect(PositiveCentsSchema.safeParse(0).success).toBe(false);
  });

  it('1 kabul eder', () => {
    expect(PositiveCentsSchema.safeParse(1).success).toBe(true);
  });

  it('negatif reddeder', () => {
    expect(PositiveCentsSchema.safeParse(-1).success).toBe(false);
  });

  it('float reddeder', () => {
    expect(PositiveCentsSchema.safeParse(0.01).success).toBe(false);
  });
});
