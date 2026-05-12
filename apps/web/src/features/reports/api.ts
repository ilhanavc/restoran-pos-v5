import { useQuery } from '@tanstack/react-query';
import type {
  AnomaliesResponse,
  CategorySalesResponse,
  UserPerformanceResponse,
} from '@restoran-pos/shared-types';
import { api } from '../../lib/api';

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

/** ADR-015 §A1.6 — anomaly summary + details (cancel/void/comp). */
export function useAnomalies() {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'anomalies'],
    queryFn: async (): Promise<AnomaliesResponse> => {
      const res = await api.get<{ data: AnomaliesResponse }>('/reports/anomalies');
      return res.data.data;
    },
    refetchInterval: POLL_MS,
    staleTime: 30_000,
  });
}

/**
 * ADR-015 — per-category revenue + share for the given window.
 * Backend currently honors `range=today|week|month`; default `today` matches
 * the rest of the reports page until range filter ships.
 */
export function useCategorySales(range: 'today' | 'week' | 'month' = 'today') {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'category-sales', range],
    queryFn: async (): Promise<CategorySalesResponse> => {
      const res = await api.get<{ data: CategorySalesResponse }>(
        `/reports/category-sales?range=${range}`,
      );
      return res.data.data;
    },
    refetchInterval: POLL_MS,
    staleTime: 60_000,
  });
}

/**
 * ADR-015 — per-user (cashier/waiter) order count, revenue, average bill.
 * Same `range` contract as `useCategorySales`.
 */
export function useUserPerformance(range: 'today' | 'week' | 'month' = 'today') {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'user-performance', range],
    queryFn: async (): Promise<UserPerformanceResponse> => {
      const res = await api.get<{ data: UserPerformanceResponse }>(
        `/reports/user-performance?range=${range}`,
      );
      return res.data.data;
    },
    refetchInterval: POLL_MS,
    staleTime: 60_000,
  });
}
