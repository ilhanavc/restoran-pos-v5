/**
 * ADR-004 Amendment 6 A3 + Amendment 9 — iptal fişi RASTER render testleri.
 * Yapısal zarf sözleşmesi (ESC @ + buzzer + GS v 0 + CUT) + render-smoke
 * (varyantlar/Türkçe/PAKET/enjeksiyon THROW etmez). Text-mode byte-içerik
 * assert'leri emekli (K7).
 */

import { describe, expect, it } from 'vitest';
import {
  renderCancelReceipt,
  type CancelReceiptParams,
} from './cancel-receipt';

const ESC_AT = [0x1b, 0x40];
const BUZZER = [0x1b, 0x42, 0x03, 0x02];
const GS_V0 = [0x1d, 0x76, 0x30];
const CUT_FULL = [0x1d, 0x56, 0x42, 0x00];

function baseParams(
  over: Partial<CancelReceiptParams> = {},
): CancelReceiptParams {
  return {
    variant: 'item-cancel',
    order_type: 'dine_in',
    order_no: 7,
    table_label: 'Masa 5',
    area_label: 'Salon',
    server_name: 'İlhan',
    created_at_local: '15.07.2026 21:35:12',
    items: [
      {
        name: 'Kaşarlı Pide',
        qty: 2,
        variantName: 'Tam',
        modifiers: ['Acılı', 'Soğansız'],
        note: 'çğüşöı bol pişmiş',
      },
    ],
    ...over,
  };
}

describe('renderCancelReceipt (raster; ADR-004 Amd6 A3 + Amd9)', () => {
  it('ESC @ + buzzer(Amd8) + GS v 0 açar, CUT_FULL ile biter', () => {
    const out = renderCancelReceipt(baseParams());
    expect(Array.from(out.subarray(0, 2))).toEqual(ESC_AT);
    expect(Array.from(out.subarray(2, 6))).toEqual(BUZZER);
    expect(Array.from(out.subarray(6, 9))).toEqual(GS_V0);
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
    expect(out.length).toBeGreaterThan(1000);
  });

  it('item-cancel ve order-cancel varyantları THROW etmez', () => {
    expect(() => renderCancelReceipt(baseParams())).not.toThrow();
    expect(() =>
      renderCancelReceipt(baseParams({ variant: 'order-cancel' })),
    ).not.toThrow();
  });

  it('dine_in "Bölge | Masa" ve takeaway PAKET yolu THROW etmez', () => {
    expect(() => renderCancelReceipt(baseParams())).not.toThrow();
    expect(() =>
      renderCancelReceipt(
        baseParams({ order_type: 'takeaway', table_label: null, area_label: null }),
      ),
    ).not.toThrow();
  });

  it('kalem: seçenek + Türkçe BÜYÜK not + null variant/garson yolu THROW etmez', () => {
    expect(() => renderCancelReceipt(baseParams())).not.toThrow();
    expect(() =>
      renderCancelReceipt(
        baseParams({
          server_name: null,
          items: [
            { name: 'Kıymalı Ğğ — test', qty: 1, variantName: null, modifiers: [], note: null },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('order-cancel çok-kalem listesi + ham kontrol baytı THROW etmez', () => {
    const out = renderCancelReceipt(
      baseParams({
        variant: 'order-cancel',
        items: [
          { name: 'Lahmacun\x1b@', qty: 3, variantName: null, modifiers: [], note: 'kes\x1d\x56\x42' },
          { name: 'Ayran', qty: 2, variantName: null, modifiers: [], note: null },
        ],
      }),
    );
    expect(out).toBeInstanceOf(Uint8Array);
    // Zarf sözleşmesi: son 4 bayt CUT (enjeksiyon ayrı komut üretmez — raster payload).
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
    expect(Array.from(out.subarray(0, 2))).toEqual(ESC_AT);
    expect(Array.from(out.subarray(6, 9))).toEqual(GS_V0);
  });
});
