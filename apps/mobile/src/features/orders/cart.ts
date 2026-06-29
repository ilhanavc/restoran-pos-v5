import type { ProductWithVariants } from '@restoran-pos/shared-types';
import { useCallback, useMemo, useState } from 'react';

/**
 * Local order cart (ADR-026 K4 + ADR-013 §1).
 *
 * Pure local state — the cart is NOT a server draft; nothing is sent to the
 * cloud until "Kaydet" (PR-5d). Kept as a React hook owned by the Order screen
 * so it auto-resets when the waiter leaves the table (each table push mounts a
 * fresh screen → fresh cart). A line is keyed by `productId|variantId`: tapping
 * the same product+variant again just bumps the quantity (web `useCart` parity,
 * minus attributes/notes which arrive with the line-detail modal later).
 *
 * Money is integer kuruş; `unitPriceCents = product.priceCents + variant delta`.
 */

export interface CartLine {
  /** Composite row key: `productId|variantId` (empty variant id = no variant). */
  rowId: string;
  productId: string;
  productName: string;
  variantId: string | null;
  /** Porsiyon label for display ("Tam Porsiyon"); null when the product has none. */
  variantName: string | null;
  /** Base price + variant delta, in kuruş. */
  unitPriceCents: number;
  quantity: number;
}

export interface UseCartReturn {
  lines: CartLine[];
  /** Tap a product card: add its default variant at qty 1, or bump if present. */
  addProduct: (product: ProductWithVariants) => void;
  increment: (rowId: string) => void;
  /** Decrement; removes the line when it would hit zero. */
  decrement: (rowId: string) => void;
  /** Card stepper "−": decrement this product's default-variant line. */
  decrementProduct: (product: ProductWithVariants) => void;
  remove: (rowId: string) => void;
  clear: () => void;
  /** productId → total pending qty (drives the per-card stepper badge). */
  pendingQtyByProductId: Map<string, number>;
  /** Sum of the pending additions only, in kuruş. */
  subtotalCents: number;
  /** Total pending unit count (drives the header cart badge). */
  totalQuantity: number;
  isDirty: boolean;
}

function buildRowId(productId: string, variantId: string | null): string {
  return `${productId}|${variantId ?? ''}`;
}

/** The cart row id a card tap targets: the product's default variant (or none). */
function defaultRowId(product: ProductWithVariants): string {
  const defaultVariant =
    product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
  return buildRowId(product.id, defaultVariant?.id ?? null);
}

export function useCart(): UseCartReturn {
  const [lines, setLines] = useState<CartLine[]>([]);

  const addProduct = useCallback((product: ProductWithVariants) => {
    // ADR-013 §10.1: a card tap adds the default variant (is_default, else the
    // first) with no modal. Variantless products add at the base price.
    const defaultVariant =
      product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
    const variantId = defaultVariant?.id ?? null;
    const variantName = defaultVariant?.name ?? null;
    const unitPriceCents =
      product.priceCents + (defaultVariant?.priceDeltaCents ?? 0);
    const rowId = buildRowId(product.id, variantId);

    setLines((prev) => {
      const existing = prev.find((line) => line.rowId === rowId);
      if (existing) {
        return prev.map((line) =>
          line.rowId === rowId
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [
        ...prev,
        {
          rowId,
          productId: product.id,
          productName: product.name,
          variantId,
          variantName,
          unitPriceCents,
          quantity: 1,
        },
      ];
    });
  }, []);

  const increment = useCallback((rowId: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.rowId === rowId ? { ...line, quantity: line.quantity + 1 } : line,
      ),
    );
  }, []);

  const decrement = useCallback((rowId: string) => {
    setLines((prev) =>
      prev
        .map((line) =>
          line.rowId === rowId
            ? { ...line, quantity: line.quantity - 1 }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }, []);

  const decrementProduct = useCallback((product: ProductWithVariants) => {
    decrement(defaultRowId(product));
  }, [decrement]);

  const remove = useCallback((rowId: string) => {
    setLines((prev) => prev.filter((line) => line.rowId !== rowId));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  const pendingQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      map.set(line.productId, (map.get(line.productId) ?? 0) + line.quantity);
    }
    return map;
  }, [lines]);

  const subtotalCents = useMemo(
    () => lines.reduce((acc, line) => acc + line.unitPriceCents * line.quantity, 0),
    [lines],
  );

  const totalQuantity = useMemo(
    () => lines.reduce((acc, line) => acc + line.quantity, 0),
    [lines],
  );

  return {
    lines,
    addProduct,
    increment,
    decrement,
    decrementProduct,
    remove,
    clear,
    pendingQtyByProductId,
    subtotalCents,
    totalQuantity,
    isDirty: lines.length > 0,
  };
}
