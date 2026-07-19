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
   * ister → ADR-004 Amendment 3 ile ikinci model (kasa POS-80) için
   * {@link ESC_POS.CODEPAGE_CP857_PAGE61} eklendi (per-kind seçim: mutfak bu
   * default'u kullanır, kasa PAGE61). Genel per-yazıcı config hâlâ v5.1 (ADR-022).
   * MUTFAK (default) — byte-identical geriye-dönük sözleşme, değeri DEĞİŞTİRME.
   */
  CODEPAGE_CP857: new Uint8Array([0x1b, 0x74, 0x1d]),
  /**
   * ESC t 61 (0x3D) — POS-80 / PrinterPOS-802BC2 (kasa) CP857 indeksi.
   * S87 (2026-07-08): spooler RAW smoke ile POS-80'de ampirik DOĞRULANDI —
   * renderBillReceipt PAGE61 byte'ları Türkçe'yi (ç/ğ/ş/ı/ö/ü) kusursuz bastı
   * (ADR-004 Amendment 4 Çözülen soru #2; artık `Doğrulanmamış` değil). Encoder
   * byte'ları (Ğ=0xA6 ğ=0xA7) her iki indeks tablosunda ORTAK; yalnız bu seçici
   * byte farklı.
   * Kullanım: renderBillReceipt param'ı (enqueue-bill-job.ts). ADR-004 Amd3.
   */
  CODEPAGE_CP857_PAGE61: new Uint8Array([0x1b, 0x74, 0x3d]),
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
 * Character size magnification bytes for {@link size} (GS ! n). High nibble =
 * width multiplier, low nibble = height multiplier (0 = 1×, 1 = 2×, … 7 = 8×).
 * Only 1×/2× combinations are used by the receipt templates (ADR-004 Amd7).
 */
/** GS ! — 1× width, 1× height (normal). */
export const SIZE_NORMAL = 0x00;
/** GS ! — 1× width, 2× height. Width UNCHANGED → 48-column layout preserved (K4). */
export const SIZE_DBL_HEIGHT = 0x01;
/** GS ! — 2× width, 1× height. */
export const SIZE_DBL_WIDTH = 0x10;
/** GS ! — 2× width, 2× height. */
export const SIZE_2X = 0x11;

/**
 * ESC E 1 — turn on emphasized (bold) mode.
 *
 * ADR-004 Amendment 7 (K1/K3): gövde/kalem satırlarını koyulaştırır. `printMode`
 * (ESC !) bold-bit'inden ayrı, gerçek "emphasized" komutu; boyutu değiştirmez.
 */
export function boldOn(): Uint8Array {
  return new Uint8Array([0x1b, 0x45, 0x01]);
}

/** ESC E 0 — turn off emphasized (bold) mode. */
export function boldOff(): Uint8Array {
  return new Uint8Array([0x1b, 0x45, 0x00]);
}

/**
 * ESC G 1 — turn on double-strike mode (koyuluk).
 *
 * ADR-004 Amendment 7 (K2): fiş init'inde (ESC @ + codepage sonrası) açılır →
 * tüm baskı belirgin koyu (kafa aynı noktaya iki kez vurur). Boyutu DEĞİŞTİRMEZ
 * → kolon-matematiği korunur. ESC @ (RESET) hepsini sıfırladığından kesim/bitişte
 * ayrıca kapatmaya gerek yok.
 */
export function doubleStrikeOn(): Uint8Array {
  return new Uint8Array([0x1b, 0x47, 0x01]);
}

/** ESC G 0 — turn off double-strike mode. */
export function doubleStrikeOff(): Uint8Array {
  return new Uint8Array([0x1b, 0x47, 0x00]);
}

/**
 * GS ! n — set character size magnification (1×–8× per axis).
 *
 * Use the `SIZE_*` constants ({@link SIZE_NORMAL}, {@link SIZE_DBL_HEIGHT},
 * {@link SIZE_DBL_WIDTH}, {@link SIZE_2X}). `SIZE_DBL_HEIGHT` leaves character
 * width unchanged so 48-column alignment is preserved (K4). Argument is masked
 * to a single byte.
 */
export function size(n: number): Uint8Array {
  return new Uint8Array([0x1d, 0x21, n & 0xff]);
}

/**
 * Reset per-line emphasis in a single call: character size back to normal
 * (GS ! 0) + bold off (ESC E 0). Double-strike (ESC G) is deliberately NOT
 * touched — it stays globally on for the whole receipt (K2 satır-sonu disiplini).
 */
export function resetEmphasis(): Uint8Array {
  return concat(size(SIZE_NORMAL), boldOff());
}

/**
 * ESC B n t — buzzer/bip (n bip, her biri ~t birim). Generic Çin/POS-80 klonu
 * yazıcıların (Xprinter/GOOJPRT/JP80H) de-facto sesli-uyarı komutu; python-escpos
 * `buzzer()` de bunu kullanır. Fiş init'inde emit edilir → basımda bip (Adisyo
 * paritesi, ADR-004 Amendment 8). Buzzer'ı olmayan yazıcı komutu yutar (nadiren
 * tek karakter basabilir — fiziksel-smoke ile doğrulanır). Kontrol dizisi;
 * CP857/metin katmanına dokunmaz.
 *
 * @param count bip sayısı (1-9; varsayılan 3)
 * @param duration bip süre birimi (1-9; varsayılan 2)
 */
export function buzzer(count = 3, duration = 2): Uint8Array {
  return new Uint8Array([0x1b, 0x42, count & 0xff, duration & 0xff]);
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
