/**
 * ADR-002 §13.2.E — Cron lock id registry.
 *
 * `pg_try_advisory_lock(bigint)` — tek-shot 64-bit integer key. İki cron
 * instance aynı anda aynı task'i koşmasın diye her task'e sabit lock id
 * atanır. Yeni task eklenirken bu listeden sıradaki id seçilir; çakışma
 * olmaması için merkezi registry.
 *
 * Numarama düzeni: `4_201_xxx` — "4" cron, "201" TTL cleanup family.
 */
export const CRON_LOCK_IDS = {
  TTL_CLEANUP_AUDIT_LOGS: 4_201_001n,
  TTL_CLEANUP_CALL_LOGS: 4_201_002n,
  TTL_CLEANUP_PRINT_JOBS: 4_201_003n,
} as const;

export type CronLockId = (typeof CRON_LOCK_IDS)[keyof typeof CRON_LOCK_IDS];
