/**
 * ESC/POS raw byte command builders.
 *
 * Pure functions; do NOT touch encoding. Use {@link encodeCP857} for the
 * text payload and concatenate with the builders here.
 *
 * Reference: ADR-004 §7, docs/v3-reference/printer-notes.md.
 */

/**
 * Fixed ESC/POS command byte sequences.
 */
export const ESC_POS = {
  /** ESC @ — reset printer to power-on defaults. */
  RESET: new Uint8Array([0x1b, 0x40]),
  /**
   * ESC t 29 (0x1D) — pilot yazıcısı JP80H-UE'nin CP857 (Türkçe) codepage
   * indeksi. Codepage-scan (2026-07-06, installer/codepage-scan.ps1) ile
   * doğrulandı: bu firmware'de index 13 BOŞ (tanımsız), index 29 = CP857.
   * Standart EPSON tablosundan sapar; farklı yazıcı modeli farklı indeks
   * isteyebilir → v5.1'de per-yazıcı config'e taşınabilir (şu an tek-tenant,
   * tek model pilot).
   */
  CODEPAGE_CP857: new Uint8Array([0x1b, 0x74, 0x1d]),
  /** LF — print buffer and feed one line. */
  FEED_LINE: new Uint8Array([0x0a]),
  /** GS V 66 0 — full cut after feed. */
  CUT_FULL: new Uint8Array([0x1d, 0x56, 0x42, 0x00]),
} as const;

/** Horizontal alignment mode for {@link align}. */
export type AlignMode = 'left' | 'center' | 'right';

const ALIGN_BYTE: Readonly<Record<AlignMode, number>> = Object.freeze({
  left: 0x00,
  center: 0x01,
  right: 0x02,
});

/**
 * Build an ESC a n command setting horizontal alignment.
 *
 * @param mode 'left' | 'center' | 'right'
 */
export function align(mode: AlignMode): Uint8Array {
  return new Uint8Array([0x1b, 0x61, ALIGN_BYTE[mode]]);
}

/** Options for {@link printMode}. */
export interface PrintModeOptions {
  bold?: boolean;
  doubleHeight?: boolean;
  doubleWidth?: boolean;
}

/**
 * Build an ESC ! n command setting character print mode bitmask.
 * Bits: 0x08 bold, 0x10 double-height, 0x20 double-width.
 *
 * Passing no flags (or all false) returns ESC ! 0 which resets to normal.
 */
export function printMode(opts: PrintModeOptions = {}): Uint8Array {
  let mask = 0;
  if (opts.bold) mask |= 0x08;
  if (opts.doubleHeight) mask |= 0x10;
  if (opts.doubleWidth) mask |= 0x20;
  return new Uint8Array([0x1b, 0x21, mask]);
}

/**
 * Build an ESC d n command feeding `n` lines.
 * Value is clamped to [0, 255].
 */
export function feed(n: number): Uint8Array {
  const clamped = Math.max(0, Math.min(255, Math.trunc(n)));
  return new Uint8Array([0x1b, 0x64, clamped]);
}

/**
 * Concatenate any number of Uint8Array parts into a single buffer.
 */
export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
