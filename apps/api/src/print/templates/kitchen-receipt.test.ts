import { describe, expect, it } from 'vitest';
import {
  renderKitchenReceipt,
  type KitchenReceiptItem,
  type KitchenReceiptParams,
} from './kitchen-receipt.js';

/**
 * ADR-004 §7 + Amendment 5 + Amendment 9 — kitchen receipt RASTER render testleri.
 * İki yerleşim (dine_in → A, takeaway/delivery → B). Yapısal zarf sözleşmesi
 * (ESC @ + buzzer + GS v 0 + CUT) + render-smoke (Türkçe/uzun-adres/boş-müşteri/
 * enjeksiyon THROW etmez). Text-mode byte-içerik assert'leri emekli (K7).
 */

const ESC_AT = [0x1b, 0x40];
const BUZZER = [0x1b, 0x42, 0x03, 0x02];
const GS_V0 = [0x1d, 0x76, 0x30];
const CUT_FULL = [0x1d, 0x56, 0x42, 0x00];

function makeItem(overrides: Partial<KitchenReceiptItem> = {}): KitchenReceiptItem {
  return {
    name: 'Karışık Pide',
    qty: 5,
    variantName: 'Tam',
    lineTotalCents: 190000,
    modifiers: [],
    note: null,
    ...overrides,
  };
}

function baseParams(
  overrides: Partial<KitchenReceiptParams> = {},
): KitchenReceiptParams {
  return {
    order_type: 'dine_in',
    tenant_header: 'Dilan Pide',
    order_no: 109,
    table_label: 'Masa 5',
    area_label: 'Salon',
    server_name: 'İlhan',
    created_at_local: '10.07.2026 15:00:14',
    items: [makeItem()],
    customer_name: null,
    customer_phone: null,
    delivery_address: null,
    delivery_note: null,
    planned_payment_type: null,
    total_cents: 190000,
    ...overrides,
  };
}

function paketParams(
  overrides: Partial<KitchenReceiptParams> = {},
): KitchenReceiptParams {
  return baseParams({
    order_type: 'delivery',
    table_label: null,
    area_label: null,
    customer_name: 'İlhan Avcı',
    customer_phone: '5398400856',
    delivery_address: 'Mürefte Şarköy, Mürefte Köyü İç Yolu, No 1 Kat 2',
    delivery_note: 'ÇATAL-BIÇAK GÖNDERMEYİN',
    planned_payment_type: 'cash',
    total_cents: 143000,
    ...overrides,
  });
}

describe('renderKitchenReceipt — yapısal zarf (Amd9)', () => {
  it('her iki layout ESC @ + buzzer(Amd8) + GS v 0 açar, CUT_FULL ile biter', () => {
    for (const params of [baseParams(), paketParams()]) {
      const out = renderKitchenReceipt(params);
      expect(Array.from(out.subarray(0, 2))).toEqual(ESC_AT);
      expect(Array.from(out.subarray(2, 6))).toEqual(BUZZER);
      expect(Array.from(out.subarray(6, 9))).toEqual(GS_V0);
      expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
      expect(out.length).toBeGreaterThan(1000);
    }
  });
});

describe('Layout A — masa (dine_in) render-smoke', () => {
  it('bölge|masa, null bölge, null garson, farklı order_no ile THROW etmez', () => {
    expect(() => renderKitchenReceipt(baseParams())).not.toThrow();
    expect(() => renderKitchenReceipt(baseParams({ area_label: null }))).not.toThrow();
    expect(() => renderKitchenReceipt(baseParams({ server_name: null }))).not.toThrow();
    expect(() =>
      renderKitchenReceipt(baseParams({ order_no: 111, table_label: null })),
    ).not.toThrow();
  });

  it('variant null (yalnız adet) + Türkçe ad ile THROW etmez', () => {
    expect(() =>
      renderKitchenReceipt(
        baseParams({ items: [makeItem({ variantName: null, qty: 3, name: 'Dağ Kekikli Boğaça' })] }),
      ),
    ).not.toThrow();
  });
});

describe('Layout B — paket (kurye) render-smoke', () => {
  it('tam müşteri bloğu + fiyatlı kalem + TUTAR ile THROW etmez', () => {
    expect(() => renderKitchenReceipt(paketParams())).not.toThrow();
  });

  it('müşteri/adres yokken (boş blok) çökmz — kalem+TUTAR yine çizilir', () => {
    expect(() =>
      renderKitchenReceipt(
        paketParams({
          customer_name: null,
          customer_phone: null,
          delivery_address: null,
          delivery_note: null,
          planned_payment_type: null,
        }),
      ),
    ).not.toThrow();
  });

  it('çok uzun adres (word-wrap) + uzun ad/variant ile THROW etmez', () => {
    expect(() =>
      renderKitchenReceipt(
        paketParams({
          delivery_address:
            'Mahalle Mürefte Şarköy Sokak Mürefte Köyü İç Yolu Apt avci No 1 Kat 2 Daire 3 Zil 4',
          items: [
            makeItem({
              name: 'Çok Uzun İsimli Kaşarlı Kıymalı Special Pide Porsiyon',
              variantName: 'Bir buçuk porsiyon',
              qty: 1,
            }),
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe('not + seçenek + sanitizasyon render-smoke (Amd9)', () => {
  it('Türkçe not BÜYÜK harf yolu (i→İ, ı→I) + seçenekler ile THROW etmez', () => {
    for (const params of [
      baseParams({ items: [makeItem({ note: 'az mercimek istiyor', modifiers: ['Yumurtalı', 'Acılı'] })] }),
      paketParams({ items: [makeItem({ note: 'soğansız — acısız', modifiers: ['Yumurtalı'] })] }),
    ]) {
      expect(() => renderKitchenReceipt(params)).not.toThrow();
    }
  });

  it('ham kontrol baytları + eşlenemez glyph (emoji) render\'ı çökertmez', () => {
    // Raster'da metin piksel olur → enjeksiyon imkânsız; font eksik glyph'i
    // yerine kutu/boş çizer ama THROW etmez.
    const out = renderKitchenReceipt(
      baseParams({
        items: [makeItem({ note: 'kes\x1d\x56\x42imi dene', name: 'Pizza 🍕 Pide\x1b@' })],
      }),
    );
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out.subarray(out.length - 4))).toEqual(CUT_FULL);
  });
});
