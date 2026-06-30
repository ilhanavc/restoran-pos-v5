import {
  ProductWithVariantsSchema,
  type Area,
  type Category,
} from '@restoran-pos/shared-types';
import { z } from 'zod';

import type { ApiActiveOrder, ApiOrderItem } from './orders';
import type { ApiTable } from './tables';

/**
 * Network-boundary zod schemas + casing bridge (ADR-026 Amendment 2026-06-29
 * PR-5d B). Verified empirically against the real backend routes+repos:
 *  - auth/products are camelCase (shared-types schemas reusable),
 *  - areas + menu/categories serialize raw **snake_case** repo rows, so we parse
 *    a local snake schema and MAP to the camelCase `Area`/`Category` the screens
 *    consume (mock parity preserved),
 *  - tables + order items are snake_case; the order item schema is a SUBSET —
 *    zod strips the 10+ extra wire columns by default (do NOT call `.strict()`).
 *
 * Money is integer kuruş; timestamps arrive as ISO strings over JSON.
 */

// ── Areas (GET /areas → snake_case, no icon/color) ─────────────────────────────
const AreaRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  sort_order: z.number(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const AreasResponseSchema = z.object({
  data: z.object({ areas: z.array(AreaRowSchema) }),
});

export function mapArea(row: z.infer<typeof AreaRowSchema>): Area {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sortOrder: row.sort_order,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Menu categories (GET /menu/categories → snake_case, +kitchen_print, no vat) ─
const CategoryRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  sort_order: z.number(),
  icon: z.string(),
  color: z.string(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const MenuCategoriesResponseSchema = z.object({
  data: z.object({ categories: z.array(CategoryRowSchema) }),
});

export function mapCategory(row: z.infer<typeof CategoryRowSchema>): Category {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    sortOrder: row.sort_order,
    // `vat_rate_bps` is not on the wire (MVP scope). The waiter catalog never
    // reads it; supply 0 to satisfy the shared `Category` type (cosmetic).
    vatRateBps: 0,
    // `icon`/`color` are DB-constrained strings (Migration 012) within the
    // shared enum/palette; cast at the boundary.
    icon: row.icon as Category['icon'],
    color: row.color as Category['color'],
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Menu products (GET /products → camelCase via toProduct/toVariant) ──────────
export const ProductsResponseSchema = z.object({
  data: z.object({ products: z.array(ProductWithVariantsSchema) }),
});

// ── Tables (GET /tables → snake_case projection; mirrors ApiTable) ─────────────
const ApiTableSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  code: z.string(),
  capacity: z.number().nullable(),
  area_id: z.string().nullable(),
  // ADR-009 Amendment 2026-06-30 Karar A — kalıcı per-bölge görüntü numarası.
  display_no: z.number().nullable(),
  status: z.enum(['available', 'occupied', 'reserved', 'cleaning']),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  active_order_id: z.string().nullable(),
  // PostgreSQL SUM()/aggregate projections arrive as STRINGS over the wire
  // (pg returns numeric/bigint as text); coerce to number. `.nullable()`
  // short-circuits on null (empty table) before coercion.
  active_order_total_cents: z.coerce.number().nullable(),
  active_order_paid_total_cents: z.coerce.number().nullable(),
  active_order_started_at: z.string().nullable(),
  active_waiter_name: z.string().nullable(),
});

export const TablesResponseSchema = z.object({
  data: z.object({ tables: z.array(ApiTableSchema) }),
});

// `z.infer` of ApiTableSchema is structurally ApiTable.
export function asApiTables(parsed: z.infer<typeof TablesResponseSchema>): ApiTable[] {
  return parsed.data.tables;
}

// ── Orders ─────────────────────────────────────────────────────────────────────
/** Order statuses that count as an OPEN bill (table occupied) — web parity. */
export const ACTIVE_ORDER_STATUSES: ReadonlySet<string> = new Set([
  'open',
  'sent_to_kitchen',
  'partially_served',
  'served',
  'billed',
]);

const OrderRowSchema = z.object({
  id: z.string(),
  table_id: z.string().nullable(),
  // OrderStatus is left loose (z.string) so a future backend status never breaks
  // the parse; the active filter uses ACTIVE_ORDER_STATUSES above.
  status: z.string(),
  total_cents: z.number(),
});

/** Saved order item — SUBSET of the wire row (zod strips the extra columns). */
const OrderItemSchema = z.object({
  id: z.string(),
  order_id: z.string(),
  product_id: z.string().nullable(),
  product_name: z.string(),
  unit_price_cents: z.number(),
  quantity: z.number(),
  total_cents: z.number(),
  status: z.enum(['new', 'sent', 'preparing', 'ready', 'served', 'cancelled']),
  created_by_user_id: z.string().nullable(),
  variant_name_snapshot: z.string().nullable(),
});

export const OrdersListResponseSchema = z.object({
  data: z.object({ orders: z.array(OrderRowSchema) }),
});

export const OrderDetailResponseSchema = z.object({
  data: z.object({ order: OrderRowSchema, items: z.array(OrderItemSchema) }),
});

/** POST /orders + POST /orders/:id/items — mobile only needs the order id. */
export const OrderIdResponseSchema = z.object({
  data: z.object({ order: z.object({ id: z.string() }) }),
});

export function toActiveOrder(
  parsed: z.infer<typeof OrderDetailResponseSchema>,
  fallbackTableId: string,
): ApiActiveOrder {
  const items: ApiOrderItem[] = parsed.data.items;
  return {
    id: parsed.data.order.id,
    table_id: parsed.data.order.table_id ?? fallbackTableId,
    total_cents: parsed.data.order.total_cents,
    items,
  };
}
