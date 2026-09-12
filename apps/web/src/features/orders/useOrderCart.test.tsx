/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useOrderCart, type UseOrderCartReturn } from './useOrderCart';
import type { ApiProduct, ApiProductVariant } from '../admin/menu-products/api';

/**
 * useOrderCart davranış testleri (DD TEST-1 — kritik "Order" ekranı sepet mantığı).
 *
 * Pure fiyat aritmetiği shared-domain'de zaten test'li (ADR-013 Amd6 / KOD-4);
 * bu test HOOK state davranışını kilitler: parti-modeli (her tık yeni satır),
 * kart-şeridi LIFO +/− (yalnız hızlı-ekleme satırları), subtotal toplama,
 * varyant/özellik fiyatı, fiyat-override'ın quick-add hedefi OLMAMASI (F2).
 *
 * Mevcut web test deseni: `react-dom/client createRoot` + `act` (jsdom),
 * @testing-library/react YOK — CustomerOrderHistory.test.tsx ile aynı.
 */

let variantSeq = 0;
function makeProduct(overrides: Partial<ApiProduct> = {}): ApiProduct {
  return {
    id: overrides.id ?? `p-${Math.random().toString(36).slice(2)}`,
    tenantId: 't1',
    categoryId: 'c1',
    name: overrides.name ?? 'Ürün',
    priceCents: overrides.priceCents ?? 1000,
    description: null,
    barcode: null,
    isActive: true,
    sortOrder: 0,
    variants: overrides.variants ?? [],
  };
}
function makeVariant(over: Partial<ApiProductVariant> = {}): ApiProductVariant {
  variantSeq += 1;
  return {
    id: over.id ?? `v-${variantSeq}`,
    productId: over.productId ?? 'p',
    name: over.name ?? 'Varyant',
    priceDeltaCents: over.priceDeltaCents ?? 0,
    isDefault: over.isDefault ?? false,
    sortOrder: over.sortOrder ?? 0,
  };
}

interface Harness {
  get: () => UseOrderCartReturn;
  run: (fn: (c: UseOrderCartReturn) => void) => void;
  unmount: () => void;
}

let roots: Root[] = [];
function renderCart(): Harness {
  let latest: UseOrderCartReturn | undefined;
  function Probe(): null {
    latest = useOrderCart();
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<Probe />);
  });
  const get = (): UseOrderCartReturn => {
    if (latest === undefined) throw new Error('hook not rendered');
    return latest;
  };
  return {
    get,
    run: (fn) => {
      act(() => {
        fn(get());
      });
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

afterEach(() => {
  for (const r of roots) {
    try {
      act(() => r.unmount());
    } catch {
      /* zaten unmount */
    }
  }
  roots = [];
});

describe('useOrderCart (DD TEST-1)', () => {
  it('başlangıçta boş: 0 satır, subtotal 0, dirty değil', () => {
    const h = renderCart();
    expect(h.get().items).toHaveLength(0);
    expect(h.get().subtotalCents).toBe(0);
    expect(h.get().isDirty).toBe(false);
  });

  it('addItem HER ZAMAN yeni satır açar (parti modeli), birleştirmez', () => {
    const h = renderCart();
    const p = makeProduct({ priceCents: 1000 });
    h.run((c) => c.addItem(p));
    h.run((c) => c.addItem(p));
    expect(h.get().items).toHaveLength(2);
    expect(h.get().items.every((it) => it.quantity === 1)).toBe(true);
    expect(h.get().subtotalCents).toBe(2000);
    expect(h.get().isDirty).toBe(true);
  });

  it('unitPriceCents = base + default varyant deltası', () => {
    const h = renderCart();
    const p = makeProduct({
      priceCents: 1000,
      variants: [
        makeVariant({ name: 'Küçük', priceDeltaCents: 0, isDefault: false }),
        makeVariant({ name: 'Büyük', priceDeltaCents: 500, isDefault: true }),
      ],
    });
    h.run((c) => c.addItem(p));
    expect(h.get().items[0]?.unitPriceCents).toBe(1500);
    expect(h.get().subtotalCents).toBe(1500);
  });

  it('incrementProduct: boşta yeni satır, sonra en yeni hızlı-ekleme satırını büyütür', () => {
    const h = renderCart();
    const p = makeProduct({ priceCents: 800 });
    h.run((c) => c.incrementProduct(p));
    expect(h.get().items).toHaveLength(1);
    h.run((c) => c.incrementProduct(p));
    expect(h.get().items).toHaveLength(1);
    expect(h.get().items[0]?.quantity).toBe(2);
    expect(h.get().subtotalCents).toBe(1600);
    expect(h.get().pendingQtyByProductId.get(p.id)).toBe(2);
  });

  it('decrementProduct: LIFO düşürür, 0e inince satırı siler', () => {
    const h = renderCart();
    const p = makeProduct({ priceCents: 500 });
    h.run((c) => c.incrementProduct(p));
    h.run((c) => c.incrementProduct(p));
    h.run((c) => c.decrementProduct(p));
    expect(h.get().items[0]?.quantity).toBe(1);
    h.run((c) => c.decrementProduct(p));
    expect(h.get().items).toHaveLength(0);
    expect(h.get().subtotalCents).toBe(0);
  });

  it('subtotal birden çok satır ve adet üzerinden toplanır', () => {
    const h = renderCart();
    const a = makeProduct({ id: 'A', priceCents: 1000 });
    const b = makeProduct({ id: 'B', priceCents: 250 });
    h.run((c) => c.addItem(a)); // 1000
    h.run((c) => c.incrementProduct(b)); // 250
    h.run((c) => c.incrementProduct(b)); // 500
    expect(h.get().subtotalCents).toBe(1500);
  });

  it('removeItem satırı kaldırır, clear tümünü boşaltır', () => {
    const h = renderCart();
    const p = makeProduct({ priceCents: 1000 });
    h.run((c) => c.addItem(p));
    const rowId = h.get().items[0]!.rowId;
    h.run((c) => c.removeItem(rowId));
    expect(h.get().items).toHaveLength(0);
    h.run((c) => c.addItem(p));
    h.run((c) => c.clear());
    expect(h.get().items).toHaveLength(0);
    expect(h.get().isDirty).toBe(false);
  });

  it('addItemDetailed özellik extra fiyatını unit fiyata katar', () => {
    const h = renderCart();
    const p = makeProduct({ priceCents: 1000 });
    h.run((c) =>
      c.addItemDetailed(p, {
        quantity: 1,
        variant: null,
        note: 'az pişmiş',
        selectedAttributes: [
          {
            groupId: 'g1',
            optionId: 'o1',
            groupName: 'Ekstra',
            optionName: 'Peynir',
            extraPriceCents: 300,
          },
        ],
        unitPriceOverrideCents: null,
      }),
    );
    expect(h.get().items[0]?.unitPriceCents).toBe(1300);
    expect(h.get().subtotalCents).toBe(1300);
  });

  it('fiyat-override subtotale yansır ve satır quick-add HEDEFİ DEĞİL (F2)', () => {
    const h = renderCart();
    const p = makeProduct({ id: 'P', priceCents: 1000 });
    // override'lı satır ekle (editItem ile bir hızlı-ekleme satırını özelleştir)
    h.run((c) => c.addItem(p));
    const rowId = h.get().items[0]!.rowId;
    h.run((c) =>
      c.editItem(rowId, p, {
        quantity: 1,
        variant: null,
        note: null,
        selectedAttributes: [],
        unitPriceOverrideCents: 700,
      }),
    );
    expect(h.get().subtotalCents).toBe(700);
    // incrementProduct override'lı satırı büyütmemeli → yeni satır açar
    h.run((c) => c.incrementProduct(p));
    expect(h.get().items).toHaveLength(2);
    expect(h.get().subtotalCents).toBe(700 + 1000);
  });
});
