import { describe, expect, it } from 'vitest';
import { sanitizeForCP857 } from './sanitize-cp857.js';
import { encodeCP857 } from './encode-cp857.js';

/**
 * ADR-004 Amd5 K10 — sanitizeForCP857 unit tests (chip task_df442130).
 */

describe('sanitizeForCP857', () => {
  it('transliterates em/en/figure-dash and minus to ASCII hyphen', () => {
    expect(sanitizeForCP857('a—b–c‒d−e')).toBe('a-b-c-d-e');
  });

  it('transliterates middot and bullet to period, NBSP to space', () => {
    expect(sanitizeForCP857('Bahçe · Masa')).toBe('Bahçe . Masa');
    expect(sanitizeForCP857('• Yumurtalı')).toBe('. Yumurtalı');
    expect(sanitizeForCP857('a b')).toBe('a b');
  });

  it('strips C0 control bytes and DEL (ESC/GS injection)', () => {
    // ESC @ + GS V (kesim) enjeksiyon denemesi — kontrol baytları düşer.
    expect(sanitizeForCP857('Not\x1b@\x1dV\x00\x7ftamam')).toBe('Not@Vtamam');
    expect(sanitizeForCP857('satır\nsonu\r')).toBe('satırsonu');
  });

  it('replaces unmappable non-ASCII code points with "?"', () => {
    expect(sanitizeForCP857('fiyat ₺ 10')).toBe('fiyat ? 10');
    expect(sanitizeForCP857('emoji 🍕 pide')).toBe('emoji ? pide');
    expect(sanitizeForCP857('café')).toBe('caf?'); // é CP857_MAP'te yok
  });

  it('preserves Turkish CP857 glyphs and printable ASCII unchanged', () => {
    const tr = 'ÇĞİÖŞÜ çğıöşü 0-9 A-Z [not, %50]';
    expect(sanitizeForCP857(tr)).toBe(tr);
  });

  it('output always survives encodeCP857 (no throw) for arbitrary input', () => {
    const nasty = '—•·₺🍕\x1b\x1dÇağrı köftesi not';
    const safe = sanitizeForCP857(nasty);
    expect(() => encodeCP857(safe)).not.toThrow();
  });

  it('returns empty string for empty/only-control input', () => {
    expect(sanitizeForCP857('')).toBe('');
    expect(sanitizeForCP857('\x00\x1f\x7f')).toBe('');
  });
});
