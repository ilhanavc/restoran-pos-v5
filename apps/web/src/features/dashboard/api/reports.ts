import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { api } from '../../../lib/api';

/**
 * ADR-015 — Anasayfa Rapor API hooks (8 endpoint).
 *
 * Backend: apps/api/src/routes/reports/. Tümü tenant-scoped, admin+cashier RBAC.
 * Polling 60s; window-focus refetch açık. Cache yok server tarafında (Karar 6).
 */

// ─── Types (server response shapes) ────────────────────────────────────────

export type PaymentType = 'cash' | 'card' | 'transfer';

export interface TodayRevenue {
  totalRevenueCents: number;
  paidOrderCount: number;
  asOf: string;
  windowStart: string;
  windowEnd: string;
}

export interface OrderCount {
  totalOrders: number;
  byStatus: { open: number; paid: number; cancelled: number };
  asOf: string;
  windowStart: string;
  windowEnd: string;
}

export interface AverageBill {
  averageBillCents: number;
  sampleSize: number;
  asOf: string;
}

export interface HourlyRevenueBucket {
  hour: number;
  revenueCents: number;
  orderCount: number;
}
export interface HourlyRevenue {
  buckets: HourlyRevenueBucket[];
  asOf: string;
  timezone: string;
}

export interface PaymentDistributionSegment {
  paymentType: PaymentType;
  totalCents: number;
  count: number;
  sharePct: number;
}
export interface PaymentDistribution {
  segments: PaymentDistributionSegment[];
  totalCents: number;
  asOf: string;
}

export interface TopSellingItem {
  productId: string;
  productNameSnapshot: string;
  totalQuantity: number;
  totalRevenueCents: number;
}
export interface TopSelling {
  items: TopSellingItem[];
  asOf: string;
}

export interface OpenOrderSummary {
  orderId: string;
  tableId: string | null;
  tableCode: string | null;
  totalCents: number;
  itemCount: number;
  createdAt: string;
  waiterName: string | null;
}
export interface RecentOrders {
  orders: OpenOrderSummary[];
  totalOpenCount: number;
  asOf: string;
}

export interface ClosedOrderSummary {
  orderId: string;
  tableCode: string | null;
  totalCents: number;
  paidAt: string;
  paymentTypeMix: PaymentType[];
}
export interface ClosedOrders {
  orders: ClosedOrderSummary[];
  totalClosedCount: number;
  asOf: string;
}

// ─── Query keys ────────────────────────────────────────────────────────────

export const REPORTS_KEY = ['reports'] as const;
const POLL_MS = 60_000;

/**
 * Serialize ReportRangeQuery to a `?range=…&from=…&to=…` string (or empty).
 *
 * Sprint 15 PR-1 backend contract: every report endpoint accepts an optional
 * `range` query. Preset kinds drop `from`/`to`; `custom` requires both.
 */
export function buildRangeQS(query?: ReportRangeQuery): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.range) params.set('range', query.range);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Append range params onto an existing query string (preserves the leading separator). */
function appendRangeQS(base: string, query?: ReportRangeQuery): string {
  if (!query) return base;
  const params = new URLSearchParams();
  if (query.range) params.set('range', query.range);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const extra = params.toString();
  if (!extra) return base;
  return base.includes('?') ? `${base}&${extra}` : `${base}?${extra}`;
}

function makeQuery<T>(suffix: readonly unknown[], path: string) {
  return {
    queryKey: [...REPORTS_KEY, ...suffix],
    queryFn: async (): Promise<T> => {
      const res = await api.get<{ data: T }>(path);
      return res.data.data;
    },
    refetchInterval: POLL_MS,
    staleTime: 30_000,
  };
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

/** Stable key fragment so two callers with the same range share cache. */
function rangeKey(query?: ReportRangeQuery): readonly unknown[] {
  return [query?.range ?? 'today', query?.from ?? null, query?.to ?? null];
}

export function useTodayRevenue(query?: ReportRangeQuery) {
  return useQuery(
    makeQuery<TodayRevenue>(
      ['today-revenue', ...rangeKey(query)],
      `/reports/kpi/today-revenue${buildRangeQS(query)}`,
    ),
  );
}
export function useOrderCount(query?: ReportRangeQuery) {
  return useQuery(
    makeQuery<OrderCount>(
      ['order-count', ...rangeKey(query)],
      `/reports/kpi/order-count${buildRangeQS(query)}`,
    ),
  );
}
export function useAverageBill(query?: ReportRangeQuery) {
  return useQuery(
    makeQuery<AverageBill>(
      ['average-bill', ...rangeKey(query)],
      `/reports/kpi/average-bill${buildRangeQS(query)}`,
    ),
  );
}
export function useHourlyRevenue(query?: ReportRangeQuery) {
  return useQuery(
    makeQuery<HourlyRevenue>(
      ['hourly-revenue', ...rangeKey(query)],
      `/reports/hourly-revenue${buildRangeQS(query)}`,
    ),
  );
}
export function usePaymentDistribution(query?: ReportRangeQuery) {
  return useQuery(
    makeQuery<PaymentDistribution>(
      ['payment-distribution', ...rangeKey(query)],
      `/reports/payment-distribution${buildRangeQS(query)}`,
    ),
  );
}
export function useTopSelling(limit = 5, query?: ReportRangeQuery) {
  return useQuery(
    makeQuery<TopSelling>(
      ['top-selling', limit, ...rangeKey(query)],
      appendRangeQS(`/reports/top-selling?limit=${limit}`, query),
    ),
  );
}
export function useRecentOrders(limit = 5, query?: ReportRangeQuery) {
  return useQuery(
    makeQuery<RecentOrders>(
      ['recent-orders', limit, ...rangeKey(query)],
      appendRangeQS(`/reports/recent-orders?limit=${limit}`, query),
    ),
  );
}
export function useClosedOrders(limit = 5, query?: ReportRangeQuery) {
  return useQuery(
    makeQuery<ClosedOrders>(
      ['closed-orders', limit, ...rangeKey(query)],
      appendRangeQS(`/reports/closed-orders?limit=${limit}`, query),
    ),
  );
}

/** Tüm reports query'lerini invalidate eder (Yenile butonu). */
export function useRefreshReports() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: REPORTS_KEY });
  };
}
