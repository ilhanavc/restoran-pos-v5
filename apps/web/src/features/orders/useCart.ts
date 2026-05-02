import { useCallback, useMemo, useState } from 'react';
import type { ApiProduct } from '../admin/menu-products/api';
import type { SelectedAttributeInput } from './api';

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

export interface CartItem {
  /** Composite row key (ADR-013 §10 Karar 10.4):
   *  `productId|attributesHash|note`. Aynı 3-tuple = qty++; farklıysa yeni satır. */
  rowId: string;
  productId: string;
  productName: string;
  /** Base ürün fiyatı (kuruş). Σ extra eklendiğinde unitPriceCents üretilir. */
  productPriceCents: number;
  /** unitPriceCents = productPriceCents + Σ selectedAttributes[].extraPriceCents */
  unitPriceCents: number;
  quantity: number;
  selectedAttributes: CartAttributeSelection[];
  note: string | null;
}

export interface CartItemEditPayload {
  selectedAttributes: CartAttributeSelection[];
  note: string | null;
  quantity: number;
}

export interface UseCartReturn {
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
  selected: ReadonlyArray<SelectedAttributeInput>,
  note: string | null,
): string {
  return `${productId}|${attributesHash(selected)}|${note ?? ''}`;
}

function sumExtra(selected: ReadonlyArray<CartAttributeSelection>): number {
  return selected.reduce((acc, s) => acc + s.extraPriceCents, 0);
}

export function useCart(): UseCartReturn {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback((product: ApiProduct) => {
    const rowId = buildRowId(product.id, [], null);
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
          unitPriceCents: product.priceCents,
          quantity: 1,
          selectedAttributes: [],
          note: null,
        },
      ];
    });
  }, []);

  const addItemDetailed = useCallback(
    (product: ApiProduct, payload: CartItemEditPayload) => {
      const rowId = buildRowId(
        product.id,
        payload.selectedAttributes,
        payload.note,
      );
      const unitPriceCents =
        product.priceCents + sumExtra(payload.selectedAttributes);
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
        payload.selectedAttributes,
        payload.note,
      );
      const unitPriceCents =
        product.priceCents + sumExtra(payload.selectedAttributes);
      setItems((prev) => {
        // Mevcut satırı çıkar
        const without = prev.filter((it) => it.rowId !== rowId);
        // Yeni rowId zaten varsa miktarları birleştir
        const collided = without.find((it) => it.rowId === newRowId);
        if (collided) {
          return without.map((it) =>
            it.rowId === newRowId
              ? { ...it, quantity: it.quantity + payload.quantity }
              : it,
          );
        }
        // Aksi halde aynı pozisyonda yenisiyle değiştir (sıra korunur)
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
  };
}
