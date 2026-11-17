import { describe, expect, it } from 'vitest';
import { DEFAULT_TAIL_FEED_LINES } from '../raster/raster-encode.js';
import { renderPackingReceipt, type PackingReceiptParams } from './packing-receipt.js';
import { PACKING_SCENARIOS } from './receipt-golden-scenarios.js';

/**
 * Paket fişi (ADR-032 Amd3 K4) — yapısal zarf testleri.
 *
 * ADR-045 PR-1'den önce bu şablonun HİÇ testi yoktu. Çıktı bitmap olduğu için
 * bayt içeriği değil sözleşme sınanır: ESC @ + buzzer + GS v 0 + varsayılan
 * kuyruk beslemesi + CUT (kasa yazıcısının kesicisi var → mutfağın koparma
 * payı KULLANILMAZ). İçeriğin kendisi `receipt-golden.test.ts`'in çizim
 * kaydıyla çivili.
 */

const ESC_AT = [0x1b, 0x40];
const BUZZER = [0x1b, 0x42, 0x03, 0x02];
const GS_V0 = [0x1d, 0x76, 0x30];
const DEFAULT_FEED = [0x1b, 0x64, DEFAULT_TAIL_FEED_LINES];
const CUT_FULL = [0x1d, 0x56, 0x42, 0x00];

function containsSub(hay: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function baseParams(overrides: Partial<PackingReceiptParams> = {}): PackingReceiptParams {
  return { ...PACKING_SCENARIOS['packing-delivery-full-customer']!, ...overrides };
}

describe('renderPackingReceipt (raster; ADR-032 Amd3 K4)', () => {
  it('ESC @ + buzzer + GS v 0 zarfıyla açılır, varsayılan besleme + CUT_FULL ile biter', () => {
    const out = renderPackingReceipt(baseParams());
    expect(Array.from(out.subarray(0, 2))).toEqual(ESC_AT);
    expect(Array.from(out.subarray(2, 6))).toEqual(BUZZER);
    expect(Array.from(out.subarray(6, 9))).toEqual(GS_V0);
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
    expect(containsSub(out, DEFAULT_FEED)).toBe(true);
  });

  it('makul boyutta non-empty bitmap üretir', () => {
    const out = renderPackingReceipt(baseParams());
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(1000);
  });

  it('müşterisiz paket (tüm müşteri alanları null) THROW etmez', () => {
    expect(() =>
      renderPackingReceipt(PACKING_SCENARIOS['packing-takeaway-no-customer']!),
    ).not.toThrow();
  });

  it('Türkçe glyph + ₺ + uzun adres (wrap) + boş liste ile THROW etmez', () => {
    expect(() =>
      renderPackingReceipt(
        baseParams({
          delivery_address:
            'Çok Uzun Mahalle Adı Mahallesi Şehit Öğretmen İsmail Ğündüz Caddesi No: 123/45 Daire: 6',
          items: [
            {
              name: 'Çiğ Köfte Ğ ş/ı/İ Ekstra Uzun Ürün Adı Kaşarlı',
              qty: 2,
              variantName: 'Bir buçuk',
              lineTotalCents: 99000,
              modifiers: ['ekstra kaşar', 'ince hamur'],
              note: 'az acılı',
            },
          ],
        }),
      ),
    ).not.toThrow();
    expect(() => renderPackingReceipt(baseParams({ items: [] }))).not.toThrow();
  });

  it('tüm paket kanalları ve ödeme türleri ile THROW etmez', () => {
    for (const order_type of ['takeaway', 'delivery'] as const) {
      for (const planned_payment_type of ['cash', 'card', 'transfer', null] as const) {
        expect(() =>
          renderPackingReceipt(baseParams({ order_type, planned_payment_type })),
        ).not.toThrow();
      }
    }
  });
});
