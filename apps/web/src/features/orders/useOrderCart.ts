import { useCallback, useMemo, useRef, useState } from 'react';
import type { ApiProduct } from '../admin/menu-products/api';
import type { SelectedAttributeInput, TakeawayOrderItemInput } from './api';

/**
 * Pending sepet kalemi — Kaydet basılana kadar React state'inde tutulur
 * (ADR-013 §1: saf local state, sunucu draft yok). Snapshot alanları
 * (selectedAttributes, note) PR-6'da OrderProductDetailModal ile düzenlenir.
 *
 * `selectedAttributesExtraCents` UI ön-gösterim için (server otoritesi
 * ADR-013 §2 + PR-6a `applyAttributeSnapshot`); subtotal hesabı için
 * unitPriceCents = base + Σ extra.
 */
export interface CartAttributeSelection extends SelectedAttributeInput {
  /** UI ön-gösterim için snapshot — server yine kendi DB'sinden okuyup yazar. */
  groupName: string;
  optionName: string;
  extraPriceCents: number;
}

export interface CartVariantSelection {
  variantId: string;
  variantName: string;
  priceDeltaCents: number;
}

export interface CartItem {
  /** OPAK satır kimliği (`line-N`) — ADR-013 Amendment 2 K3. İçerikten
   *  türetilmez, birleştirme anahtarı DEĞİLDİR: aynı içerikli iki satır
   *  meşrudur (parti modeli). Sayaç sepetle aynı yaşam döngüsünde. */
  rowId: string;
  productId: string;
  productName: string;
  /** Base ürün fiyatı (kuruş). Σ extra + variantDelta eklendiğinde unitPriceCents üretilir. */
  productPriceCents: number;
  /** unitPriceCents = productPriceCents + variantDelta + Σ extraPriceCents */
  unitPriceCents: number;
  quantity: number;
  selectedAttributes: CartAttributeSelection[];
  variant: CartVariantSelection | null;
  note: string | null;
}

export interface CartItemEditPayload {
  selectedAttributes: CartAttributeSelection[];
  variant: CartVariantSelection | null;
  note: string | null;
  quantity: number;
}

export interface UseOrderCartReturn {
  items: CartItem[];
  /** Kart gövdesi tıklaması (ADR-013 §10.1 + Amendment 2 K1): modal yok, default
   *  varyant, 1 adet. **HER ZAMAN yeni satır açar** — birleştirme yapmaz. */
  addItem: (product: ApiProduct) => void;
  /** Kart şeridi "+" (Amd2 K2): o ürünün **en yeni hızlı-ekleme satırını**
   *  büyütür; öyle bir satır yoksa yeni satır açar. */
  incrementProduct: (product: ApiProduct) => void;
  /** Kart şeridi "−" (Amd2 K2): en yeni hızlı-ekleme satırından düşer (LIFO —
   *  "son ekleneni geri al"); 0'a inen satır silinir. */
  decrementProduct: (product: ApiProduct) => void;
  /** Modal "Onayla" — seçilen özellik + note + qty ile **yeni satır** ekler
   *  (Amd2 K5: birleştirme yok). */
  addItemDetailed: (product: ApiProduct, payload: CartItemEditPayload) => void;
  /** Modal "Onayla" mevcut pending satırı düzenliyorsa: **yalnız o satırı**
   *  günceller (Amd2 K4: çakışma-birleştirmesi kaldırıldı — aynı içerikli iki
   *  satır meşrudur). */
  editItem: (rowId: string, product: ApiProduct, payload: CartItemEditPayload) => void;
  incrementItem: (rowId: string) => void;
  decrementItem: (rowId: string) => void;
  removeItem: (rowId: string) => void;
  clear: () => void;
  pendingQtyByProductId: Map<string, number>;
  subtotalCents: number;
  isDirty: boolean;
  /** Takeaway POST /orders payload'u için sepet → API item dönüşümü
   *  (ADR-017 §Frontend). Dine-in akışı kendi snapshot/finalize hattını
   *  kullandığından bu yardımcıyı çağırmaz. */
  toApiItems: () => TakeawayOrderItemInput[];
}

function sumExtra(selected: ReadonlyArray<CartAttributeSelection>): number {
  return selected.reduce((acc, s) => acc + s.extraPriceCents, 0);
}

/** Kart tıklamasının ürettiği varsayılan varyant (is_default, yoksa ilk). */
function defaultVariantOf(product: ApiProduct): CartVariantSelection | null {
  const v = product.variants.find((it) => it.isDefault) ?? product.variants[0];
  return v === undefined
    ? null
    : {
        variantId: v.id,
        variantName: v.name,
        priceDeltaCents: v.priceDeltaCents,
      };
}

/**
 * "Hızlı-ekleme satırı" = kart tıklamasının ürettiği satır: varsayılan varyant,
 * özellik yok, not yok. Kart şeridindeki `+`/`−` yalnız BU satırları hedefler —
 * modalden özelleştirilmiş satırlar kart şeridinden değiştirilmez (Amd2 K2).
 */
function isQuickAddItem(item: CartItem, product: ApiProduct): boolean {
  return (
    item.productId === product.id &&
    (item.variant?.variantId ?? null) ===
      (defaultVariantOf(product)?.variantId ?? null) &&
    item.selectedAttributes.length === 0 &&
    item.note === null
  );
}

export function useOrderCart(): UseOrderCartReturn {
  const [items, setItems] = useState<CartItem[]>([]);
  // Opak satır kimliği sayacı (Amd2 K3): render'lar arası kalıcı, remount'ta
  // sepetle birlikte sıfırlanır — aynı yaşam döngüsü.
  const nextSeqRef = useRef(1);

  const makeRowId = useCallback((): string => {
    const rowId = `line-${nextSeqRef.current}`;
    nextSeqRef.current += 1;
    return rowId;
  }, []);

  /** Kart tıklamasının ürettiği satır — Karar 10.1: default varyant, modalsız. */
  const makeQuickAddItem = useCallback(
    (product: ApiProduct): CartItem => {
      const variant = defaultVariantOf(product);
      return {
        rowId: makeRowId(),
        productId: product.id,
        productName: product.name,
        productPriceCents: product.priceCents,
        unitPriceCents: product.priceCents + (variant?.priceDeltaCents ?? 0),
        quantity: 1,
        selectedAttributes: [],
        variant,
        note: null,
      };
    },
    [makeRowId],
  );

  const addItem = useCallback(
    (product: ApiProduct) => {
      // Kart gövdesi: HER ZAMAN yeni satır (parti modeli — ADR-013 Amd2 K1;
      // Adisyo fişindeki "Lahmacun 1 / 3 / 2" ayrı-satır davranışı).
      setItems((prev) => [...prev, makeQuickAddItem(product)]);
    },
    [makeQuickAddItem],
  );

  const incrementProduct = useCallback(
    (product: ApiProduct) => {
      // Kart "+": en yeni hızlı-ekleme satırını büyüt; yoksa yeni satır aç.
      setItems((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const item = prev[i];
          if (item !== undefined && isQuickAddItem(item, product)) {
            return prev.map((it, idx) =>
              idx === i ? { ...it, quantity: it.quantity + 1 } : it,
            );
          }
        }
        return [...prev, makeQuickAddItem(product)];
      });
    },
    [makeQuickAddItem],
  );

  const decrementProduct = useCallback((product: ApiProduct) => {
    // Kart "−": en yeni hızlı-ekleme satırından düş (LIFO); 0'a inen satır
    // silinir, sonraki "−" bir önceki satırı hedefler.
    setItems((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const item = prev[i];
        if (item !== undefined && isQuickAddItem(item, product)) {
          return prev
            .map((it, idx) =>
              idx === i ? { ...it, quantity: it.quantity - 1 } : it,
            )
            .filter((it) => it.quantity > 0);
        }
      }
      return prev;
    });
  }, []);

  const computeUnit = (
    product: ApiProduct,
    payload: CartItemEditPayload,
  ): number =>
    product.priceCents +
    (payload.variant?.priceDeltaCents ?? 0) +
    sumExtra(payload.selectedAttributes);

  const addItemDetailed = useCallback(
    (product: ApiProduct, payload: CartItemEditPayload) => {
      // Amd2 K5: modalden ekleme de HER ZAMAN yeni satır (birleştirme yok).
      const unitPriceCents = computeUnit(product, payload);
      setItems((prev) => [
        ...prev,
        {
          rowId: makeRowId(),
          productId: product.id,
          productName: product.name,
          productPriceCents: product.priceCents,
          unitPriceCents,
          quantity: payload.quantity,
          selectedAttributes: payload.selectedAttributes,
          variant: payload.variant,
          note: payload.note,
        },
      ]);
    },
    [makeRowId],
  );

  const editItem = useCallback(
    (rowId: string, product: ApiProduct, payload: CartItemEditPayload) => {
      // Amd2 K3/K4: rowId opak → yeniden hesaplanmaz, satırlar birleştirilmez.
      // Düzenleme yalnız kendi satırını günceller (aynı içerikli iki satır
      // meşrudur — parti modeli).
      const unitPriceCents = computeUnit(product, payload);
      setItems((prev) =>
        prev.map((it) =>
          it.rowId === rowId
            ? {
                ...it,
                productId: product.id,
                productName: product.name,
                productPriceCents: product.priceCents,
                unitPriceCents,
                quantity: payload.quantity,
                selectedAttributes: payload.selectedAttributes,
                variant: payload.variant,
                note: payload.note,
              }
            : it,
        ),
      );
    },
    [],
  );

  const incrementItem = useCallback((rowId: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.rowId === rowId ? { ...it, quantity: it.quantity + 1 } : it,
      ),
    );
  }, []);

  const decrementItem = useCallback((rowId: string) => {
    setItems((prev) =>
      prev
        .map((it) =>
          it.rowId === rowId ? { ...it, quantity: it.quantity - 1 } : it,
        )
        .filter((it) => it.quantity > 0),
    );
  }, []);

  const removeItem = useCallback((rowId: string) => {
    setItems((prev) => prev.filter((it) => it.rowId !== rowId));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const pendingQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
    }
    return map;
  }, [items]);

  const subtotalCents = useMemo(
    () =>
      items.reduce((acc, it) => acc + it.unitPriceCents * it.quantity, 0),
    [items],
  );

  const toApiItems = useCallback((): TakeawayOrderItemInput[] => {
    return items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      ...(it.variant?.variantId !== undefined && it.variant !== null
        ? { variantId: it.variant.variantId }
        : {}),
    }));
  }, [items]);

  return {
    items,
    addItem,
    incrementProduct,
    decrementProduct,
    addItemDetailed,
    editItem,
    incrementItem,
    decrementItem,
    removeItem,
    clear,
    pendingQtyByProductId,
    subtotalCents,
    isDirty: items.length > 0,
    toApiItems,
  };
}
