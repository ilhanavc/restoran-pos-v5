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
 * A saved attribute snapshot on an order item (ADR-013 §10; Migration 017).
 * Only the read fields the Adisyon summary renders (name + extra price, K6);
 * zod strips the rest at the boundary.
 */
export interface ApiOrderItemAttribute {
  option_name_snapshot: string;
  extra_price_cents_snapshot: number;
}

/**
 * Backend `GET /orders/:id` runtime projection — the saved-item slice the
 * waiter app needs (ADR-026 K2 "Adisyon görüntüleme" + K6 gating).
 *
 * Mirrors the web app's local `ApiOrderItem` (apps/web/src/features/orders/api.ts):
 * the cloud API returns snake_case rows. Only the fields the Adisyon sheet
 * renders are kept here — comp/payment meta stays omitted, but porsiyon + note +
 * attribute snapshots are shown read-only on the saved row (ADR-026 Amendment 3
 * K6). PR-5d swaps the mock for a real `fetch` with no shape change.
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
  /** ADR-013 Amd3 — porsiyon id (kalem detay sheet'i seçili porsiyonu bilir). */
  variant_id_snapshot: string | null;
  /** ADR-013 §9.2 ikram bayrağı (kalem detay sheet'i toggle metni için). */
  is_comped: boolean;
  /** ADR-026 Amd3 K6 — kalem notu; NULL for none (shown read-only on the row). */
  note: string | null;
  /** ADR-026 Amd3 K6 — selected attribute snapshots for the read-only summary. */
  attributes: ApiOrderItemAttribute[];
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
 * A single line the waiter is saving (ADR-026 K7 + Amendment 3 K5). The backend
 * resolves the price snapshot server-side from `productId` (+ optional
 * `variantId` + `selectedAttributes`); the client never sends a price, only IDs.
 * Mirrors shared-types `OrderItemCreateInputSchema`.
 */
export interface OrderItemInput {
  productId: string;
  quantity: number;
  /** Porsiyon variant (ADR-013 §11). Omitted for variantless products. */
  variantId?: string;
  /** Kalem notu (ADR-013 §10, max 280). Omitted when empty. */
  note?: string;
  /** Selected attributes (ADR-013 §10). Omitted when none; server resolves price. */
  selectedAttributes?: { groupId: string; optionId: string }[];
}

/** `POST /orders` body — a new dine-in bill for a table with its first items. */
export interface CreateOrderInput {
  tableId: string | null;
  orderType: 'dine_in' | 'takeaway' | 'delivery';
  items: OrderItemInput[];
}
