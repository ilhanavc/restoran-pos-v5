import { describe, expect, it } from 'vitest';
import { ESC_POS, align, printMode, feed, concat, type AlignMode } from './esc-pos.js';

/**
 * Blok 1 derin denetim — sınır-zorlama testleri (esc-pos.ts).
 * Additive, prod kodu değiştirmez. Beklenen: TÜMÜ YEŞİL.
 *
 * Not: bu dosyada 48-kolon satır/padding yardımcısı (twoCol/threeCol) YOK —
 * o mantık apps/api/src/print/templates/receipt-layout.ts'te yaşıyor ve
 * denetim KAPSAMI dışında (yalnız packages/shared-domain/src/printer). Bu
 * paket yalnız ham ESC/POS komut üreticileri + concat sağlıyor.
 */

describe('esc-pos — audit: feed() guard boundaries', () => {
  it('feed(NaN) does not propagate NaN onto the wire (Uint8Array ToUint8 coerces to 0)', () => {
    const out = feed(Number.NaN);
    expect(out.length).toBe(3);
    expect(Number.isNaN(out[2])).toBe(false);
    expect(out[2]).toBe(0);
  });

  it('feed(+Infinity) clamps to 255', () => {
    expect(Array.from(feed(Number.POSITIVE_INFINITY))).toEqual([0x1b, 0x64, 0xff]);
  });

  it('feed(-Infinity) clamps to 0', () => {
    expect(Array.from(feed(Number.NEGATIVE_INFINITY))).toEqual([0x1b, 0x64, 0x00]);
  });

  it('feed(2.9) truncates (not rounds) to 2', () => {
    expect(Array.from(feed(2.9))).toEqual([0x1b, 0x64, 0x02]);
  });

  it('feed(-0.9) truncates toward zero, then clamps to 0 (not -1)', () => {
    expect(Array.from(feed(-0.9))).toEqual([0x1b, 0x64, 0x00]);
  });
});

describe('esc-pos — audit: align() runtime-invalid mode (TS-strict bypass)', () => {
  it('does not throw for an invalid mode string smuggled past the type system; degrades to byte 0 (same as "left")', () => {
    const bogus = 'up' as unknown as AlignMode;
    const out = align(bogus);
    expect(() => out).not.toThrow();
    expect(Array.from(out)).toEqual([0x1b, 0x61, 0x00]);
  });
});

describe('esc-pos — audit: printMode() bitmask matches ESC/POS "ESC ! n" spec', () => {
  it('bold -> bit3 (0x08), doubleHeight -> bit4 (0x10), doubleWidth -> bit5 (0x20)', () => {
    expect(Array.from(printMode({ bold: true }))[2]).toBe(0x08);
    expect(Array.from(printMode({ doubleHeight: true }))[2]).toBe(0x10);
    expect(Array.from(printMode({ doubleWidth: true }))[2]).toBe(0x20);
  });

  it('empty options object behaves like no options (ESC ! 0)', () => {
    expect(Array.from(printMode({}))).toEqual([0x1b, 0x21, 0x00]);
  });
});

describe('esc-pos — audit: ESC_POS codepage selectors', () => {
  it('CODEPAGE_CP857 (mutfak) and CODEPAGE_CP857_PAGE61 (kasa) share the ESC t prefix and differ only in the page index byte', () => {
    expect(Array.from(ESC_POS.CODEPAGE_CP857).slice(0, 2)).toEqual([0x1b, 0x74]);
    expect(Array.from(ESC_POS.CODEPAGE_CP857_PAGE61).slice(0, 2)).toEqual([0x1b, 0x74]);
    expect(ESC_POS.CODEPAGE_CP857[2]).not.toBe(ESC_POS.CODEPAGE_CP857_PAGE61[2]);
  });

  it('CODEPAGE_CP857 index byte is 29 (0x1D) and PAGE61 index byte is 61 (0x3D) per ADR-004 Amd3', () => {
    expect(ESC_POS.CODEPAGE_CP857[2]).toBe(29);
    expect(ESC_POS.CODEPAGE_CP857_PAGE61[2]).toBe(61);
  });
});

describe('esc-pos — audit: concat()', () => {
  it('handles a large number of parts without corruption (500 x 48-byte lines)', () => {
    const line = new Uint8Array(48).fill(0x41);
    const parts = Array.from({ length: 500 }, () => line);
    const out = concat(...parts);
    expect(out.length).toBe(500 * 48);
    expect(out.every((b) => b === 0x41)).toBe(true);
  });

  it('does not mutate its input arrays', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5]);
    concat(a, b);
    expect(Array.from(a)).toEqual([1, 2, 3]);
    expect(Array.from(b)).toEqual([4, 5]);
  });
});

describe('esc-pos — audit: shared-constant mutability (evidence for SD-P-05, MEDIUM finding)', () => {
  it('ESC_POS module-level Uint8Array constants are NOT runtime-frozen — plain, type-checked index mutation silently succeeds', () => {
    // `as const` on the ESC_POS object literal only makes the *property
    // bindings* (ESC_POS.RESET = ...) readonly at compile time; it does NOT
    // deep-freeze the Uint8Array VALUE, so `ESC_POS.RESET[0] = x` compiles
    // and mutates the shared, process-wide singleton with no `any`/bypass.
    // Object.freeze() cannot even be retrofitted here: calling it on a
    // non-empty Uint8Array throws in V8/Node ("Cannot freeze array buffer
    // views with elements") — empirically confirmed while auditing this file.
    // This test documents CURRENT behavior as evidence; it does not endorse it.
    const original = ESC_POS.RESET[0] ?? 0x1b;
    expect(original).toBe(0x1b);
    ESC_POS.RESET[0] = 0x00;
    expect(ESC_POS.RESET[0]).toBe(0x00);
    // Restore immediately — this is a shared singleton read by every other
    // test/consumer in the same process.
    ESC_POS.RESET[0] = original;
    expect(ESC_POS.RESET[0]).toBe(0x1b);
  });
});
