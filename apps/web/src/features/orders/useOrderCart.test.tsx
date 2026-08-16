/**
 * @vitest-environment jsdom
 *
 * ADR-013 Amendment 6 — katalog-tap ilave seed davranışı.
 * @testing-library/react bu workspace'te yok; hook createRoot + act ile
 * (mevcut order-screen-route-remount.test.tsx deseni) bir sonda üzerinden
 * sürülür.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useOrderCart, type UseOrderCartReturn } from './useOrderCart';
import type { ApiProduct } from '../admin/menu-products/api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const product: ApiProduct = {
  id: 'prod-1',
  tenantId: 't1',
  categoryId: 'c1',
  name: 'IZGARA KÖFTE',
  priceCents: 10000,
  description: null,
  barcode: null,
  isActive: true,
  sortOrder: 0,
  variants: [
    { id: 'v-tam', productId: 'prod-1', name: 'Tam', priceDeltaCents: 0, isDefault: true, sortOrder: 0 },
    { id: 'v-15', productId: 'prod-1', name: '1,5', priceDeltaCents: 5000, isDefault: false, sortOrder: 1 },
  ],
};

const variant15 = { variantId: 'v-15', variantName: '1,5', priceDeltaCents: 5000 };

let container: HTMLDivElement;
let root: Root;
let cart: UseOrderCartReturn;

function Probe(): null {
  cart = useOrderCart();
  return null;
}

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useOrderCart.addItem — Amendment 6 seed', () => {
  it('inherit YOK → default (Tam) varyant, katalog fiyatı', () => {
    act(() => cart.addItem(product));
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.variant?.variantId).toBe('v-tam');
    expect(cart.items[0]?.unitPriceCents).toBe(10000);
    expect(cart.items[0]?.selectedAttributes).toEqual([]);
  });

  it('(a) inherit 1.5 → yeni satır 1.5, fiyat = base + delta', () => {
    act(() =>
      cart.addItem(product, {
        inheritFrom: { variant: variant15, selectedAttributes: [] },
      }),
    );
    expect(cart.items[0]?.variant).toEqual(variant15);
    expect(cart.items[0]?.unitPriceCents).toBe(15000);
  });

  it('K3 — özellikli miras: fiyat base + variantDelta + Σ extra', () => {
    act(() =>
      cart.addItem(product, {
        inheritFrom: {
          variant: variant15,
          selectedAttributes: [
            { groupId: 'g1', optionId: 'o1', groupName: 'Acı', optionName: 'Az acı', extraPriceCents: 250 },
          ],
        },
      }),
    );
    expect(cart.items[0]?.unitPriceCents).toBe(15250);
    expect(cart.items[0]?.selectedAttributes).toHaveLength(1);
  });

  it('(d) override miras ALINMAZ — varyant miras alınsa da override null', () => {
    act(() =>
      cart.addItem(product, {
        inheritFrom: { variant: variant15, selectedAttributes: [] },
      }),
    );
    expect(cart.items[0]?.variant).toEqual(variant15);
    expect(cart.items[0]?.unitPriceOverrideCents).toBeNull();
  });

  it('(e) parti modeli — iki ilave = iki ayrı satır, ayrı rowId, merge YOK', () => {
    act(() => {
      cart.addItem(product, {
        inheritFrom: { variant: variant15, selectedAttributes: [] },
      });
    });
    act(() => {
      cart.addItem(product, {
        inheritFrom: { variant: variant15, selectedAttributes: [] },
      });
    });
    expect(cart.items).toHaveLength(2);
    expect(cart.items[0]?.rowId).not.toBe(cart.items[1]?.rowId);
    expect(cart.items[0]?.quantity).toBe(1);
    expect(cart.items[1]?.quantity).toBe(1);
  });
});
