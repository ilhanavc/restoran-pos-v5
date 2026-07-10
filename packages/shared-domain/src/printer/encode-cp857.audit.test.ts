import { describe, expect, it } from 'vitest';
import { encodeCP857, isCP857Encodable } from './encode-cp857.js';

/**
 * Blok 1 derin denetim — sınır-zorlama testleri (encodeCP857 / isCP857Encodable).
 * Additive, prod kodu değiştirmez. Beklenen: TÜMÜ YEŞİL.
 * Bulgu karakterizasyonu (kırmızı) için bkz. encode-cp857.findings.test.ts.
 *
 * Referans CP857 (Latin-5 Türkçe) byte tablosu — denetim brief'inden birebir
 * alınmıştır; kodun CP857_MAP'iyle karşılaştırma bu tabloya göre yapılır.
 */
const REFERENCE_CP857_TURKISH: Readonly<Record<string, number>> = Object.freeze({
  Ç: 0x80,
  ü: 0x81,
  ç: 0x87,
  ı: 0x8d,
  İ: 0x98,
  Ö: 0x99,
  Ü: 0x9a,
  Ş: 0x9e,
  ş: 0x9f,
  Ğ: 0xa6,
  ğ: 0xa7,
  ö: 0x94,
});

/**
 * Referans tabloda (denetim brief'i) yer alan ama Türkçe alfabesinde OLMAYAN,
 * kodun CP857_MAP'inde bilinçli olarak desteklenMEYEN Latin-5 slotları
 * (é, Ä, É, û, £, á). ADR-004 §7: "ASCII fallback yok" — bunlar throw etmeli.
 */
const REFERENCE_UNSUPPORTED_LATIN5 = ['é', 'Ä', 'É', 'û', '£', 'á'];

describe('encodeCP857 — audit: referans tablo birebir karşılaştırma', () => {
  it.each(Object.entries(REFERENCE_CP857_TURKISH))(
    'encodes "%s" to the exact reference CP857 byte',
    (ch, expectedByte) => {
      const out = encodeCP857(ch);
      expect(Array.from(out)).toEqual([expectedByte]);
    },
  );

  it('all 12 Turkish-critical bytes are distinct (no collision in the map)', () => {
    const bytes = Object.keys(REFERENCE_CP857_TURKISH).map(
      (ch) => Array.from(encodeCP857(ch))[0],
    );
    expect(new Set(bytes).size).toBe(bytes.length);
  });

  it('none of the 12 Turkish bytes collide with the ASCII passthrough range (all >= 0x80)', () => {
    for (const ch of Object.keys(REFERENCE_CP857_TURKISH)) {
      const byte = Array.from(encodeCP857(ch))[0];
      expect(byte).toBeGreaterThanOrEqual(0x80);
    }
  });

  it('documents that non-Turkish Latin-5 slots (é/Ä/É/û/£/á) are deliberately unsupported (throw, no ASCII fallback)', () => {
    for (const ch of REFERENCE_UNSUPPORTED_LATIN5) {
      expect(() => encodeCP857(ch), `expected "${ch}" to throw`).toThrow();
    }
  });
});

describe('encodeCP857 — audit: ASCII identity 0x20-0x7E', () => {
  it('passes every printable ASCII code point through unchanged', () => {
    for (let code = 0x20; code <= 0x7e; code++) {
      const ch = String.fromCharCode(code);
      expect(Array.from(encodeCP857(ch))).toEqual([code]);
    }
  });
});

describe('encodeCP857 — audit: robustness boundaries', () => {
  it('throws (fail-fast, no silent corruption) on a lone unpaired high surrogate U+D800', () => {
    expect(() => encodeCP857('\uD800')).toThrow(/D800/);
  });

  it('throws on a lone unpaired low surrogate U+DC00', () => {
    expect(() => encodeCP857('\uDC00')).toThrow(/DC00/);
  });

  it('still throws (not silently drops/loses neighbours) when a lone surrogate is surrounded by valid ASCII', () => {
    expect(() => encodeCP857('A\uD800B')).toThrow();
  });

  it('handles a long (>10k char) mixed ASCII+Turkish line without throwing, with exact byte count', () => {
    const unit = 'Karışık Pide Şef Özel çğıöşü '; // ASCII + all 12 Turkish chars + space
    const long = unit.repeat(400);
    expect(long.length).toBeGreaterThan(10_000);
    const out = encodeCP857(long);
    // Every code point in `unit` is a single UTF-16 unit (BMP) -> 1 byte each.
    expect(out.length).toBe(long.length);
  });

  it('returns empty Uint8Array for empty string', () => {
    expect(Array.from(encodeCP857(''))).toEqual([]);
  });

  it('throws rather than corrupting output when called with null at runtime (TS-strict bypass)', () => {
    expect(() => encodeCP857(null as unknown as string)).toThrow();
  });

  it('throws rather than corrupting output when called with undefined at runtime (TS-strict bypass)', () => {
    expect(() => encodeCP857(undefined as unknown as string)).toThrow();
  });
});

describe('isCP857Encodable — audit', () => {
  it('agrees with encodeCP857 for every reference Turkish char (true, no throw)', () => {
    for (const ch of Object.keys(REFERENCE_CP857_TURKISH)) {
      expect(isCP857Encodable(ch)).toBe(true);
    }
  });

  it('agrees with encodeCP857 for unsupported Latin-5 chars (false)', () => {
    for (const ch of REFERENCE_UNSUPPORTED_LATIN5) {
      expect(isCP857Encodable(ch)).toBe(false);
    }
  });

  it('returns false (not throw) for a lone surrogate', () => {
    expect(isCP857Encodable('\uD800')).toBe(false);
  });

  it('returns true for every printable ASCII character', () => {
    for (let code = 0x20; code <= 0x7e; code++) {
      expect(isCP857Encodable(String.fromCharCode(code))).toBe(true);
    }
  });
});
