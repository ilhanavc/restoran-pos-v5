/**
 * ADR-004 Amendment 6 A3 + Amendment 9 — iptal fişi RASTER render testleri.
 * Yapısal zarf sözleşmesi (ESC @ + buzzer + GS v 0 + CUT) + render-smoke
 * (varyantlar/Türkçe/PAKET/enjeksiyon THROW etmez). Text-mode byte-içerik
 * assert'leri emekli (K7).
 *
 * ADR-004 Amendment 12 — iptal fişi buzzer'ı 5 bip'e çıktı (diğer fiş
 * türleri 3'te kalır, bkz. raster-encode.test.ts wrapPrintJob testleri).
 */

import { describe, expect, it } from 'vitest';
import {
  renderCancelReceipt,
  type CancelReceiptParams,
} from './cancel-receipt';

const ESC_AT = [0x1b, 0x40];
const BUZZER_CANCEL = [0x1b, 0x42, 0x05, 0x02];
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
    customer_name: null,
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
  it('ESC @ + buzzer(Amd12: 5 bip) + GS v 0 açar, CUT_FULL ile biter', () => {
    const out = renderCancelReceipt(baseParams());
    expect(Array.from(out.subarray(0, 2))).toEqual(ESC_AT);
    expect(Array.from(out.subarray(2, 6))).toEqual(BUZZER_CANCEL);
    expect(Array.from(out.subarray(6, 9))).toEqual(GS_V0);
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
    expect(out.length).toBeGreaterThan(1000);
  });

  it('ADR-004 Amd10 K2 — X ikonu eklendi, çıktı büyür ve THROW etmez', () => {
    const out = renderCancelReceipt(baseParams());
    expect(out.length).toBeGreaterThan(0);
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
  });

  describe('ADR-004 Amendment 11 — iptal fişinde müşteri adı (K1/K3)', () => {
    it('takeaway + müşteri adı doluysa çıktı büyür (satır eklenir), THROW etmez', () => {
      const without = renderCancelReceipt(
        baseParams({ order_type: 'takeaway', table_label: null, area_label: null }),
      );
      const withName = renderCancelReceipt(
        baseParams({
          order_type: 'takeaway',
          table_label: null,
          area_label: null,
          customer_name: 'İlhan Avcı',
        }),
      );
      expect(withName.length).toBeGreaterThan(without.length);
      expect(Array.from(withName.subarray(withName.length - 4))).toEqual(CUT_FULL);
    });

    it('takeaway + customer_name null → çökmez (müşterisiz manuel paket)', () => {
      expect(() =>
        renderCancelReceipt(
          baseParams({ order_type: 'takeaway', table_label: null, area_label: null, customer_name: null }),
        ),
      ).not.toThrow();
    });

    it('dine_in + customer_name doluysa bile satır BASILMAZ (K1 — dine_in DEĞİŞMEZ)', () => {
      const withoutName = renderCancelReceipt(baseParams());
      const withNameIgnored = renderCancelReceipt(
        baseParams({ customer_name: 'İlhan Avcı' }),
      );
      expect(withNameIgnored.length).toBe(withoutName.length);
    });
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
