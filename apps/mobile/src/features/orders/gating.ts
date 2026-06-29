import type { ApiOrderItem } from '../../api/orders';

/**
 * Waiter edit gate for a saved order item (ADR-026 K6 + ADR-008 §7b).
 *
 * A waiter may amend (stepper / void) a SAVED item only when it is BOTH their
 * own AND still `status === 'new'` (not yet sent to the kitchen). Items sent to
 * the kitchen, or another waiter's items, are read-only — the edit affordance
 * is not rendered at all (K6: unauthorised actions are never shown). Pending,
 * not-yet-saved cart lines are always editable (they are local, own, and new by
 * construction) and do not pass through this gate.
 *
 * The real stepper/void mutations against these saved items land in PR-5d (they
 * need `PATCH /orders/:orderId/items/:itemId`); until then saved items render
 * read-only and only this predicate decides whether the affordance shows.
 */
export function canWaiterEditOrderItem(
  item: Pick<ApiOrderItem, 'status' | 'created_by_user_id'>,
  currentUserId: string | null,
): boolean {
  return (
    item.status === 'new' &&
    item.created_by_user_id !== null &&
    item.created_by_user_id === currentUserId
  );
}
