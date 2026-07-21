import { describe, expect, it } from 'vitest';
import { renderBillReceipt, type BillReceiptParams } from './bill-receipt.js';
import { ESC_POS } from '@restoran-pos/shared-domain';
import { DEFAULT_TAIL_FEED_LINES } from '../raster/raster-encode.js';

/**
 * ADR-004 Amendment 9 — customer bill (adisyon) RASTER render testleri.
 * Pure function, no DB. Text-mode byte-içerik assert'leri artık GEÇERSİZ
 * (çıktı bitmap); yapısal sözleşme: ESC @ + buzzer + GS v 0 + CUT zarfı (K7),
 * + render Türkçe/₺/uzun-ad/boş-liste/enjeksiyon ile THROW etmez.
 */

// wrapPrintJob zarfı: RESET(2) + buzzer(4) + raster(GS v 0 ...) + varsayılan feed + CUT.
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

function baseParams(
  overrides: Partial<BillReceiptParams> = {},
): BillReceiptParams {
  return {
    tenant_header: 'Pide Salonu',
    order_no: 42,
    order_type: 'dine_in',
    server_name: 'İlhan',
    table_label: 'Masa 5',
    area_label: null,
    items: [
      { name: 'Kıymalı Pide', qty: 2, lineTotalCents: 36000, note: null, modifiers: [] },
      { name: 'Ayran', qty: 1, lineTotalCents: 2500, note: null, modifiers: [] },
    ],
    totalCents: 38500,
    payments: [],
    paidTotalCents: 0,
    remainingCents: 38500,
    created_at_local: '29.06.2026  20:30',
    ...overrides,
  };
}

describe('renderBillReceipt (raster; ADR-004 Amd9)', () => {
  it('ESC @ + buzzer(Amd8) + GS v 0 zarfıyla açılır, CUT_FULL ile biter', () => {
    const out = renderBillReceipt(baseParams());
    expect(Array.from(out.subarray(0, 2))).toEqual(ESC_AT);
    expect(Array.from(out.subarray(2, 6))).toEqual(BUZZER); // Amd8 buzzer KORUNUR
    expect(Array.from(out.subarray(6, 9))).toEqual(GS_V0); // raster bitmap
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
    expect(containsSub(out, DEFAULT_FEED)).toBe(true);
  });

  it('geriye-dönük imza: 2. codepage argümanı kabul edilir (raster\'da yok sayılır)', () => {
    // enqueueBillJob pozisyonel geçer; render aynı zarfı üretir (codepage etkisiz).
    const out = renderBillReceipt(baseParams(), ESC_POS.CODEPAGE_CP857_PAGE61);
    expect(Array.from(out.subarray(0, 2))).toEqual(ESC_AT);
    expect(containsSub(out, GS_V0)).toBe(true);
  });

  it('makul boyutta non-empty bitmap üretir', () => {
    const out = renderBillReceipt(baseParams());
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(1000); // raster ~onlarca KB
  });

  it('Türkçe glyph + ₺ (TUTAR) ile THROW etmez', () => {
    expect(() =>
      renderBillReceipt(
        baseParams({
          items: [
            { name: 'Çiğ Köfte Ğ ş/ı/İ', qty: 1, lineTotalCents: 5000, note: null, modifiers: [] },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('uzun ürün adı (wrap) + boş liste ile THROW etmez', () => {
    expect(() =>
      renderBillReceipt(
        baseParams({
          items: [
            {
              name: 'Çok Uzun İsimli Ekstra Kaşarlı Kıymalı Yumurtalı Special Pide Porsiyon',
              qty: 3,
              lineTotalCents: 99000,
              note: 'az acılı olsun lütfen',
              modifiers: ['ekstra kaşar', 'ince hamur'],
            },
          ],
        }),
      ),
    ).not.toThrow();
    expect(() => renderBillReceipt(baseParams({ items: [] }))).not.toThrow();
  });

  it('tüm order_type + PAKET + null garson ile THROW etmez', () => {
    for (const order_type of ['dine_in', 'takeaway', 'delivery'] as const) {
      expect(() => renderBillReceipt(baseParams({ order_type }))).not.toThrow();
    }
    expect(() =>
      renderBillReceipt(baseParams({ table_label: null, area_label: 'Bahçe' })),
    ).not.toThrow();
    expect(() => renderBillReceipt(baseParams({ server_name: null }))).not.toThrow();
    expect(() =>
      renderBillReceipt(baseParams({ table_label: 'Masa 2', area_label: 'Bahçe' })),
    ).not.toThrow();
  });

  it('parçalı/çok-türlü ödeme dökümü (payments.length > 1) ile THROW etmez', () => {
    expect(() =>
      renderBillReceipt(
        baseParams({
          payments: [
            { type: 'card', amountCents: 30000 },
            { type: 'cash', amountCents: 8500 },
          ],
          paidTotalCents: 38500,
          remainingCents: 0,
        }),
      ),
    ).not.toThrow();
  });

  it('serbest-metindeki ham kontrol baytları bitmap\'e çizilir, komut ENJEKTE ETMEZ', () => {
    // Raster'da metin piksel olur; kontrol baytı yazıcı komutu olarak yorumlanamaz
    // (yalnız GS v 0 payload'u var). Yine de render çökmemeli.
    const out = renderBillReceipt(
      baseParams({
        items: [
          {
            name: `Pide${String.fromCharCode(0x1b)}Q`,
            qty: 1,
            lineTotalCents: 5000,
            note: `a${String.fromCharCode(0x1d)}b`,
            modifiers: [`x${String.fromCharCode(0x00)}y`],
          },
        ],
      }),
    );
    expect(out).toBeInstanceOf(Uint8Array);
    // CUT yalnız sonda (zarf); kontrol-bayt enjeksiyonu ayrı bir CUT üretmez —
    // GS v 0 payload'u içinde 0x1d 0x56 0x42 0x00 dizisi rastlantısal geçebilir
    // ama yapısal sözleşme sadece SON 4 baytın CUT olmasıdır.
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
  });
});
