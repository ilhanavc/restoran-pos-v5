/**
 * ADR-013 Amendment 6 — miras-kaynağı çözümleyicisi (K1/K2/K6).
 * Pure fonksiyon; React/DOM gerektirmez.
 */
import { describe, expect, it } from 'vitest';
import { resolveInheritedComposition } from './inheritComposition';
import type { CartItem } from './useOrderCart';
import type { ApiOrderItem, ApiOrderItemAttribute } from './api';

const PROD = 'prod-1';

function pending(overrides: Partial<CartItem> & Pick<CartItem, 'rowId'>): CartItem {
  return {
    productId: PROD,
    productName: 'IZGARA KÖFTE',
    productPriceCents: 10000,
    unitPriceCents: 10000,
    unitPriceOverrideCents: null,
    quantity: 1,
    selectedAttributes: [],
    variant: null,
    note: null,
    ...overrides,
  };
}

function persisted(
  overrides: Partial<ApiOrderItem> & Pick<ApiOrderItem, 'id' | 'created_at'>,
): ApiOrderItem {
  return {
    tenant_id: 't1',
    order_id: 'o1',
    product_id: PROD,
    product_name: 'IZGARA KÖFTE',
    category_name_snapshot: 'Izgara',
    unit_price_cents: 10000,
    quantity: 1,
    total_cents: 10000,
    is_comped: false,
    note: null,
    status: 'new',
    created_by_user_id: null,
    created_by_name: null,
    attributes: [],
    variant_id_snapshot: null,
    variant_name_snapshot: null,
    variant_price_delta_cents_snapshot: null,
    ...overrides,
  };
}

const variant15 = { variantId: 'v-15', variantName: '1,5', priceDeltaCents: 5000 };

const attr: ApiOrderItemAttribute = {
  id: 'a1',
  order_item_id: 'x',
  attribute_group_id: 'g1',
  attribute_option_id: 'o1',
  group_name_snapshot: 'Acı',
  option_name_snapshot: 'Az acı',
  extra_price_cents_snapshot: 250,
};

describe('resolveInheritedComposition', () => {
  it('(a) eşleşen pending 1.5 satır → o varyantı miras verir', () => {
    const result = resolveInheritedComposition(
      PROD,
      [pending({ rowId: 'line-1', variant: variant15 })],
      [],
    );
    expect(result?.variant).toEqual(variant15);
    expect(result?.selectedAttributes).toEqual([]);
  });

  it('(b) eşleşen persisted 1.5 satır → snapshot varyant + özellik miras', () => {
    const result = resolveInheritedComposition(PROD, [], [
      persisted({
        id: 'p1',
        created_at: '2026-08-16T10:00:00Z',
        variant_id_snapshot: 'v-15',
        variant_name_snapshot: '1,5',
        variant_price_delta_cents_snapshot: 5000,
        attributes: [attr],
      }),
    ]);
    expect(result?.variant).toEqual(variant15);
    expect(result?.selectedAttributes).toEqual([
      {
        groupId: 'g1',
        optionId: 'o1',
        groupName: 'Acı',
        optionName: 'Az acı',
        extraPriceCents: 250,
      },
    ]);
  });

  it('(c) hiç eşleşen yok → null (çağıran default davranışa düşer)', () => {
    expect(resolveInheritedComposition('prod-yok', [], [])).toBeNull();
    expect(
      resolveInheritedComposition(
        PROD,
        [pending({ rowId: 'line-1', productId: 'other' })],
        [persisted({ id: 'p1', created_at: '2026-08-16T10:00:00Z', product_id: 'other' })],
      ),
    ).toBeNull();
  });

  it('K1 — pending, persisted üzerinde önceliklidir (aynı oturum niyeti)', () => {
    const result = resolveInheritedComposition(
      PROD,
      [pending({ rowId: 'line-1', variant: null })], // pending: standart
      [
        persisted({
          id: 'p1',
          created_at: '2026-08-16T10:00:00Z',
          variant_id_snapshot: 'v-15',
          variant_name_snapshot: '1,5',
          variant_price_delta_cents_snapshot: 5000,
        }),
      ],
    );
    expect(result?.variant).toBeNull();
  });

  it('K2 — çoklu pending: en yüksek rowId (en son oluşturulan) kazanır', () => {
    const result = resolveInheritedComposition(
      PROD,
      [
        pending({ rowId: 'line-1', variant: null }),
        pending({ rowId: 'line-3', variant: variant15 }),
        pending({ rowId: 'line-2', variant: null }),
      ],
      [],
    );
    expect(result?.variant).toEqual(variant15);
  });

  it('K2 — çoklu persisted: en yeni created_at kazanır', () => {
    const result = resolveInheritedComposition(PROD, [], [
      persisted({ id: 'p1', created_at: '2026-08-16T09:00:00Z' }),
      persisted({
        id: 'p2',
        created_at: '2026-08-16T11:00:00Z',
        variant_id_snapshot: 'v-15',
        variant_name_snapshot: '1,5',
        variant_price_delta_cents_snapshot: 5000,
      }),
    ]);
    expect(result?.variant).toEqual(variant15);
  });

  it('cancelled persisted satır miras kaynağı OLAMAZ', () => {
    const result = resolveInheritedComposition(PROD, [], [
      persisted({
        id: 'p1',
        created_at: '2026-08-16T11:00:00Z',
        status: 'cancelled',
        variant_id_snapshot: 'v-15',
        variant_name_snapshot: '1,5',
        variant_price_delta_cents_snapshot: 5000,
      }),
    ]);
    expect(result).toBeNull();
  });
});
