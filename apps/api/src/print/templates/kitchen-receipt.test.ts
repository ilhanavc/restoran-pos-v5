import { describe, expect, it } from 'vitest';
import {
  renderKitchenReceipt,
  type KitchenReceiptParams,
} from './kitchen-receipt.js';
import { encodeCP857 } from '@restoran-pos/shared-domain';

/**
 * ADR-004 §7 — kitchen receipt template render tests.
 * Pure function, no DB. Byte-level assertions.
 */

function baseParams(
  overrides: Partial<KitchenReceiptParams> = {},
): KitchenReceiptParams {
  return {
    tenant_header: 'Pide Salonu',
    order_no: 42,
    table_label: 'Masa 5',
    area_label: null,
    server_name: 'Ali',
    items: [{ name: 'Karışık Pide', qty: 2 }],
    created_at_local: '20:30',
    kitchen_dest_label: 'MUTFAK',
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

describe('renderKitchenReceipt', () => {
  it('opens with RESET then CODEPAGE_CP857 and ends with CUT_FULL', () => {
    const out = renderKitchenReceipt(baseParams());

    // First 5 bytes must be ESC @ + ESC t 29 (JP80H CP857 index — ADR-004 §7).
    expect(Array.from(out.subarray(0, 5))).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 0x1d,
    ]);

    // Last 4 bytes must be GS V 66 0.
    expect(Array.from(out.subarray(out.length - 4))).toEqual([
      0x1d, 0x56, 0x42, 0x00,
    ]);
  });

  it('renders single dine-in item with bold qty x name', () => {
    const out = renderKitchenReceipt(baseParams());
    const itemBytes = encodeCP857('2x Karışık Pide');
    expect(bufferContains(out, itemBytes)).toBe(true);

    // Header tenant must be present.
    expect(bufferContains(out, encodeCP857('Pide Salonu'))).toBe(true);
    // Table label is self-describing (Karar A) — no "Masa: " prefix.
    expect(bufferContains(out, encodeCP857('Masa 5'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Masa: '))).toBe(false);
  });

  it('prefixes the area when area_label is present ("Bahçe - Masa 2")', () => {
    const out = renderKitchenReceipt(
      baseParams({ table_label: 'Masa 2', area_label: 'Bahçe' }),
    );
    // Ayraç " - " (CP857-safe — "·" CP857'de yok).
    expect(bufferContains(out, encodeCP857('Bahçe - Masa 2'))).toBe(true);
  });

  it('renders "PAKET" when table_label is null (area ignored)', () => {
    const out = renderKitchenReceipt(
      baseParams({ table_label: null, area_label: 'Bahçe' }),
    );
    expect(bufferContains(out, encodeCP857('PAKET'))).toBe(true);
    // Sanity: the table/area label must NOT appear.
    expect(bufferContains(out, encodeCP857('Masa 5'))).toBe(false);
    expect(bufferContains(out, encodeCP857('Bahçe'))).toBe(false);
  });

  it('renders modifiers as "  + <mod>" lines', () => {
    const out = renderKitchenReceipt(
      baseParams({
        items: [
          {
            name: 'Lahmacun',
            qty: 1,
            modifiers: ['Soğansız', 'Acılı'],
          },
        ],
      }),
    );
    expect(bufferContains(out, encodeCP857('  + Soğansız'))).toBe(true);
    expect(bufferContains(out, encodeCP857('  + Acılı'))).toBe(true);
  });

  it('renders note as "  ! Not: <text>" line', () => {
    const out = renderKitchenReceipt(
      baseParams({
        items: [
          {
            name: 'Çorba',
            qty: 1,
            note: 'Az tuzlu olsun',
          },
        ],
      }),
    );
    expect(bufferContains(out, encodeCP857('  ! Not: Az tuzlu olsun'))).toBe(
      true,
    );
  });

  it('renders multiple items, each preserving its block', () => {
    const out = renderKitchenReceipt(
      baseParams({
        items: [
          { name: 'Pide', qty: 1 },
          { name: 'Ayran', qty: 3 },
        ],
      }),
    );
    expect(bufferContains(out, encodeCP857('1x Pide'))).toBe(true);
    expect(bufferContains(out, encodeCP857('3x Ayran'))).toBe(true);
  });

  it('includes kitchen_dest_label, server, order_no, and created_at_local', () => {
    const out = renderKitchenReceipt(
      baseParams({
        kitchen_dest_label: 'PIDE OCAK',
        server_name: 'Mehmet',
        order_no: 107,
        created_at_local: '21:45',
      }),
    );
    expect(bufferContains(out, encodeCP857('PIDE OCAK'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Garson: Mehmet'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Fiş No: 107'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Saat: 21:45'))).toBe(true);
  });

  it('includes the 40-hyphen separator line', () => {
    const out = renderKitchenReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('-'.repeat(40)))).toBe(true);
  });

  it('returns a non-empty Uint8Array', () => {
    const out = renderKitchenReceipt(baseParams());
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(20);
  });
});
