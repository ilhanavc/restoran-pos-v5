/**
 * CP857 (Latin-5 Turkish) encoder.
 *
 * Converts a UTF-8 JavaScript string to a Uint8Array of CP857 bytes.
 * ASCII characters (code point < 128) pass through unchanged.
 * Supported Turkish characters are mapped to their CP857 byte values
 * (see docs/v3-reference/printer-notes.md and ADR-004 §7).
 *
 * IMPORTANT (ADR-004 §7): There is NO ASCII fallback.
 * If an unsupported non-ASCII character is encountered, an Error is thrown.
 * Silent degradation (e.g., "ş" -> "s") would hide render bugs in production.
 */

/**
 * Map of supported non-ASCII characters to their CP857 byte value.
 * Decimal codes from printer-notes.md; full byte hex shown in comment.
 */
const CP857_MAP: Readonly<Record<string, number>> = Object.freeze({
  ç: 0x87, // 135
  ü: 0x81, // 129
  ö: 0x94, // 148
  ş: 0x9f, // 159
  ı: 0x8d, // 141
  ğ: 0xa7, // 167 (CP857 0xA7 = ğ; önceki 0xa6 YANLIŞ idi = Ğ)
  İ: 0x98, // 152
  Ş: 0x9e, // 158
  Ğ: 0xa6, // 166 (CP857 0xA6 = Ğ; önceki 0xa5 YANLIŞ idi = Ñ)
  Ç: 0x80, // 128
  Ü: 0x9a, // 154
  Ö: 0x99, // 153
});

/**
 * Tek karakterin CP857'ye kayıpsız kodlanabilirliği — `sanitizeForCP857`'nin
 * mappability predicate'i (ADR-004 Amd5 K10). `encodeCP857` kontratına
 * DOKUNMAZ: encoder eşlenemeyen karakterde throw etmeye devam eder.
 */
export function isCP857Encodable(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  return code < 0x80 || CP857_MAP[ch] !== undefined;
}

/**
 * Encode a string to CP857 bytes.
 *
 * @param text UTF-8 input.
 * @returns Uint8Array of CP857 bytes.
 * @throws Error if `text` contains a non-ASCII character not in CP857_MAP.
 */
export function encodeCP857(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let writeIdx = 0;

  // Use Array.from to iterate by Unicode code point (not UTF-16 unit) so that
  // a single code point counts as one entry even if represented by surrogates.
  // For BMP characters length stays equal to text.length; we allocated max-size
  // buffer above. We will slice at the end.
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === undefined) {
      // Should not happen for non-empty char, but defensive.
      throw new Error('encodeCP857: invalid character');
    }
    if (code < 0x80) {
      // ASCII passes through.
      out[writeIdx++] = code;
      continue;
    }
    const mapped = CP857_MAP[ch];
    if (mapped === undefined) {
      throw new Error(
        `encodeCP857: unsupported character "${ch}" (U+${code.toString(16).toUpperCase().padStart(4, '0')}). ` +
          'CP857 has no ASCII fallback (ADR-004 §7).',
      );
    }
    out[writeIdx++] = mapped;
  }

  return out.slice(0, writeIdx);
}
