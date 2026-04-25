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
