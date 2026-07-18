import type { ApiActiveOrder, ApiOrderItem } from '../api/orders';

/**
 * Mock open-order backend (ADR-026 K2 "Adisyon görüntüleme" + K8).
 *
 * Returns the saved items already on an occupied table's bill so the Adisyon
 * sheet can show what the waiter is adding to (empty tables resolve to `null`).
 * Replaced by the real `GET /orders/:id` transport in PR-5d (USE_MOCK = false).
 *
 * The fixtures mirror the occupied tables in `mock/tables.ts` and their totals
 * sum to each table's `active_order_total_cents`, so the table card and the
 * sheet agree. Item statuses + owners are a deliberate mix (sent vs new, own vs
 * other waiter) so the K6 edit gate (own AND `status='new'`) has something to
 * resolve against once real PATCH editing lands in PR-5d. Money is integer kuruş.
 */

// Table ids from mock/tables.ts (occupied: b1, b3, b7).
const TABLE_MASA_1 = '00000000-0000-4000-8000-0000000000b1';
const TABLE_MASA_3 = '00000000-0000-4000-8000-0000000000b3';
const TABLE_MASA_7 = '00000000-0000-4000-8000-0000000000b7';

const ORDER_MASA_1 = '00000000-0000-4000-8000-0000000000c1';
const ORDER_MASA_3 = '00000000-0000-4000-8000-0000000000c3';
const ORDER_MASA_7 = '00000000-0000-4000-8000-0000000000c7';

// Waiter ids — Ahmet is the demo login (mock/auth.ts); Mehmet is another waiter.
const WAITER_AHMET = '00000000-0000-4000-8000-000000000001';
const WAITER_MEHMET = '00000000-0000-4000-8000-000000000002';

const MOCK_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeItem(
  id: string,
  orderId: string,
  productName: string,
  unitPriceCents: number,
  quantity: number,
  status: ApiOrderItem['status'],
  createdByUserId: string,
  variantName: string | null = null,
): ApiOrderItem {
  return {
    id,
    order_id: orderId,
    product_id: null,
    product_name: productName,
    unit_price_cents: unitPriceCents,
    quantity,
    total_cents: unitPriceCents * quantity,
    status,
    created_by_user_id: createdByUserId,
    variant_name_snapshot: variantName,
    // ADR-026 Amendment 3 K6 — offline demo carries no note/attribute fixtures.
    note: null,
    attributes: [],
  };
}

function sumTotals(items: ApiOrderItem[]): number {
  return items.reduce((acc, it) => acc + it.total_cents, 0);
}

function buildOrder(
  id: string,
  tableId: string,
  items: ApiOrderItem[],
): ApiActiveOrder {
  return { id, table_id: tableId, total_cents: sumTotals(items), items };
}

const ORDERS_BY_TABLE: Record<string, ApiActiveOrder> = {
  [TABLE_MASA_1]: buildOrder(ORDER_MASA_1, TABLE_MASA_1, [
    makeItem('i11', ORDER_MASA_1, 'Kıymalı Pide', 18_000, 1, 'sent', WAITER_AHMET, 'Tam Porsiyon'),
    makeItem('i12', ORDER_MASA_1, 'Ayran', 2_500, 2, 'sent', WAITER_AHMET),
    makeItem('i13', ORDER_MASA_1, 'Mercimek Çorbası', 6_000, 1, 'new', WAITER_AHMET),
  ]),
  [TABLE_MASA_3]: buildOrder(ORDER_MASA_3, TABLE_MASA_3, [
    makeItem('i31', ORDER_MASA_3, 'Lahmacun', 7_000, 1, 'sent', WAITER_MEHMET),
    makeItem('i32', ORDER_MASA_3, 'Su', 1_500, 1, 'sent', WAITER_MEHMET),
  ]),
  [TABLE_MASA_7]: buildOrder(ORDER_MASA_7, TABLE_MASA_7, [
    makeItem('i71', ORDER_MASA_7, 'Karışık Pide', 20_000, 1, 'sent', WAITER_AHMET, 'Tam Porsiyon'),
    makeItem('i72', ORDER_MASA_7, 'Ayran', 2_500, 1, 'new', WAITER_AHMET),
  ]),
};

/**
 * Simulate `GET /orders?tableId=X` → the single active order, or `null` for an
 * empty table (no open bill). Mirrors the web table-active-order contract.
 */
export async function mockGetActiveOrderForTable(
  tableId: string,
): Promise<ApiActiveOrder | null> {
  await delay(MOCK_DELAY_MS);
  return ORDERS_BY_TABLE[tableId] ?? null;
}
