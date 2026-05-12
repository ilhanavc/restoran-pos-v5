import { useQuery } from '@tanstack/react-query';
import type { AnomaliesResponse } from '@restoran-pos/shared-types';
import { api } from '../../lib/api';

/**
 * ADR-015 — Reports page API hooks (PR-5b1).
 *
 * Backend: apps/api/src/routes/reports/anomalies.ts. Tenant-scoped, RBAC
 * admin+cashier. Server wraps payload as `{ data: AnomaliesResponse }`
 * (see csv-format-handler). Poll 60s; window-focus refetch on.
 *
 * KPI tiles (today-revenue / order-count / average-bill) reuse the dashboard
 * hooks from `../dashboard/api/reports`; only the anomalies endpoint is
 * reports-page-specific.
 */

const REPORTS_KEY = ['reports'] as const;
const POLL_MS = 60_000;

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
