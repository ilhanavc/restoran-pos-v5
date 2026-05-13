import { describe, expect, it } from 'vitest';
import { encodeCP857 } from './encode-cp857.js';

/**
 * ADR-004 §7 — CP857 encoder unit tests.
 * Pure function, no DB.
 */
describe('encodeCP857', () => {
  it('encodes pure ASCII byte-by-byte', () => {
    const out = encodeCP857('Hello');
    expect(Array.from(out)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it('encodes the full Turkish character set per byte table', () => {
    const out = encodeCP857('ÇĞİÖŞÜçğıöşü');
    expect(Array.from(out)).toEqual([
      0x80, // Ç
      0xa5, // Ğ
      0x98, // İ
      0x99, // Ö
      0x9e, // Ş
      0x9a, // Ü
      0x87, // ç
      0xa6, // ğ
      0x8d, // ı
      0x94, // ö
      0x9f, // ş
      0x81, // ü
    ]);
  });

  it('encodes mixed ASCII + Turkish "Şefin Özel"', () => {
    const out = encodeCP857('Şefin Özel');
    expect(Array.from(out)).toEqual([
      0x9e, // Ş
      0x65, // e
      0x66, // f
      0x69, // i
      0x6e, // n
      0x20, // space
      0x99, // Ö
      0x7a, // z
      0x65, // e
      0x6c, // l
    ]);
  });

  it('returns empty Uint8Array for empty input', () => {
    const out = encodeCP857('');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(0);
  });

  it('throws on unsupported non-ASCII character (e.g. é)', () => {
    expect(() => encodeCP857('café')).toThrowError(/é/);
  });

  it('preserves newline byte', () => {
    const out = encodeCP857('a\nb');
    expect(Array.from(out)).toEqual([0x61, 0x0a, 0x62]);
  });

  it('throws with informative message including code point', () => {
    try {
      encodeCP857('â');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as Error).message).toMatch(/U\+00E2/i);
      expect((err as Error).message).toMatch(/ADR-004/);
    }
  });
});
