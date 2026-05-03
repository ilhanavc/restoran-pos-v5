import { describe, expect, it } from 'vitest';
import { isTurkishMobile, normalizePhoneTr } from './phone.js';

describe('normalizePhoneTr', () => {
  it('10 hane GSM (5 prefix) → 0 ekler', () => {
    expect(normalizePhoneTr('5398400856')).toBe('05398400856');
  });

  it('11 hane 05XX zaten doğru formatta — aynen döner', () => {
    expect(normalizePhoneTr('05398400856')).toBe('05398400856');
  });

  it('+905XX → 05XX (uluslararası prefix)', () => {
    expect(normalizePhoneTr('+905398400856')).toBe('05398400856');
  });

  it('905XX (12 hane) → 05XX', () => {
    expect(normalizePhoneTr('905398400856')).toBe('05398400856');
  });

  it('uluslararası + boşluklu → 05XX', () => {
    expect(normalizePhoneTr('+90 539 840 08 56')).toBe('05398400856');
  });

  it('tire ayraçlı → 05XX', () => {
    expect(normalizePhoneTr('0539-840-08-56')).toBe('05398400856');
  });

  it('sabit hat (7 hane) — rakamlar aynen', () => {
    expect(normalizePhoneTr('5288300')).toBe('5288300');
  });

  it('İstanbul sabit hat (parantez/tire) → sadece rakam', () => {
    expect(normalizePhoneTr('(212) 555-1234')).toBe('2125551234');
  });

  it('boş string → boş', () => {
    expect(normalizePhoneTr('')).toBe('');
  });

  it('null → boş', () => {
    expect(normalizePhoneTr(null)).toBe('');
  });

  it('undefined → boş', () => {
    expect(normalizePhoneTr(undefined)).toBe('');
  });

  it('sadece harf → boş', () => {
    expect(normalizePhoneTr('abc')).toBe('');
  });

  it('14 hane fazla (90 + ekler) → 90 strip + 10 GSM normalize', () => {
    expect(normalizePhoneTr('90539840085699')).toBe('05398400856');
  });

  it('kısa servis numarası (112) — aynen', () => {
    expect(normalizePhoneTr('112')).toBe('112');
  });

  it('format edilmiş kısa hat — sadece rakam', () => {
    expect(normalizePhoneTr('444 1 444')).toBe('4441444');
  });
});

describe('isTurkishMobile', () => {
  it('normalize cep numarasını cep olarak tanır', () => {
    expect(isTurkishMobile('05398400856')).toBe(true);
  });

  it('uluslararası formatlı cep — true', () => {
    expect(isTurkishMobile('+905398400856')).toBe(true);
  });

  it('sabit hat 7 hane — false', () => {
    expect(isTurkishMobile('5288300')).toBe(false);
  });

  it('boş string — false', () => {
    expect(isTurkishMobile('')).toBe(false);
  });

  it('null — false', () => {
    expect(isTurkishMobile(null)).toBe(false);
  });
});
