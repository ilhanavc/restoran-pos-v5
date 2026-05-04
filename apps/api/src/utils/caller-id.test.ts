import { describe, expect, it } from 'vitest';
import { isMaskedNumber } from './caller-id';

/**
 * ADR-016 §11 Karar 11.4 — Caller ID bypass pattern matcher unit tests.
 * Default tenant patterns: ^0850\d+ , ^0440\d+ , ^0444\d+
 */
describe('isMaskedNumber', () => {
  const defaultPatterns = ['^0850\\d+', '^0440\\d+', '^0444\\d+'];

  it('Yemeksepeti 0850 prefix — match', () => {
    const r = isMaskedNumber('08502531414', defaultPatterns);
    expect(r.matched).toBe(true);
    expect(r.patternMatched).toBe('^0850\\d+');
  });

  it('Trendyol Yemek 0444 prefix — match', () => {
    const r = isMaskedNumber('04441234567', defaultPatterns);
    expect(r.matched).toBe(true);
    expect(r.patternMatched).toBe('^0444\\d+');
  });

  it('Normal cep numarası 0539 — no match', () => {
    const r = isMaskedNumber('05391234567', defaultPatterns);
    expect(r.matched).toBe(false);
    expect(r.patternMatched).toBeUndefined();
  });

  it('Sabit hat 0212 — no match', () => {
    const r = isMaskedNumber('02121234567', defaultPatterns);
    expect(r.matched).toBe(false);
  });

  it('Boş telefon — no match', () => {
    const r = isMaskedNumber('', defaultPatterns);
    expect(r.matched).toBe(false);
  });

  it('Boş pattern listesi — no match', () => {
    const r = isMaskedNumber('08501234567', []);
    expect(r.matched).toBe(false);
  });

  it('Geçersiz regex pattern — atlanır, listenin geri kalanı çalışır', () => {
    const r = isMaskedNumber('08501234567', ['[invalid(', '^0850\\d+']);
    expect(r.matched).toBe(true);
    expect(r.patternMatched).toBe('^0850\\d+');
  });

  it('Tek geçersiz pattern — match yok, throw da yok', () => {
    const r = isMaskedNumber('08501234567', ['[invalid(']);
    expect(r.matched).toBe(false);
  });

  it('İlk eşleşen pattern döner (sıralı kontrol)', () => {
    const patterns = ['^0850123\\d+', '^0850\\d+'];
    const r = isMaskedNumber('08501234567', patterns);
    expect(r.matched).toBe(true);
    expect(r.patternMatched).toBe('^0850123\\d+');
  });
});
