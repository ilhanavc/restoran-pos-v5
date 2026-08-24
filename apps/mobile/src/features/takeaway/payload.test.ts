import { describe, expect, it } from 'vitest';

import type { CartLine } from '../orders/cart';
import {
  buildTakeawayItems,
  canSubmitTakeaway,
  primaryPhoneOf,
} from './payload';

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    rowId: 'line-1',
    productId: 'p-1',
    productName: 'Kusbasili Pide',
    variantId: null,
    variantName: null,
    unitPriceCents: 14000,
    unitPriceOverrideCents: null,
    selectedAttributes: [],
    note: null,
    quantity: 1,
    ...overrides,
  };
}

/**
 * ADR-039 DoD 23 — "müşteri seçilmeden Kaydet MÜMKÜN DEĞİL" (UI hattı).
 * Sunucu hattını `orders_takeaway_customer_required` DB CHECK'i korur; bu
 * ikinci hat, garsonu sepeti doldurduktan sonra duvara toslatmamak içindir.
 */
describe('canSubmitTakeaway (ADR-039 K5)', () => {
  it('üç koşul sağlanınca kaydedilebilir', () => {
    expect(
      canSubmitTakeaway({
        customerId: 'c-1',
        plannedPaymentType: 'cash',
        lineCount: 2,
      }),
    ).toBe(true);
  });

  it('MÜŞTERİ yokken kaydedilemez (DB CHECK ikinci hattı)', () => {
    expect(
      canSubmitTakeaway({
        customerId: null,
        plannedPaymentType: 'cash',
        lineCount: 2,
      }),
    ).toBe(false);
  });

  it('sepet boşken kaydedilemez (sunucu items.min(1))', () => {
    expect(
      canSubmitTakeaway({
        customerId: 'c-1',
        plannedPaymentType: 'cash',
        lineCount: 0,
      }),
    ).toBe(false);
  });

  it('ödeme tipi planlanmadan kaydedilemez (ADR-017 NOT NULL)', () => {
    expect(
      canSubmitTakeaway({
        customerId: 'c-1',
        plannedPaymentType: null,
        lineCount: 2,
      }),
    ).toBe(false);
  });
});

/**
 * Kalem eşlemesi `OrderScreen`'in dine_in eşleyicisiyle AYNI kuralları taşımalı
 * (K5 adım 3 / E alternatifi): opsiyonel alanlar yalnız doluyken gönderilir.
 */
describe('buildTakeawayItems (ADR-039 K1)', () => {
  it('sade satır yalnız productId + quantity gönderir', () => {
    expect(buildTakeawayItems([line({ quantity: 3 })])).toEqual([
      { productId: 'p-1', quantity: 3 },
    ]);
  });

  it('porsiyon/not/özellik yalnız DOLUYKEN eklenir', () => {
    const result = buildTakeawayItems([
      line({
        variantId: 'v-1',
        note: 'az acili',
        selectedAttributes: [
          {
            groupId: 'g-1',
            optionId: 'o-1',
            optionName: 'Ekstra kasar',
            extraPriceCents: 2500,
          },
        ],
      }),
    ]);
    expect(result[0]).toEqual({
      productId: 'p-1',
      quantity: 1,
      variantId: 'v-1',
      note: 'az acili',
      selectedAttributes: [{ groupId: 'g-1', optionId: 'o-1' }],
    });
    // Özellik ADI ve fiyatı GÖNDERİLMEZ — fiyat otoritesi sunucudadır.
    expect(result[0]).not.toHaveProperty('unitPriceOverrideCents');
  });

  it('fiyat override yalnız kullanıcı elle yazdıysa gider (ADR-013 Amd5 K1)', () => {
    const withOverride = buildTakeawayItems([
      line({ unitPriceOverrideCents: 9900 }),
    ]);
    expect(withOverride[0]).toHaveProperty('unitPriceOverrideCents', 9900);

    const withoutOverride = buildTakeawayItems([line()]);
    expect(withoutOverride[0]).not.toHaveProperty('unitPriceOverrideCents');
  });

  it('aynı içerikli iki satır BİRLEŞTİRİLMEZ (parti modeli)', () => {
    const result = buildTakeawayItems([
      line({ rowId: 'line-1', quantity: 1 }),
      line({ rowId: 'line-2', quantity: 3 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.quantity)).toEqual([1, 3]);
  });
});

describe('primaryPhoneOf', () => {
  it('birincil işaretli numarayı seçer', () => {
    expect(
      primaryPhoneOf([
        { rawPhone: '0532 111 11 11', isPrimary: false },
        { rawPhone: '0532 222 22 22', isPrimary: true },
      ]),
    ).toBe('0532 222 22 22');
  });

  it('birincil yoksa ilk numaraya düşer', () => {
    expect(
      primaryPhoneOf([{ rawPhone: '0532 333 33 33', isPrimary: false }]),
    ).toBe('0532 333 33 33');
  });

  it('telefon yoksa null', () => {
    expect(primaryPhoneOf([])).toBeNull();
  });
});
