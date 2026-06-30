/**
 * order_item_status ENUM (Migration 020) — mirrors the web app's local union
 * (apps/web/src/features/orders/api.ts); shared-types has no exported member for
 * it. 'cancelled' = soft void.
 */
export type OrderItemStatus =
  | 'new'
  | 'sent'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'cancelled';

/**
 * Backend `GET /orders/:id` runtime projection — the saved-item slice the
 * waiter app needs (ADR-026 K2 "Adisyon görüntüleme" + K6 gating).
 *
 * Mirrors the web app's local `ApiOrderItem` (apps/web/src/features/orders/api.ts):
 * the cloud API returns snake_case rows. Only the fields the Adisyon sheet
 * renders are kept here — the waiter never sees comp/payment/attribute meta, so
 * those columns are intentionally omitted (K6: unauthorised surface is never
 * rendered). PR-5d swaps the mock for a real `fetch` with no shape change.
 *
 * `status` + `created_by_user_id` drive the K6 edit gate: an item is editable
 * only when it is the waiter's own AND still `status === 'new'` (ADR-008 §7b).
 * Money is integer kuruş (cents) — never float (ADR-003 §10).
 */
export interface ApiOrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
  /** order_item_status ENUM (Migration 020). 'cancelled' = soft void. */
  status: OrderItemStatus;
  /** ADR-013 §5 actor — NULL if the creating user was deleted. */
  created_by_user_id: string | null;
  /** ADR-013 §11 porsiyon snapshot ("Tam Porsiyon"); NULL for no-variant items. */
  variant_name_snapshot: string | null;
}

/**
 * The active order for a table, with its saved items. `null` while the table is
 * empty (no open bill). The mobile app only consumes the open-bill projection;
 * full order meta (order_no, store_date, ...) is out of the waiter's scope.
 */
export interface ApiActiveOrder {
  id: string;
  table_id: string;
  /** Open-bill running total in kuruş (sum of saved item totals). */
  total_cents: number;
  items: ApiOrderItem[];
}

/**
 * A single line the waiter is saving (ADR-026 K7). The backend resolves the
 * price snapshot server-side from `productId` (+ optional `variantId`); the
 * client never sends a price. Mobile carries no attributes/notes (ADR-026 K2).
 */
export interface OrderItemInput {
  productId: string;
  quantity: number;
  /** Porsiyon variant (ADR-013 §11). Omitted for variantless products. */
  variantId?: string;
}

/** `POST /orders` body — a new dine-in bill for a table with its first items. */
export interface CreateOrderInput {
  tableId: string | null;
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  items: OrderItemInput[];
}
