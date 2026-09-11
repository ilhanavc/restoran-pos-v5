import type { MoneyCents } from '@restoran-pos/shared-types';

interface OrderItemInput {
  unitPriceCents: MoneyCents;
  quantity: number;
  isComp: boolean;
  isCancelled: boolean;
}

export function calculateItemSubtotal(item: OrderItemInput): MoneyCents {
  if (item.isComp || item.isCancelled) return 0 as MoneyCents;
  return (item.unitPriceCents * item.quantity) as MoneyCents;
}

/**
 * Sum of the extra charges of the selected attribute options, in integer kuruş.
 *
 * ADR-012 (`extraPriceCents` per selected attribute option). Pure, side-effect
 * free; an empty selection yields 0.
 *
 * ADR-013 §2: this is a DISPLAY-only helper. The server (`resolveItemSnapshots`)
 * remains the price authority and recomputes prices from its own catalog.
 */
export function sumExtraPriceCents(
  selections: ReadonlyArray<{ extraPriceCents: MoneyCents }>,
): MoneyCents {
  return selections.reduce(
    (acc, s) => (acc + s.extraPriceCents) as MoneyCents,
    0 as MoneyCents,
  );
}

/**
 * Catalog unit price = base + variant delta + Σ extra charges, in integer kuruş.
 *
 * The addend order matches ADR-012 (attribute extras) and ADR-011/§11 (variant
 * `priceDeltaCents`). `variantDeltaCents` may be negative (a cheaper variant).
 *
 * ADR-013 §2: DISPLAY-only; the server is the price authority. This is the
 * *computed* catalog price — the effective price may still be overridden, see
 * {@link resolveEffectiveUnitPriceCents}.
 */
export function computeUnitPriceCents(
  basePriceCents: MoneyCents,
  variantDeltaCents: MoneyCents,
  extrasSumCents: MoneyCents,
): MoneyCents {
  return (basePriceCents + variantDeltaCents + extrasSumCents) as MoneyCents;
}

/**
 * Effective unit price: the manual override when present, else the computed
 * catalog price.
 *
 * ADR-013 Amendment 5 K2 — the override is ABSOLUTE and applied last: when a
 * user enters a manual price it wins regardless of the computed price. `null`
 * means "no override" (the computed price is used); `0` is a valid override
 * (a free item) and is honoured, so the guard is strictly `!== null`.
 *
 * ADR-013 §2: DISPLAY-only; the server remains the price authority. This helper
 * does NOT bound-check: a negative override returns a negative price. That is
 * safe here because the caller is client display and the server schema rejects
 * it (`order.ts` override is `int().nonnegative().max(...)`); if this is ever
 * reused in a server-side computation the caller must guarantee non-negativity.
 */
export function resolveEffectiveUnitPriceCents(
  overrideCents: MoneyCents | null,
  computedCents: MoneyCents,
): MoneyCents {
  return overrideCents !== null ? overrideCents : computedCents;
}

export function calculateOrderSubtotal(items: OrderItemInput[]): MoneyCents {
  return items.reduce(
    (sum, item) => (sum + calculateItemSubtotal(item)) as MoneyCents,
    0 as MoneyCents,
  );
}

export function calculateOrderDiscount(subtotal: MoneyCents, discountCents: MoneyCents): MoneyCents {
  if (discountCents > subtotal) throw new RangeError('Discount cannot exceed subtotal');
  return (subtotal - discountCents) as MoneyCents;
}

export function calculateOrderTotal(
  subtotal: MoneyCents,
  discountCents: MoneyCents,
  taxCents: MoneyCents,
): MoneyCents {
  const afterDiscount = calculateOrderDiscount(subtotal, discountCents);
  return (afterDiscount + taxCents) as MoneyCents;
}
