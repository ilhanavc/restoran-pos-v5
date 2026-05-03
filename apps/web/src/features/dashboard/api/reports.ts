import { useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useTodayRevenue() {
  return useQuery(makeQuery<TodayRevenue>(['today-revenue'], '/reports/kpi/today-revenue'));
}
export function useOrderCount() {
  return useQuery(makeQuery<OrderCount>(['order-count'], '/reports/kpi/order-count'));
}
export function useAverageBill() {
  return useQuery(makeQuery<AverageBill>(['average-bill'], '/reports/kpi/average-bill'));
}
export function useHourlyRevenue() {
  return useQuery(makeQuery<HourlyRevenue>(['hourly-revenue'], '/reports/hourly-revenue'));
}
export function usePaymentDistribution() {
  return useQuery(
    makeQuery<PaymentDistribution>(['payment-distribution'], '/reports/payment-distribution'),
  );
}
export function useTopSelling(limit = 5) {
  return useQuery(
    makeQuery<TopSelling>(['top-selling', limit], `/reports/top-selling?limit=${limit}`),
  );
}
export function useRecentOrders(limit = 5) {
  return useQuery(
    makeQuery<RecentOrders>(['recent-orders', limit], `/reports/recent-orders?limit=${limit}`),
  );
}
export function useClosedOrders(limit = 5) {
  return useQuery(
    makeQuery<ClosedOrders>(['closed-orders', limit], `/reports/closed-orders?limit=${limit}`),
  );
}

/** Tüm reports query'lerini invalidate eder (Yenile butonu). */
export function useRefreshReports() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: REPORTS_KEY });
  };
}
