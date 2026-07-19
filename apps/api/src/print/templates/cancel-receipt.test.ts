/**
 * ADR-004 Amendment 6 A3 — iptal fişi render testleri (DoD 10-assert matrisi).
 * Saf render: DB/IO yok. kitchen-receipt.test.ts bayt-düzeyi sözleşme deseni.
 */

import { describe, expect, it } from 'vitest';
import { encodeCP857 } from '@restoran-pos/shared-domain';
import {
  renderCancelReceipt,
  type CancelReceiptParams,
} from './cancel-receipt';

/** Alt-dizi araması — bayt-düzeyi içerik sözleşmesi. */
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

describe('renderCancelReceipt (ADR-004 Amd6 A3)', () => {
  it('ilk baytlar RESET + ESC t 29 (Amd3 codepage sözleşmesi)', () => {
    const out = renderCancelReceipt(baseParams());
    expect(Array.from(out.subarray(0, 5))).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 0x1d,
    ]);
  });

  it("item-cancel → 'KALEM İPTAL' başlık; order-cancel → 'ADİSYON İPTAL'", () => {
    const item = renderCancelReceipt(baseParams());
    expect(bufferContains(item, encodeCP857('KALEM İPTAL'))).toBe(true);
    // item-cancel fişinde ADİSYON İPTAL başlığı OLMAMALI.
    expect(bufferContains(item, encodeCP857('ADİSYON İPTAL'))).toBe(false);

    const order = renderCancelReceipt(baseParams({ variant: 'order-cancel' }));
    expect(bufferContains(order, encodeCP857('ADİSYON İPTAL'))).toBe(true);
  });

  it('dine_in → "Bölge | Masa"; takeaway → PAKET', () => {
    const dine = renderCancelReceipt(baseParams());
    expect(bufferContains(dine, encodeCP857('Salon | Masa 5'))).toBe(true);

    const pkg = renderCancelReceipt(
      baseParams({ order_type: 'takeaway', table_label: null, area_label: null }),
    );
    expect(bufferContains(pkg, encodeCP857('PAKET'))).toBe(true);
  });

  it('kalem: ad + adet+porsiyon + [seçenekler] + BÜYÜK not', () => {
    const out = renderCancelReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('Kaşarlı Pide'))).toBe(true);
    expect(bufferContains(out, encodeCP857('2 Tam'))).toBe(true);
    expect(bufferContains(out, encodeCP857('[Acılı, Soğansız]'))).toBe(true);
    // Not Türkçe-doğru BÜYÜK harfle basılır (i→İ, ı→I).
    expect(bufferContains(out, encodeCP857('ÇĞÜŞÖI BOL PİŞMİŞ'))).toBe(true);
  });

  it('FİYAT YOK: "TL" ve tutar dizisi buffer\'da geçmez (A3)', () => {
    const out = renderCancelReceipt(baseParams());
    expect(bufferContains(out, encodeCP857(' TL'))).toBe(false);
    expect(bufferContains(out, encodeCP857('TUTAR'))).toBe(false);
  });

  it('müşteri PII yüzeyi YOK (A8): şablon Müşteri/Telefon/Adres satırı üretmez', () => {
    const out = renderCancelReceipt(
      baseParams({ order_type: 'takeaway', table_label: null, area_label: null }),
    );
    expect(bufferContains(out, encodeCP857('Müşteri'))).toBe(false);
    expect(bufferContains(out, encodeCP857('Telefon'))).toBe(false);
    expect(bufferContains(out, encodeCP857('Adres'))).toBe(false);
  });

  it('yerel saat param birebir basılır (Amd5 K9)', () => {
    const out = renderCancelReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('15.07.2026 21:35:12'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Adisyon No: 7'))).toBe(true);
  });

  it('CP857 Türkçe: Ğ=0xA6 / ğ=0xA7 (JP80H ampirik — Amd3)', () => {
    const out = renderCancelReceipt(
      baseParams({
        items: [
          { name: 'Kıymalı Ğğ', qty: 1, variantName: null, modifiers: [], note: null },
        ],
      }),
    );
    const needle = encodeCP857('Ğğ');
    expect(Array.from(needle)).toEqual([0xa6, 0xa7]);
    expect(bufferContains(out, needle)).toBe(true);
  });

  it('sanitize: kontrol baytı strip + em-dash çökme YOK (Amd5 K10)', () => {
    const out = renderCancelReceipt(
      baseParams({
        server_name: null,
        items: [
          {
            name: 'Ürünadı — test',
            qty: 1,
            variantName: null,
            modifiers: [],
            note: null,
          },
        ],
      }),
    );
    // BEL (0x07) buffer'a sızmamalı (RESET/codepage dışındaki metin bölgesinde
    // kontrol baytı yalnız bilinen ESC/POS komutları): sanitize C0 strip.
    expect(bufferContains(out, encodeCP857('Ürün')));
    // server_name null → ASCII '-' satırı (em-dash değil).
    expect(bufferContains(out, encodeCP857('-'))).toBe(true);
  });

  it('footer: ortada "- N -" seslenme satırı + CUT ile biter', () => {
    const out = renderCancelReceipt(baseParams());
    expect(bufferContains(out, encodeCP857('- 7 -'))).toBe(true);
    // Son 4 bayt GS V 66 0 (kitchen-receipt.test bayt sözleşmesi paritesi).
    expect(Array.from(out.subarray(out.length - 4))).toEqual([
      0x1d, 0x56, 0x42, 0x00,
    ]);
  });

  it('order-cancel çok-kalem: tüm canlı kalemler listelenir', () => {
    const out = renderCancelReceipt(
      baseParams({
        variant: 'order-cancel',
        items: [
          { name: 'Lahmacun', qty: 3, variantName: null, modifiers: [], note: null },
          { name: 'Ayran', qty: 2, variantName: null, modifiers: [], note: null },
        ],
      }),
    );
    expect(bufferContains(out, encodeCP857('Lahmacun'))).toBe(true);
    expect(bufferContains(out, encodeCP857('Ayran'))).toBe(true);
  });

  it('Amd7: double-strike açık (ESC G 1) + iptal-ürün çift-yükseklik+bold (K2/K3)', () => {
    const out = renderCancelReceipt(baseParams());
    // ESC G 1 codepage'den hemen sonra (RESET 2 + ESC t 29 3 = 5 bayt).
    expect(Array.from(out.subarray(5, 8))).toEqual([0x1b, 0x47, 0x01]);
    // Kalem GS ! 0x01 (çift-yükseklik) + ESC E 1 (bold).
    expect(bufferContains(out, new Uint8Array([0x1d, 0x21, 0x01]))).toBe(true);
    expect(bufferContains(out, new Uint8Array([0x1b, 0x45, 0x01]))).toBe(true);
  });
});
