import { useQuery } from '@tanstack/react-query';
import type {
  AnomaliesResponse,
  CategorySalesResponse,
  ChannelMixResponse,
  ReportRangeQuery,
  TablePerformanceResponse,
  TipsReportResponse,
  TrendDailyResponse,
  TrendDimension,
  TrendPaymentMixResponse,
  TrendProductMixResponse,
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

/**
 * ADR-015 Amendment 8 K15 — trend + bahşiş hook'ları POLL ETMEZ.
 *
 * Diğer panellerin 60 sn polling'i "bugün" içindir; trend/bahşiş geçmiş günleri
 * okur ve nadiren değişir. `refetchInterval` yok, `staleTime` 5 dk → refetch
 * yalnız mount + aralık değişiminde. Sonuç: `reportsLimiter` (120/dk-IP)
 * bütçesine sayfa açılışında +4 istek, sonrasında sıfır.
 */
const TREND_STALE_MS = 5 * 60_000;

/** ADR-015 Amd8 K2 — gün-gün ciro / sipariş / ortalama adisyon + kanal kırılımı. */
export function useTrendDaily(query?: ReportRangeQuery) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'trend-daily', ...rangeKey(query)],
    queryFn: async (): Promise<TrendDailyResponse> => {
      const res = await api.get<{ data: TrendDailyResponse }>(
        `/reports/trend/daily${buildRangeQS(query)}`,
      );
      return res.data.data;
    },
    staleTime: TREND_STALE_MS,
  });
}

/** ADR-015 Amd8 K2 — gün × ödeme türü serisi. */
export function useTrendPaymentMix(query?: ReportRangeQuery) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'trend-payment-mix', ...rangeKey(query)],
    queryFn: async (): Promise<TrendPaymentMixResponse> => {
      const res = await api.get<{ data: TrendPaymentMixResponse }>(
        `/reports/trend/payment-mix${buildRangeQS(query)}`,
      );
      return res.data.data;
    },
    staleTime: TREND_STALE_MS,
  });
}

/**
 * ADR-015 Amd8 K7 — gün × varlık (kategori|ürün) serisi, Top-N + `other`.
 * `dimension` cache anahtarının parçası: boyut değişimi yeni sorgu üretir.
 */
export function useTrendProductMix(
  dimension: TrendDimension,
  query?: ReportRangeQuery,
) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'trend-product-mix', dimension, ...rangeKey(query)],
    queryFn: async (): Promise<TrendProductMixResponse> => {
      const qs = buildRangeQS(query);
      const sep = qs === '' ? '?' : '&';
      const res = await api.get<{ data: TrendProductMixResponse }>(
        `/reports/trend/product-mix${qs}${sep}dimension=${dimension}`,
      );
      return res.data.data;
    },
    staleTime: TREND_STALE_MS,
  });
}

/**
 * ADR-015 Amd8 K9 — bahşiş toplamı. Backend ADMIN-ONLY (`reports.tips.read`);
 * çağıran bileşen zaten yalnız admin'de render edilir (`enabled` ile ikinci
 * emniyet: kasiyerde istek HİÇ atılmaz, 403 gürültüsü olmaz).
 */
export function useTips(query?: ReportRangeQuery, enabled = true) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'tips', ...rangeKey(query)],
    queryFn: async (): Promise<TipsReportResponse> => {
      const res = await api.get<{ data: TipsReportResponse }>(
        `/reports/tips${buildRangeQS(query)}`,
      );
      return res.data.data;
    },
    enabled,
    staleTime: TREND_STALE_MS,
  });
}

/**
 * ADR-015 Amendment 9 K18 — masa/kanal panelleri sayfanın ORTAK
 * `RangeFilter`'ına bağlıdır (Amd8 trend/tips'ten bilinçli sapma): iki panel
 * arasındaki toplam invariantı (K11) ancak aynı pencerede okunursa tutar.
 *
 * `staleTime` 60 sn — sayfanın diğer aralık-bağımlı panelleriyle aynı davranış.
 * Polling YOK; sayfa açılışına +2 istek → `reportsLimiter` (120/dk-IP) bütçesi
 * bol headroom bırakır, limiter DEĞİŞMEZ.
 */
const RANGE_PANEL_STALE_MS = 60_000;

/**
 * ADR-015 Amd9 — masa (KOD ekseni) performansı; yalnız `dine_in` + `paid`.
 * `limit` cache anahtarının parçasıdır (kırpma değişimi yeni sorgu üretir).
 */
export function useTablePerformance(query?: ReportRangeQuery, limit = 25) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'table-performance', limit, ...rangeKey(query)],
    queryFn: async (): Promise<TablePerformanceResponse> => {
      const qs = buildRangeQS(query);
      const sep = qs === '' ? '?' : '&';
      const res = await api.get<{ data: TablePerformanceResponse }>(
        `/reports/table-performance${qs}${sep}limit=${limit}`,
      );
      return res.data.data;
    },
    staleTime: RANGE_PANEL_STALE_MS,
  });
}

/** ADR-015 Amd9 — kanal dağılımı (3 order_type) + 24 saatlik sipariş kovası. */
export function useChannelMix(query?: ReportRangeQuery) {
  return useQuery({
    queryKey: [...REPORTS_KEY, 'channel-mix', ...rangeKey(query)],
    queryFn: async (): Promise<ChannelMixResponse> => {
      const res = await api.get<{ data: ChannelMixResponse }>(
        `/reports/channel-mix${buildRangeQS(query)}`,
      );
      return res.data.data;
    },
    staleTime: RANGE_PANEL_STALE_MS,
  });
}
