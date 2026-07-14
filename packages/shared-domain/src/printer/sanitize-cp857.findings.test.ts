import { describe, expect, it } from 'vitest';
import { sanitizeForCP857 } from './sanitize-cp857.js';

// Blok 1 audit findings — intentionally RED until bugs fixed.
// See docs/audit/01-shared-domain.md (SD-P-01, SD-P-02).

// [SD-P-01][HIGH][BUG] NFD-decomposed Turkish characters corrupt into a
// bogus "?" glued mid-word instead of composing cleanly or degrading
// legibly. Neither sanitizeForCP857 nor encodeCP857 calls `.normalize()`.
// `for...of` iterates by UTF-16/code-point, NOT by grapheme cluster, so a
// combining mark (e.g. U+0307 COMBINING DOT ABOVE from decomposed 'İ') is
// seen as its own "character": not <0x20, not in TRANSLIT, not
// CP857-encodable -> becomes a standalone '?'. This affects 11 of the 12
// Turkish letters (all but dotless 'ı', which has no NFD decomposition).
// Realistic trigger: text arriving pre-decomposed from certain input
// sources/copy-paste chains lands in a delivery address or customer name —
// the courier then reads a corrupted street/district name.
describe('[SD-P-01] NFD-decomposed Turkish characters corrupt instead of composing cleanly', () => {
  it('sanitizes "İstanbul" typed/copied in NFD (decomposed) form back to a clean result, not "I?stanbul"', () => {
    const nfd = 'İstanbul'.normalize('NFD'); // 'I' + U+0307 + 'stanbul'
    const result = sanitizeForCP857(nfd);
    expect(result).not.toContain('?');
    expect(result).toBe('İstanbul');
  });

  it('sanitizes NFD "ğ" (g + combining breve, U+0306) without inserting a stray "?"', () => {
    const nfd = 'ğ'.normalize('NFD');
    const result = sanitizeForCP857(`bir ${nfd}ün kabuğu`);
    expect(result).not.toContain('?');
  });

  it('sanitizes a full NFD delivery-address-style string (place names) without any "?"', () => {
    const nfd = 'Üsküdar, Şemsi Paşa Camii'.normalize('NFD');
    const result = sanitizeForCP857(nfd);
    expect(result).not.toContain('?');
  });
});

// [SD-P-02][HIGH][BUG] Typographic ("smart") quotes/apostrophes degrade to a
// bare "?" instead of their ASCII equivalent. `TRANSLIT` (sanitize-cp857.ts)
// already covers dash variants (em/en/figure-dash, minus) and middot/bullet
// via the exact same transliteration pattern, but omits curly single/double
// quotes (U+2018/2019/201C/201D). Turkish orthography attaches suffixes to
// place names with an apostrophe ("Kadıköy'e", "3.Cadde'de"), and iOS "Akıllı
// Noktalama" (Smart Punctuation) — ON by default — auto-substitutes a
// typed straight apostrophe with the curly U+2019 in exactly this pattern.
// A waiter typing an order note on the mobile app, or a customer address
// captured from an iOS device, plausibly carries this character routinely.
describe('[SD-P-02] Typographic (smart) quotes/apostrophes degrade to bare "?" instead of ASCII equivalent', () => {
  it('transliterates a curly apostrophe (U+2019, common iOS/mobile autocorrect) to a straight ASCII apostrophe', () => {
    const withSmartQuote = 'Kadıköy’e teslim'; // "Kadıköy’e teslim"
    const result = sanitizeForCP857(withSmartQuote);
    expect(result).not.toContain('?');
    expect(result).toBe("Kadıköy'e teslim");
  });

  it('transliterates curly double quotes (U+201C/U+201D) to ASCII double quotes', () => {
    const withCurlyQuotes = '“Acılı” olsun';
    const result = sanitizeForCP857(withCurlyQuotes);
    expect(result).not.toContain('?');
    expect(result).toBe('"Acılı" olsun');
  });
});
