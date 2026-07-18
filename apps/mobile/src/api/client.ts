import {
  LoginResponseSchema,
  type Area,
  type Category,
  type LoginRequest,
  type LoginResponse,
  type ProductWithVariants,
} from '@restoran-pos/shared-types';

import { USE_MOCK } from '../config';
import { mockLogin } from '../mock/auth';
import { mockGetMenuCategories, mockGetMenuProducts } from '../mock/menu';
import { mockGetActiveOrderForTable } from '../mock/orders';
import { mockGetAreas, mockGetTables } from '../mock/tables';
import { apiRequest } from './http';
import type {
  ApiActiveOrder,
  CreateOrderInput,
  OrderItemInput,
} from './orders';
import {
  ACTIVE_ORDER_STATUSES,
  AreasResponseSchema,
  EffectiveAttributeGroupsResponseSchema,
  MenuCategoriesResponseSchema,
  OrderDetailResponseSchema,
  OrdersListResponseSchema,
  ProductsResponseSchema,
  TablesResponseSchema,
  asApiTables,
  mapArea,
  mapCategory,
  toActiveOrder,
  type EffectiveAttributeGroupRow,
} from './schemas';
import type { ApiTable } from './tables';

/**
 * API client (ADR-026 K8 + Amendment 2026-06-29 PR-5d).
 *
 * The seam between the screens and the network. While `USE_MOCK` is `true` it
 * delegates to the in-process mock layer (offline demo); otherwise it runs the
 * real transport: `apiRequest` (Bearer + 401 refresh) → zod parse at the
 * boundary → snake→camel map where the wire diverges from the UI types.
 */

/** Authenticate the waiter. `X-Client: mobile` opts into body-refresh (ADR-002 §2.1). */
export async function login(request: LoginRequest): Promise<LoginResponse> {
  if (USE_MOCK) {
    return mockLogin(request);
  }
  const json = await apiRequest('/auth/login', {
    method: 'POST',
    body: request,
    auth: false,
    headers: { 'X-Client': 'mobile' },
  });
  return LoginResponseSchema.parse(json);
}

/** Fetch the table board with the active-order projection (`GET /tables`, snake). */
export async function getTables(): Promise<ApiTable[]> {
  if (USE_MOCK) {
    return mockGetTables();
  }
  const json = await apiRequest('/tables');
  return asApiTables(TablesResponseSchema.parse(json));
}

/** Fetch the salon areas (`GET /areas`, snake → camel `Area`). */
export async function getAreas(): Promise<Area[]> {
  if (USE_MOCK) {
    return mockGetAreas();
  }
  const json = await apiRequest('/areas');
  return AreasResponseSchema.parse(json).data.areas.map(mapArea);
}

/** Fetch menu categories (`GET /menu/categories`, snake → camel `Category`). */
export async function getMenuCategories(): Promise<Category[]> {
  if (USE_MOCK) {
    return mockGetMenuCategories();
  }
  const json = await apiRequest('/menu/categories');
  return MenuCategoriesResponseSchema.parse(json).data.categories.map(mapCategory);
}

/** Fetch the product catalog with nested variants (`GET /products`, camel). */
export async function getMenuProducts(): Promise<ProductWithVariants[]> {
  if (USE_MOCK) {
    return mockGetMenuProducts();
  }
  const json = await apiRequest('/products');
  // GET /products returns inactive products too (admin manages them); the
  // waiter catalog only offers active ones.
  return ProductsResponseSchema.parse(json).data.products.filter(
    (p) => p.isActive,
  );
}

/**
 * Fetch a product's effective attribute groups + options (ADR-026 Amendment 3
 * K5). The SAME endpoint the web OrderProductDetailModal uses — no new server
 * contract. Drives the line-detail modal's Özellikler section; empty in mock
 * mode (offline demo carries no attribute fixtures).
 */
export async function getEffectiveAttributeGroups(
  productId: string,
): Promise<EffectiveAttributeGroupRow[]> {
  if (USE_MOCK) {
    return [];
  }
  const json = await apiRequest(
    `/products/${encodeURIComponent(productId)}/attribute-groups/effective-with-options`,
  );
  return EffectiveAttributeGroupsResponseSchema.parse(json).data.groups;
}

/**
 * Fetch the active order (saved items) for a table, or `null` when empty.
 * Same contract as the web table-active-order lookup: `GET /orders?tableId=X` →
 * client-side active filter → `GET /orders/:id` for the items.
 */
export async function getActiveOrderForTable(
  tableId: string,
): Promise<ApiActiveOrder | null> {
  if (USE_MOCK) {
    return mockGetActiveOrderForTable(tableId);
  }
  const listJson = await apiRequest(
    `/orders?tableId=${encodeURIComponent(tableId)}`,
  );
  const orders = OrdersListResponseSchema.parse(listJson).data.orders;
  const active = orders.find((o) => ACTIVE_ORDER_STATUSES.has(o.status)) ?? null;
  if (active === null) {
    return null;
  }
  const detailJson = await apiRequest(`/orders/${active.id}`);
  return toActiveOrder(OrderDetailResponseSchema.parse(detailJson), tableId);
}

/**
 * Create a new dine-in order for a table with its first items (Kaydet, K7).
 * The backend resolves prices server-side and auto-enqueues the kitchen job +
 * `kitchen.orderSent` realtime event.
 *
 * ADR-013 Amendment 1 (K9): pass a stable `idempotencyKey` so a retried save
 * (timeout / network loss) collapses to a single order server-side (200 replay).
 * Returns the authoritative order projection (replay-safe) so the caller can
 * write it back into the active-order cache (Blok 10 stale-cache fix).
 */
export async function createOrder(
  input: CreateOrderInput,
  idempotencyKey?: string,
): Promise<ApiActiveOrder> {
  if (USE_MOCK) {
    return { id: 'mock-order-id', table_id: input.tableId ?? '', total_cents: 0, items: [] };
  }
  const json = await apiRequest('/orders', {
    method: 'POST',
    body: { ...input, idempotencyKey },
  });
  // Response (replay dahil aynı `{ order, items }` şekli) → ActiveOrder.
  return toActiveOrder(OrderDetailResponseSchema.parse(json), input.tableId ?? '');
}

/**
 * Move an open dine-in order to another (empty) table (ADR-028 Karar A/H).
 * `PATCH /orders/:orderId/table` re-validates + reassigns `table_id` server-side
 * (target must be empty; 409 `TABLE_ALREADY_OCCUPIED` if concurrently taken).
 * Returns nothing — the caller invalidates `['tables']` + `['orders']`.
 */
export async function moveTableOrder(
  orderId: string,
  tableId: string,
): Promise<void> {
  if (USE_MOCK) {
    return;
  }
  await apiRequest(`/orders/${encodeURIComponent(orderId)}/table`, {
    method: 'PATCH',
    body: { tableId },
  });
}

/**
 * Merge an open dine-in order into another OCCUPIED table (ADR-029 Karar K5).
 * `POST /orders/:sourceOrderId/merge` re-parents the source order's items onto
 * the target table's open order server-side and closes the source as `merged`
 * (target must be occupied + neither side may have payments — 409 otherwise).
 * Returns nothing — the response DTO is intentionally NOT parsed (attribute-style
 * endpoint returns a flat order DTO, not `{ order, items }`; casting it would
 * TypeError in onSuccess, see feedback_mutation_response_shape_mismatch). The
 * caller invalidates `['tables']` + `['orders']`.
 */
export async function mergeOrderTable(
  sourceOrderId: string,
  targetTableId: string,
): Promise<void> {
  if (USE_MOCK) {
    return;
  }
  await apiRequest(`/orders/${encodeURIComponent(sourceOrderId)}/merge`, {
    method: 'POST',
    body: { targetTableId },
  });
}

/**
 * Add items to an existing open order (Kaydet on an already-occupied table, K7).
 *
 * ADR-013 Amendment 1 (K9): pass a stable `batchKey` so a retried add-items
 * request does NOT duplicate the lines server-side (200 replay, live order).
 * Returns the authoritative order projection for the active-order cache.
 */
export async function addOrderItems(
  orderId: string,
  items: OrderItemInput[],
  batchKey?: string,
): Promise<ApiActiveOrder> {
  if (USE_MOCK) {
    return { id: orderId, table_id: '', total_cents: 0, items: [] };
  }
  const json = await apiRequest(`/orders/${orderId}/items`, {
    method: 'POST',
    body: { items, batchKey },
  });
  // Response order.table_id yanıtta hep dolu → fallback kullanılmaz.
  return toActiveOrder(OrderDetailResponseSchema.parse(json), '');
}
