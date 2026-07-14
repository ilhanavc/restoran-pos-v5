import { describe, expect, it } from 'vitest';
import { sanitizeForCP857 } from './sanitize-cp857.js';
import { encodeCP857 } from './encode-cp857.js';

/**
 * Blok 1 derin denetim — sınır-zorlama testleri (sanitizeForCP857).
 * Additive, prod kodu değiştirmez. Beklenen: TÜMÜ YEŞİL.
 * Bulgu karakterizasyonu (kırmızı) için bkz. sanitize-cp857.findings.test.ts.
 */

describe('sanitizeForCP857 — audit: ASCII identity 0x20-0x7E', () => {
  it('passes every printable ASCII character through unchanged (none collide with TRANSLIT keys)', () => {
    for (let code = 0x20; code <= 0x7e; code++) {
      const ch = String.fromCharCode(code);
      expect(sanitizeForCP857(ch)).toBe(ch);
    }
  });
});

describe('sanitizeForCP857 → encodeCP857 — audit: end-to-end pipeline never throws, never leaks control bytes', () => {
  const unit = 'Karışık Pide çğıöşü — ₺ '; // > 10k when repeated
  const long = unit.repeat(500);

  const nasty: Record<string, string> = {
    'em-dash': 'Sipariş — özel',
    'TRY sign (₺, CP857\'de yok)': 'Tutar: 150₺',
    'euro sign (€, CP857\'de yok)': 'Tutar: 10€',
    emoji: 'Pide 🍕 acılı',
    NBSP: 'a b',
    'NFD İstanbul (decomposed)': 'İstanbul'.normalize('NFD'),
    'ESC/GS control-byte injection': 'Not\x1b@\x1dVtamam',
    'lone high surrogate': 'A\uD800B',
    'lone low surrogate': 'A\uDC00B',
    'curly quotes + apostrophe': '“Acılı” Kadıköy’e',
    ellipsis: 'Az sonra… gelir',
    'null byte': 'a\x00b',
    'long (>10k) mixed line': long,
    'empty string': '',
  };

  it('fixture "long (>10k) mixed line" is actually over 10k chars', () => {
    expect(long.length).toBeGreaterThan(10_000);
  });

  it.each(Object.entries(nasty))('%s: sanitize -> encode does not throw', (_label, input) => {
    expect(() => encodeCP857(sanitizeForCP857(input))).not.toThrow();
  });

  it.each(Object.entries(nasty))(
    '%s: encoded output contains no C0 control byte (0x00-0x1F) and no DEL (0x7F)',
    (_label, input) => {
      // Whitelist is intentionally EMPTY: sanitizeForCP857 strips ALL C0
      // control bytes including \n (0x0A) and \t (0x09) — no exceptions
      // (see SD-P-04 for the word-gluing side-effect of that choice).
      const bytes = Array.from(encodeCP857(sanitizeForCP857(input)));
      for (const b of bytes) {
        expect(b, `unexpected control byte 0x${b.toString(16)}`).toBeGreaterThanOrEqual(0x20);
      }
      expect(bytes).not.toContain(0x7f);
    },
  );
});

describe('sanitizeForCP857 — audit: control-byte / ESC injection neutralization (regression lock)', () => {
  it('strips ESC (0x1B) and GS (0x1D) but keeps the harmless printable payload that followed them', () => {
    // "Not" + ESC + '@' + GS + 'V' + NUL + DEL + "tamam" — matches the
    // existing unit test at sanitize-cp857.test.ts:22, re-asserted here as
    // an end-to-end (post-encode) byte-level check.
    const out = encodeCP857(sanitizeForCP857('Not\x1b@\x1dV\x00\x7ftamam'));
    expect(Array.from(out)).toEqual(
      Array.from(Buffer.from('Not@Vtamam', 'ascii')),
    );
  });
});

describe('sanitizeForCP857 — audit: robustness boundaries', () => {
  it('does not throw for null/undefined smuggled past the type system (TS-strict bypass) — documents current behavior', () => {
    // sanitizeForCP857 iterates with `for...of text`; null/undefined are not
    // iterable, so this throws a TypeError (fail-fast, not silent corruption).
    expect(() => sanitizeForCP857(null as unknown as string)).toThrow();
    expect(() => sanitizeForCP857(undefined as unknown as string)).toThrow();
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeForCP857('')).toBe('');
  });

  it('handles a lone surrogate without throwing (falls back to "?")', () => {
    expect(sanitizeForCP857('A\uD800B')).toBe('A?B');
  });
});
