import { describe, expect, it } from 'vitest';
import { renderBillReceipt, type BillReceiptParams } from './bill-receipt.js';
import { encodeCP857 } from '@restoran-pos/shared-domain';

/**
 * ADR-027 Faz A — customer bill (adisyon) template render tests.
 * Pure function, no DB. Byte-level assertions. Money basar "TL" (CP857 ₺ yok).
 */

function baseParams(
  overrides: Partial<BillReceiptParams> = {},
): BillReceiptParams {
  return {
    tenant_header: 'Pide Salonu',
    order_no: 42,
    table_label: 'M5',
    items: [
      { name: 'Kıymalı Pide', qty: 2, lineTotalCents: 36000 },
      { name: 'Ayran', qty: 1, lineTotalCents: 2500 },
    ],
    totalCents: 38500,
    created_at_local: '2026-06-29 20:30',
    ...overrides,
  };
}

/** Naive byte-array contains-subsequence check. */
function bufferContains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe('renderBillReceipt', () => {
  it('opens with RESET then CODEPAGE_CP857 and ends with CUT_FULL', () => {
    const out = renderBillReceipt(baseParams());
    expect(Array.from(out.subarray(0, 5))).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 0x0d,
    ]);
    expect(Array.from(out.subarray(out.length - 4))).toEqual([
      0x1d, 0x56, 0x42, 0x00,
    ]);
  });

  it('renders header, ADİSYON label and meta block', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('Pide Salonu'))).toBe(true);
    expect(bufferContains(out, encodeCP857('ADİSYON'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Masa: M5'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Fiş No: 42'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Tarih: 2026-06-29 20:30'))).toBe(
      true,
    );
  });

  it('renders items with "<qty>x <name>" and line total in TL', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('2x Kıymalı Pide'))).toBe(true);
    expect(bufferContains(out, encodeCP857('1x Ayran'))).toBe(true);
    expect(bufferContains(out, encodeCP857('360,00 TL'))).toBe(true);
    expect(bufferContains(out, encodeCP857('25,00 TL'))).toBe(true);
  });

  it('renders TOPLAM line with the total in TL (no ₺ glyph)', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('TOPLAM:'))).toBe(true);
    expect(bufferContains(out, encodeCP857('385,00 TL'))).toBe(true);
  });

  it('renders "PAKET" when table_label is null', () => {
    const out = renderBillReceipt(baseParams({ table_label: null }));
    expect(bufferContains(out, encodeCP857('Masa: PAKET'))).toBe(true);
    expect(bufferContains(out, encodeCP857('M5'))).toBe(false);
  });

  it('renders the footer thank-you line', () => {
    const out = renderBillReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('Teşekkür ederiz!'))).toBe(true);
  });

  it('returns a non-empty Uint8Array', () => {
    const out = renderBillReceipt(baseParams());
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(20);
  });
});
