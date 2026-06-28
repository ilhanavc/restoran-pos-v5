import type { TableStatus } from '@restoran-pos/shared-types';

/**
 * Backend `GET /tables` runtime projection (ADR-026 K8).
 *
 * Mirrors the web app's local `ApiTable` (apps/web/src/features/tables/api.ts):
 * the cloud API returns snake_case rows with the active-order projection joined
 * in. The shared-types `TableRow` schema is the OLD v5 design (camelCase,
 * consumer-less, flagged for v5.1 cleanup) and is intentionally NOT used here —
 * we reuse the same wire shape the web client already consumes so PR-5d can swap
 * the mock for a real `fetch` with no shape change. `TableStatus` (the status
 * enum) is reused from shared-types.
 *
 * Money is integer kuruş (cents) — never float (ADR-003 §10).
 */
export interface ApiTable {
  id: string;
  tenant_id: string;
  code: string;
  capacity: number | null;
  area_id: string | null;
  status: TableStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Active-order projection (joined in `GET /tables`). Populated while
   * `status === 'occupied'`; all NULL while `status === 'available'`.
   */
  active_order_id: string | null;
  /** Open bill total in integer kuruş. NULL when the table is empty. */
  active_order_total_cents: number | null;
  /** Sum of partial payments in kuruş; NULL when no payment yet. */
  active_order_paid_total_cents: number | null;
  /** ISO-8601 UTC timestamp the active order opened at; NULL when empty. */
  active_order_started_at: string | null;
  /** Display name of the waiter who opened the active order; NULL when empty. */
  active_waiter_name: string | null;
}
