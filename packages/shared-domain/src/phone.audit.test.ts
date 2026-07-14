import { describe, expect, it } from 'vitest';
import { isTurkishMobile, normalizePhoneTr } from './phone.js';

describe('normalizePhoneTr — idempotency (normalize(normalize(x)) === normalize(x))', () => {
  const samples = [
    '5398400856', // 10 hane GSM
    '05398400856', // 11 hane zaten doğru
    '+905398400856', // uluslararası
    '905398400856', // 12 hane 905
    '90539840085699', // 14 hane fazla (90 + iki fazla hane)
    '5288300', // 7 hane sabit hat
    '(212) 555-1234', // İstanbul sabit hat
    '444 1 444', // kısa hat
    '112', // acil servis
    '', // boş
  ];

  it.each(samples)('girdi %j için çift-normalize tek-normalize ile aynı sonucu verir', (raw) => {
    const once = normalizePhoneTr(raw);
    const twice = normalizePhoneTr(once);
    expect(twice).toBe(once);
  });
});

describe('normalizePhoneTr — uluslararası (TR-dışı) numaralar TR formatına ZORLANMAZ', () => {
  it('Almanya +49 numarası TR cep formatına dönüştürülmez (yalnız rakamlar kalır)', () => {
    expect(normalizePhoneTr('+49 151 23456789')).toBe('4915123456789');
  });

  it('ABD +1 numarası (10 hane sonrası, 5 ile başlamıyor) aynen kalır', () => {
    expect(normalizePhoneTr('+1 212 555 0100')).toBe('12125550100');
  });
});

describe('normalizePhoneTr — geçersiz/aşırı girdi çökmeden yönetilir (ROB)', () => {
  it('emoji-only → boş string (çökmeden)', () => {
    expect(normalizePhoneTr('😀😀😀')).toBe('');
  });

  it('60 haneli tamamen alfabetik girdi → boş string (rakam yok)', () => {
    expect(normalizePhoneTr('a'.repeat(60))).toBe('');
  });

  it('alfanümerik karışık kısa girdi → yalnız rakamlar (7 hane sabit-hat kuralı)', () => {
    expect(normalizePhoneTr('tel:5551234')).toBe('5551234');
  });

  it('9 hane (10 hane GSM sınırının 1 altı) → normalize edilmez, aynen döner', () => {
    expect(normalizePhoneTr('539840085')).toBe('539840085');
  });

  it('yanlış tip (number) zorlanırsa String() ile güvenli çevrilir (runtime savunması)', () => {
    expect(normalizePhoneTr(5398400856 as unknown as string)).toBe('05398400856');
  });
});

describe('isTurkishMobile — ek sınır durumları', () => {
  it('12 hane 905-prefix uluslararası GSM → true', () => {
    expect(isTurkishMobile('905398400856')).toBe(true);
  });

  it('sabit hat 10 hane (5 ile başlamıyor) → false', () => {
    expect(isTurkishMobile('2123456789')).toBe(false);
  });

  it('undefined → false', () => {
    expect(isTurkishMobile(undefined)).toBe(false);
  });

  it('10 hane GSM (baştaki 0 olmadan, 5 ile başlıyor) → true (normalize sonrası)', () => {
    expect(isTurkishMobile('5398400856')).toBe(true);
  });
});
