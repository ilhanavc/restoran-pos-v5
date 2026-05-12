import { useQuery } from '@tanstack/react-query';
import type {
  AnomaliesResponse,
  CategorySalesResponse,
  ReportRangeQuery,
  UserPerformanceResponse,
} from '@restoran-pos/shared-types';
import { api } from '../../lib/api';
import { buildRangeQS } from '../dashboard/api/reports';

/**
 * ADR-015 — Reports page API hooks (PR-5b1 + PR-5c).
 *
 * Backend routes (apps/api/src/routes/reports/*.ts) are tenant-scoped, RBAC
 * admin+cashier. All three endpoints pass through `csv-format-handler` which
 * wraps the JSON payload as `{ data: T }` — hence the `res.data.data` unwrap.
 * Poll cadence: 60s with window-focus refetch on; staleTime 30-60s keeps
 * navigation snappy without hammering the API.
 *
 * KPI tiles (today-revenue / order-count / average-bill) reuse the dashboard
 * hooks from `../dashboard/api/reports`. Reports-page-specific endpoints
 * (anomalies + PR-5c detail panels) live here.
 */

const REPORTS_KEY = ['reports'] as const;
const POLL_MS = 60_000;

/** Stable key fragment so cache hits across components share data. */
function rangeKey(query?: ReportRangeQuery): readonly unknown[] {
  return [query?.range ?? 'today', query?.from ?? null, query?.to ?? null];
}

/**
 * ADR-015 §A1.6 — anomaly summary + details (cancel/void/comp).
 * Sprint 15 PR-1 added the `range` query param; defaults to today server-side.
 */
export function useAnomalies(query?: ReportRangeQuery) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'anomalies', ...rangeKey(query)],
    queryFn: async (): Promise<AnomaliesResponse> => {
      const res = await api.get<{ data: AnomaliesResponse }>(
        `/reports/anomalies${buildRangeQS(query)}`,
      );
      return res.data.data;
    },
    refetchInterval: POLL_MS,
    staleTime: 30_000,
  });
}

/**
 * ADR-015 — per-category revenue + share for the given window.
 * Sprint 15 PR-1 replaced `range=today|week|month` with the canonical
 * `ReportRangeQuery` shape (today / yesterday / last7 / last30 / custom).
 */
export function useCategorySales(query?: ReportRangeQuery) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'category-sales', ...rangeKey(query)],
    queryFn: async (): Promise<CategorySalesResponse> => {
      const res = await api.get<{ data: CategorySalesResponse }>(
        `/reports/category-sales${buildRangeQS(query)}`,
      );
      return res.data.data;
    },
    refetchInterval: POLL_MS,
    staleTime: 60_000,
  });
}

/**
 * ADR-015 — per-user (cashier/waiter) order count, revenue, average bill.
 * Same `ReportRangeQuery` contract as `useCategorySales`.
 */
export function useUserPerformance(query?: ReportRangeQuery) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'user-performance', ...rangeKey(query)],
    queryFn: async (): Promise<UserPerformanceResponse> => {
      const res = await api.get<{ data: UserPerformanceResponse }>(
        `/reports/user-performance${buildRangeQS(query)}`,
      );
      return res.data.data;
    },
    refetchInterval: POLL_MS,
    staleTime: 60_000,
  });
}
