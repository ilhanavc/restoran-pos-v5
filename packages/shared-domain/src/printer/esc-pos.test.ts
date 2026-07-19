import { describe, expect, it } from 'vitest';
import {
  ESC_POS,
  align,
  printMode,
  feed,
  concat,
  boldOn,
  boldOff,
  doubleStrikeOn,
  doubleStrikeOff,
  buzzer,
  size,
  resetEmphasis,
  SIZE_NORMAL,
  SIZE_DBL_HEIGHT,
  SIZE_DBL_WIDTH,
  SIZE_2X,
} from './esc-pos.js';

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

  it('CODEPAGE_CP857_PAGE61 is ESC t 61 (0x1B 0x74 0x3D) — POS-80/Page61 kasa index (ADR-004 Amd3)', () => {
    expect(Array.from(ESC_POS.CODEPAGE_CP857_PAGE61)).toEqual([0x1b, 0x74, 0x3d]);
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

/**
 * ADR-004 Amendment 7 K1 — fiş tipografisi primitifleri. Saf byte builder'lar;
 * yalnız sabit kontrol dizileri üretir (metin encoding'ine DOKUNMAZ).
 */
describe('boldOn / boldOff (ESC E — Amd7 K1)', () => {
  it('boldOn -> ESC E 1 (0x1B 0x45 0x01)', () => {
    expect(Array.from(boldOn())).toEqual([0x1b, 0x45, 0x01]);
  });

  it('boldOff -> ESC E 0 (0x1B 0x45 0x00)', () => {
    expect(Array.from(boldOff())).toEqual([0x1b, 0x45, 0x00]);
  });
});

describe('doubleStrikeOn / doubleStrikeOff (ESC G — Amd7 K2 koyuluk)', () => {
  it('doubleStrikeOn -> ESC G 1 (0x1B 0x47 0x01)', () => {
    expect(Array.from(doubleStrikeOn())).toEqual([0x1b, 0x47, 0x01]);
  });

  it('doubleStrikeOff -> ESC G 0 (0x1B 0x47 0x00)', () => {
    expect(Array.from(doubleStrikeOff())).toEqual([0x1b, 0x47, 0x00]);
  });
});

describe('buzzer (ESC B — Amd8 sesli-uyarı)', () => {
  it('varsayılan -> ESC B 3 2 (0x1B 0x42 0x03 0x02)', () => {
    expect(Array.from(buzzer())).toEqual([0x1b, 0x42, 0x03, 0x02]);
  });

  it('count/duration parametreleri byte-lenir', () => {
    expect(Array.from(buzzer(5, 4))).toEqual([0x1b, 0x42, 0x05, 0x04]);
  });
});

describe('size (GS ! — Amd7 K1)', () => {
  it('SIZE_NORMAL -> GS ! 0x00', () => {
    expect(Array.from(size(SIZE_NORMAL))).toEqual([0x1d, 0x21, 0x00]);
  });

  it('SIZE_DBL_HEIGHT -> GS ! 0x01 (genişlik değişmez → kolon korunur)', () => {
    expect(Array.from(size(SIZE_DBL_HEIGHT))).toEqual([0x1d, 0x21, 0x01]);
  });

  it('SIZE_DBL_WIDTH -> GS ! 0x10', () => {
    expect(Array.from(size(SIZE_DBL_WIDTH))).toEqual([0x1d, 0x21, 0x10]);
  });

  it('SIZE_2X -> GS ! 0x11', () => {
    expect(Array.from(size(SIZE_2X))).toEqual([0x1d, 0x21, 0x11]);
  });

  it('masks the argument to a single byte', () => {
    expect(Array.from(size(0x1ff))).toEqual([0x1d, 0x21, 0xff]);
  });
});

describe('resetEmphasis (Amd7 K1 — satır-sonu sıfırlama)', () => {
  it('emits GS ! 0 + ESC E 0 (size normal + bold off); double-strike DOKUNULMAZ', () => {
    // ESC G (double-strike) baytı YOK → global koyuluk açık kalır (K2).
    expect(Array.from(resetEmphasis())).toEqual([
      0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00,
    ]);
  });
});
