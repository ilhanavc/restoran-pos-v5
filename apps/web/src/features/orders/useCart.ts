import { useCallback, useMemo, useState } from 'react';
import type { ApiProduct } from '../admin/menu-products/api';

/**
 * Pending sepet kalemi — Kaydet basılana kadar React state'inde tutulur
 * (ADR-013 §1: saf local state, sunucu draft yok). Snapshot alanları
 * (variant, attributeOptions, notes) PR-6'da AttributePicker modal ile
 * eklenecek; PR-3'te sade ürün+qty.
 */
export interface CartItem {
  /** Cart satırı ID — PR-6'da varyant/attribute kombinasyonları aynı ürünün
   *  birden fazla satırı olabilmesini sağlamak için ayrı; PR-3'te = productId. */
  rowId: string;
  productId: string;
  productName: string;
  productPriceCents: number;
  quantity: number;
}

export interface UseCartReturn {
  items: CartItem[];
  /** Aynı ürünün satırı varsa qty++, yoksa qty=1 ile ekler. PR-6'da varyant/
   *  attribute farklılığı olan satırlar ayrı tutulur (rowId değişir). */
  addItem: (product: ApiProduct) => void;
  /** rowId üzerinden qty++. */
  incrementItem: (rowId: string) => void;
  /** qty-- (1'den 0'a inerse satır otomatik silinir — ADR-013 §6 pending kuralı). */
  decrementItem: (rowId: string) => void;
  removeItem: (rowId: string) => void;
  clear: () => void;
  /** ProductCard.pendingQty lookup için — productId → toplam qty. */
  pendingQtyByProductId: Map<string, number>;
  /** Sipariş ara toplam (cent) — pending kalemlerin unit_price × qty toplamı. */
  subtotalCents: number;
  /** Pending kalem var mı (Kaydet butonu görünürlüğü). */
  isDirty: boolean;
}

/**
 * Pending cart hook — ADR-013 §1.
 *
 * F5 / sayfa yenileme = state kaybı (kabul edilen risk; v5.1 forward-ref:
 * localStorage auto-save).
 *
 * Kapsam (PR-3):
 *   - Ürün + qty (varyant + attribute YOK; PR-6'da gelir)
 *   - Aynı ürün tekrar eklenirse qty++ (rowId paylaşılır)
 *   - qty 0'a inince satır lokal silinir (filter)
 */
export function useCart(): UseCartReturn {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback((product: ApiProduct) => {
    setItems((prev) => {
      // PR-3'te rowId = productId (varyant/attribute YOK). PR-6'da composite key.
      const existing = prev.find((it) => it.rowId === product.id);
      if (existing) {
        return prev.map((it) =>
          it.rowId === product.id ? { ...it, quantity: it.quantity + 1 } : it,
        );
      }
      return [
        ...prev,
        {
          rowId: product.id,
          productId: product.id,
          productName: product.name,
          productPriceCents: product.priceCents,
          quantity: 1,
        },
      ];
    });
  }, []);

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
      items.reduce(
        (acc, it) => acc + it.productPriceCents * it.quantity,
        0,
      ),
    [items],
  );

  return {
    items,
    addItem,
    incrementItem,
    decrementItem,
    removeItem,
    clear,
    pendingQtyByProductId,
    subtotalCents,
    isDirty: items.length > 0,
  };
}
