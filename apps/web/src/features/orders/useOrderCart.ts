import { useCallback, useMemo, useState } from 'react';
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
  /** Composite row key (ADR-013 §11 Karar 11.2 — 5-tuple):
   *  `productId|variantId|attributesHash|note`. Aynı 5-tuple = qty++; farklıysa
   *  yeni satır. variantId yoksa boş string. */
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
  /** Ürün kartı tıklama (ADR-013 §10.1): modal yok, default 1 adet, attribute boş.
   *  Mevcut "boş özellik + boş note" satır varsa qty++ (composite key eşleşir). */
  addItem: (product: ApiProduct) => void;
  /** Modal "Onayla" davranışı — seçilen özellik + note + qty ile satır ekle/birleştir. */
  addItemDetailed: (product: ApiProduct, payload: CartItemEditPayload) => void;
  /** Modal "Onayla" mevcut pending satırı düzenliyorsa: satırı yeni payload ile
   *  değiştir; yeni payload'ın composite key'i mevcut farklı bir satırla
   *  eşleşirse miktarlar birleştirilir (idempotent). */
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

/** ADR-013 §10 Karar 10.4 paritesi — deterministik attribute hash. */
export function attributesHash(
  selected: ReadonlyArray<SelectedAttributeInput>,
): string {
  const sorted = [...selected]
    .map((s) => ({ groupId: s.groupId, optionId: s.optionId }))
    .sort((a, b) =>
      a.groupId === b.groupId
        ? a.optionId.localeCompare(b.optionId)
        : a.groupId.localeCompare(b.groupId),
    );
  return JSON.stringify(sorted);
}

export function buildRowId(
  productId: string,
  variantId: string | null,
  selected: ReadonlyArray<SelectedAttributeInput>,
  note: string | null,
): string {
  return `${productId}|${variantId ?? ''}|${attributesHash(selected)}|${note ?? ''}`;
}

function sumExtra(selected: ReadonlyArray<CartAttributeSelection>): number {
  return selected.reduce((acc, s) => acc + s.extraPriceCents, 0);
}

export function useOrderCart(): UseOrderCartReturn {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback((product: ApiProduct) => {
    // Karar 10.1: kart tıklama default variant (varsa is_default=true veya ilk)
    // ile direkt eklenir. Bu sayede pide gibi varyantlı ürünlerde de hızlı ekleme
    // çalışır; kullanıcı satıra tıklayıp porsiyonu değiştirebilir.
    const defaultVariant =
      product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
    const variant: CartVariantSelection | null = defaultVariant
      ? {
          variantId: defaultVariant.id,
          variantName: defaultVariant.name,
          priceDeltaCents: defaultVariant.priceDeltaCents,
        }
      : null;
    const rowId = buildRowId(
      product.id,
      variant?.variantId ?? null,
      [],
      null,
    );
    const unitPriceCents =
      product.priceCents + (variant?.priceDeltaCents ?? 0);
    setItems((prev) => {
      const existing = prev.find((it) => it.rowId === rowId);
      if (existing) {
        return prev.map((it) =>
          it.rowId === rowId ? { ...it, quantity: it.quantity + 1 } : it,
        );
      }
      return [
        ...prev,
        {
          rowId,
          productId: product.id,
          productName: product.name,
          productPriceCents: product.priceCents,
          unitPriceCents,
          quantity: 1,
          selectedAttributes: [],
          variant,
          note: null,
        },
      ];
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
      const rowId = buildRowId(
        product.id,
        payload.variant?.variantId ?? null,
        payload.selectedAttributes,
        payload.note,
      );
      const unitPriceCents = computeUnit(product, payload);
      setItems((prev) => {
        const existing = prev.find((it) => it.rowId === rowId);
        if (existing) {
          return prev.map((it) =>
            it.rowId === rowId
              ? { ...it, quantity: it.quantity + payload.quantity }
              : it,
          );
        }
        return [
          ...prev,
          {
            rowId,
            productId: product.id,
            productName: product.name,
            productPriceCents: product.priceCents,
            unitPriceCents,
            quantity: payload.quantity,
            selectedAttributes: payload.selectedAttributes,
            variant: payload.variant,
            note: payload.note,
          },
        ];
      });
    },
    [],
  );

  const editItem = useCallback(
    (rowId: string, product: ApiProduct, payload: CartItemEditPayload) => {
      const newRowId = buildRowId(
        product.id,
        payload.variant?.variantId ?? null,
        payload.selectedAttributes,
        payload.note,
      );
      const unitPriceCents = computeUnit(product, payload);
      setItems((prev) => {
        const without = prev.filter((it) => it.rowId !== rowId);
        const collided = without.find((it) => it.rowId === newRowId);
        if (collided) {
          return without.map((it) =>
            it.rowId === newRowId
              ? { ...it, quantity: it.quantity + payload.quantity }
              : it,
          );
        }
        return prev.map((it) =>
          it.rowId === rowId
            ? {
                rowId: newRowId,
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
        );
      });
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
