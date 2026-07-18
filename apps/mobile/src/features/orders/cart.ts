import type { ProductWithVariants } from '@restoran-pos/shared-types';
import { useCallback, useMemo, useState } from 'react';

/**
 * Local order cart (ADR-026 K4 + Amendment 3 + ADR-013 §1/§10/§11).
 *
 * Pure local state — the cart is NOT a server draft; nothing is sent to the
 * cloud until "Kaydet". Kept as a React hook owned by the Order screen so it
 * auto-resets when the waiter leaves the table (each table push mounts a fresh
 * screen → fresh cart). A line is keyed by the 5-tuple
 * `productId|variantId|attributesHash|note` (ADR-026 Amendment 3 K4): tapping the
 * same product+variant+attributes+note again just bumps the quantity; a
 * different porsiyon / özellik / not opens a fresh line. A quick-add tap
 * (default variant, no attributes, no note) still merges with other quick-adds.
 *
 * Money is integer kuruş; `unitPriceCents = product.priceCents + variant delta +
 * Σ selected extra` (display only — the server stays the price authority, K5).
 */

/** A selected attribute on a cart line (drives both the payload and display). */
export interface CartLineAttribute {
  groupId: string;
  optionId: string;
  /** Option label for the Adisyon summary (e.g. "Duble Kaşarlı"). */
  optionName: string;
  /** Signed extra price in kuruş (> 0 shown as `+₺x`); display only (K5). */
  extraPriceCents: number;
}

export interface CartLine {
  /** Composite row key `productId|variantId|attributesHash|note` (K4). */
  rowId: string;
  productId: string;
  productName: string;
  variantId: string | null;
  /** Porsiyon label for display ("Tam Porsiyon"); null when the product has none. */
  variantName: string | null;
  /** Base price + variant delta + Σ selected extras, in kuruş (display; K5). */
  unitPriceCents: number;
  /** Selected attributes (K4/K6); empty for a quick-add line. */
  selectedAttributes: CartLineAttribute[];
  /** Kalem notu (max 280 char); null when none. */
  note: string | null;
  quantity: number;
}

/** The editable slice a line-detail save applies to a cart line (K4). */
export interface CartLineEdit {
  variantId: string | null;
  variantName: string | null;
  unitPriceCents: number;
  quantity: number;
  selectedAttributes: CartLineAttribute[];
  note: string | null;
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
  /**
   * Apply a line-detail edit to an existing line (ADR-026 Amendment 3 K4). The
   * key is recomputed from the new porsiyon/özellik/not; if it collides with
   * another line the quantities are summed (merge), otherwise the line is
   * updated in place.
   */
  updateLine: (rowId: string, edit: CartLineEdit) => void;
  clear: () => void;
  /** productId → total pending qty (drives the per-card stepper badge). */
  pendingQtyByProductId: Map<string, number>;
  /** Sum of the pending additions only, in kuruş. */
  subtotalCents: number;
  /** Total pending unit count (drives the header cart badge). */
  totalQuantity: number;
  isDirty: boolean;
}

/**
 * Deterministic attribute fingerprint (K4): `groupId:optionId` pairs sorted into
 * a canonical order so the same selection always yields the same hash regardless
 * of pick order → correct merge, no spurious split. Empty selection → ''.
 */
function attributesHash(attributes: CartLineAttribute[]): string {
  return attributes
    .map((a) => `${a.groupId}:${a.optionId}`)
    .sort()
    .join(',');
}

function buildRowId(
  productId: string,
  variantId: string | null,
  attributes: CartLineAttribute[],
  note: string | null,
): string {
  return `${productId}|${variantId ?? ''}|${attributesHash(attributes)}|${note ?? ''}`;
}

/** The cart row id a card tap targets: the product's default variant (or none). */
function defaultRowId(product: ProductWithVariants): string {
  const defaultVariant =
    product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
  return buildRowId(product.id, defaultVariant?.id ?? null, [], null);
}

export function useCart(): UseCartReturn {
  const [lines, setLines] = useState<CartLine[]>([]);

  const addProduct = useCallback((product: ProductWithVariants) => {
    // ADR-013 §10.1: a card tap adds the default variant (is_default, else the
    // first) with no modal, no attributes and no note. Variantless products add
    // at the base price. Its key carries an empty attributesHash + empty note so
    // repeated quick-adds keep merging (K1 rush-hour behaviour is unchanged).
    const defaultVariant =
      product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null;
    const variantId = defaultVariant?.id ?? null;
    const variantName = defaultVariant?.name ?? null;
    const unitPriceCents =
      product.priceCents + (defaultVariant?.priceDeltaCents ?? 0);
    const rowId = buildRowId(product.id, variantId, [], null);

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
          selectedAttributes: [],
          note: null,
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

  const updateLine = useCallback((rowId: string, edit: CartLineEdit) => {
    setLines((prev) => {
      const target = prev.find((line) => line.rowId === rowId);
      if (target === undefined) {
        return prev;
      }
      const newRowId = buildRowId(
        target.productId,
        edit.variantId,
        edit.selectedAttributes,
        edit.note,
      );
      const updated: CartLine = {
        ...target,
        rowId: newRowId,
        variantId: edit.variantId,
        variantName: edit.variantName,
        unitPriceCents: edit.unitPriceCents,
        selectedAttributes: edit.selectedAttributes,
        note: edit.note,
        quantity: edit.quantity,
      };
      // Key unchanged → replace in place.
      if (newRowId === rowId) {
        return prev.map((line) => (line.rowId === rowId ? updated : line));
      }
      // Key changed → drop the original, then either merge into an existing
      // same-key line (sum quantities, K4) or append as a new line.
      const without = prev.filter((line) => line.rowId !== rowId);
      const collision = without.find((line) => line.rowId === newRowId);
      if (collision !== undefined) {
        return without.map((line) =>
          line.rowId === newRowId
            ? { ...line, quantity: line.quantity + updated.quantity }
            : line,
        );
      }
      return [...without, updated];
    });
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
    updateLine,
    clear,
    pendingQtyByProductId,
    subtotalCents,
    totalQuantity,
    isDirty: lines.length > 0,
  };
}
