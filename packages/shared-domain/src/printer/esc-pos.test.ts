import { describe, expect, it } from 'vitest';
import { ESC_POS, align, printMode, feed, concat } from './esc-pos.js';

/**
 * ADR-004 §7 — ESC/POS command builder unit tests.
 * Pure functions, no DB.
 */
describe('ESC_POS constants', () => {
  it('RESET is ESC @ (0x1B 0x40)', () => {
    expect(Array.from(ESC_POS.RESET)).toEqual([0x1b, 0x40]);
  });

  it('CODEPAGE_CP857 is ESC t 29 (0x1B 0x74 0x1D) — JP80H CP857 index', () => {
    expect(Array.from(ESC_POS.CODEPAGE_CP857)).toEqual([0x1b, 0x74, 0x1d]);
  });

  it('FEED_LINE is LF (0x0A)', () => {
    expect(Array.from(ESC_POS.FEED_LINE)).toEqual([0x0a]);
  });

  it('CUT_FULL is GS V 66 0', () => {
    expect(Array.from(ESC_POS.CUT_FULL)).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });
});

describe('align', () => {
  it('left -> ESC a 0', () => {
    expect(Array.from(align('left'))).toEqual([0x1b, 0x61, 0x00]);
  });

  it('center -> ESC a 1', () => {
    expect(Array.from(align('center'))).toEqual([0x1b, 0x61, 0x01]);
  });

  it('right -> ESC a 2', () => {
    expect(Array.from(align('right'))).toEqual([0x1b, 0x61, 0x02]);
  });
});

describe('printMode', () => {
  it('no options -> ESC ! 0', () => {
    expect(Array.from(printMode())).toEqual([0x1b, 0x21, 0x00]);
  });

  it('bold only -> mask 0x08', () => {
    expect(Array.from(printMode({ bold: true }))).toEqual([0x1b, 0x21, 0x08]);
  });

  it('bold + doubleHeight -> mask 0x18', () => {
    expect(
      Array.from(printMode({ bold: true, doubleHeight: true })),
    ).toEqual([0x1b, 0x21, 0x18]);
  });

  it('all three -> mask 0x38', () => {
    expect(
      Array.from(
        printMode({ bold: true, doubleHeight: true, doubleWidth: true }),
      ),
    ).toEqual([0x1b, 0x21, 0x38]);
  });
});

describe('feed', () => {
  it('feed(3) -> ESC d 3', () => {
    expect(Array.from(feed(3))).toEqual([0x1b, 0x64, 0x03]);
  });

  it('feed(0) -> ESC d 0', () => {
    expect(Array.from(feed(0))).toEqual([0x1b, 0x64, 0x00]);
  });

  it('feed(300) clamps to 255', () => {
    expect(Array.from(feed(300))).toEqual([0x1b, 0x64, 0xff]);
  });

  it('feed(-5) clamps to 0', () => {
    expect(Array.from(feed(-5))).toEqual([0x1b, 0x64, 0x00]);
  });
});

describe('concat', () => {
  it('concatenates RESET and CODEPAGE_CP857', () => {
    const result = concat(ESC_POS.RESET, ESC_POS.CODEPAGE_CP857);
    expect(Array.from(result)).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x1d]);
  });

  it('returns empty Uint8Array when called with no args', () => {
    const result = concat();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  it('handles empty arrays among args', () => {
    const result = concat(
      new Uint8Array([0x01]),
      new Uint8Array([]),
      new Uint8Array([0x02, 0x03]),
    );
    expect(Array.from(result)).toEqual([0x01, 0x02, 0x03]);
  });
});
