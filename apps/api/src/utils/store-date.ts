/**
 * Business date helper'ları.
 *
 * `store_date` ADR-003 §11 gereği DB-otoritatif `business_date`'in vekili.
 * MVP'de cutoff hour yok (Phase 4'te tenant_settings'ten gelecek) —
 * şimdilik UTC midnight = business_date.
 */

/**
 * Bugünün UTC midnight'ı. POST /orders ve GET /orders default'unda kullanılır.
 */
export function todayStoreDate(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * `YYYY-MM-DD` query parametresini UTC midnight Date'e çevirir.
 * Format doğrulaması zod schema seviyesinde yapılmalı (regex /^\d{4}-\d{2}-\d{2}$/).
 */
export function parseDateParam(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
