import { z } from 'zod';
import { MoneyCentsSchema } from './money.js';
import { PaymentTypeSchema } from './payment.js';

/**
 * ADR-015 — Anasayfa Rapor Endpoint'leri (Dashboard Reporting API).
 *
 * 8 endpoint = 8 response schema. Hepsi tenant-scoped, takvim günü (tenant TZ),
 * cache yok. Para birimi her zaman kuruş integer (float yok).
 *
 * Endpoint topolojisi (Karar 1, parçalı):
 *   GET /reports/kpi/today-revenue
 *   GET /reports/kpi/order-count
 *   GET /reports/kpi/average-bill
 *   GET /reports/hourly-revenue
 *   GET /reports/payment-distribution
 *   GET /reports/top-selling?limit=N
 *   GET /reports/recent-orders?limit=N
 *   GET /reports/closed-orders?limit=N
 *
 * RBAC (Karar 7): admin + cashier ALLOW; waiter + kitchen DENY (403).
 *
 * Bahşiş ciro DEĞİL (Karar 8): `payments.amount_cents` kullanılır,
 * `tip_amount_cents` rapor toplamlarına dahil edilmez.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ADR-015 Amendment 2 (2026-05-12) — Ortak range query schema.
// 11 endpoint (8 KPI + 3 detail) için tek source-of-truth.
// `range='today'` default; `'custom'` verildiğinde from/to ZORUNLU.
// Z (daily-close) + X (snapshot) endpoint'leri farklı semantikte (kendi `date`/`at`
// param'ları) — onlara dokunmaz. Eski Amendment 1 enum (`today|week|month`)
// kaldırıldı (BREAKING). RangeFilter UI'ı Sprint 15 PR-2'de revize edilecek.
// ─────────────────────────────────────────────────────────────────────────────

export const RangeKindSchema = z.enum([
  'today',
  'yesterday',
  'last7',
  'last30',
  'custom',
]);
export type RangeKind = z.infer<typeof RangeKindSchema>;

const yyyyMmDd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * 11 endpoint için ortak range query schema. Kullanıcı kararı (2026-05-12):
 *   - `range='custom'` EXPLICIT — `from`/`to` o zaman zorunlu.
 *   - "from/to verilirse otomatik custom" implicit davranışı KALDIRILDI.
 *   - custom window max 90 gün (NFR: agregasyon olmayan tek query için makul).
 */
export const ReportRangeQuerySchema = z
  .object({
    range: RangeKindSchema.optional().default('today'),
    from: yyyyMmDd.optional(),
    to: yyyyMmDd.optional(),
  })
  .refine(
    (v) =>
      v.range === 'custom' ? v.from !== undefined && v.to !== undefined : true,
    { message: "range='custom' için from ve to zorunlu", path: ['from'] },
  )
  .refine(
    (v) =>
      v.range === 'custom' || (v.from === undefined && v.to === undefined),
    {
      message:
        "from/to sadece range='custom' ile verilebilir (preset range'lerde yasak)",
      path: ['from'],
    },
  )
  .refine(
    (v) => v.from === undefined || v.to === undefined || v.from <= v.to,
    { message: 'from <= to olmalı', path: ['from'] },
  )
  .refine(
    (v) => {
      if (v.from === undefined || v.to === undefined) return true;
      const start = new Date(`${v.from}T00:00:00Z`).getTime();
      const end = new Date(`${v.to}T00:00:00Z`).getTime();
      const days = (end - start) / 86_400_000;
      return days <= 90;
    },
    { message: 'custom range en fazla 90 gün olabilir', path: ['to'] },
  );
export type ReportRangeQuery = z.infer<typeof ReportRangeQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.1 — GET /reports/kpi/today-revenue
// ─────────────────────────────────────────────────────────────────────────────

export const TodayRevenueResponseSchema = z.object({
  totalRevenueCents: MoneyCentsSchema,
  paidOrderCount: z.number().int().min(0),
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type TodayRevenueResponse = z.infer<typeof TodayRevenueResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.2 — GET /reports/kpi/order-count
// ─────────────────────────────────────────────────────────────────────────────

export const OrderCountResponseSchema = z.object({
  totalOrders: z.number().int().min(0),
  byStatus: z.object({
    open: z.number().int().min(0),
    paid: z.number().int().min(0),
    cancelled: z.number().int().min(0),
  }),
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type OrderCountResponse = z.infer<typeof OrderCountResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.3 — GET /reports/kpi/average-bill
// ─────────────────────────────────────────────────────────────────────────────

export const AverageBillResponseSchema = z.object({
  averageBillCents: MoneyCentsSchema,
  sampleSize: z.number().int().min(0),
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type AverageBillResponse = z.infer<typeof AverageBillResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.4 — GET /reports/hourly-revenue
// ─────────────────────────────────────────────────────────────────────────────

export const HourlyRevenueBucketSchema = z.object({
  hour: z.number().int().min(0).max(23),
  revenueCents: MoneyCentsSchema,
  orderCount: z.number().int().min(0),
});
export type HourlyRevenueBucket = z.infer<typeof HourlyRevenueBucketSchema>;

export const HourlyRevenueResponseSchema = z.object({
  buckets: z.array(HourlyRevenueBucketSchema).length(24),
  asOf: z.string().datetime(),
  timezone: z.string(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type HourlyRevenueResponse = z.infer<typeof HourlyRevenueResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.5 — GET /reports/payment-distribution
// ─────────────────────────────────────────────────────────────────────────────

export const PaymentDistributionSegmentSchema = z.object({
  paymentType: PaymentTypeSchema,
  totalCents: MoneyCentsSchema,
  count: z.number().int().min(0),
  sharePct: z.number().min(0).max(100),
});
export type PaymentDistributionSegment = z.infer<
  typeof PaymentDistributionSegmentSchema
>;

export const PaymentDistributionResponseSchema = z.object({
  segments: z.array(PaymentDistributionSegmentSchema),
  totalCents: MoneyCentsSchema,
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type PaymentDistributionResponse = z.infer<
  typeof PaymentDistributionResponseSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.6 — GET /reports/top-selling?limit=N
// ─────────────────────────────────────────────────────────────────────────────

// ADR-015 Amendment 2 — limit + range birleşik query. `.and()` ile ortak
// range schema'ya extra `limit` ekleniyor; zod object intersection refine'ları
// korur.
export const TopSellingQuerySchema = ReportRangeQuerySchema.and(
  z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
);
export type TopSellingQuery = z.infer<typeof TopSellingQuerySchema>;

export const TopSellingItemSchema = z.object({
  productId: z.string().uuid(),
  productNameSnapshot: z.string(),
  totalQuantity: z.number().int().min(1),
  totalRevenueCents: MoneyCentsSchema,
});
export type TopSellingItem = z.infer<typeof TopSellingItemSchema>;

export const TopSellingResponseSchema = z.object({
  items: z.array(TopSellingItemSchema),
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type TopSellingResponse = z.infer<typeof TopSellingResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.7 — GET /reports/recent-orders?limit=N
// ─────────────────────────────────────────────────────────────────────────────

export const RecentOrdersQuerySchema = ReportRangeQuerySchema.and(
  z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
);
export type RecentOrdersQuery = z.infer<typeof RecentOrdersQuerySchema>;

export const OpenOrderSummarySchema = z.object({
  orderId: z.string().uuid(),
  tableId: z.string().uuid().nullable(),
  tableCode: z.string().nullable(),
  totalCents: MoneyCentsSchema,
  itemCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  waiterName: z.string().nullable(),
});
export type OpenOrderSummary = z.infer<typeof OpenOrderSummarySchema>;

export const RecentOrdersResponseSchema = z.object({
  orders: z.array(OpenOrderSummarySchema),
  totalOpenCount: z.number().int().min(0),
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type RecentOrdersResponse = z.infer<typeof RecentOrdersResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.8 — GET /reports/closed-orders?limit=N
// ─────────────────────────────────────────────────────────────────────────────

export const ClosedOrdersQuerySchema = ReportRangeQuerySchema.and(
  z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
);
export type ClosedOrdersQuery = z.infer<typeof ClosedOrdersQuerySchema>;

export const ClosedOrderSummarySchema = z.object({
  orderId: z.string().uuid(),
  tableCode: z.string().nullable(),
  totalCents: MoneyCentsSchema,
  paidAt: z.string().datetime(),
  paymentTypeMix: z.array(PaymentTypeSchema),
});
export type ClosedOrderSummary = z.infer<typeof ClosedOrderSummarySchema>;

export const ClosedOrdersResponseSchema = z.object({
  orders: z.array(ClosedOrderSummarySchema),
  totalClosedCount: z.number().int().min(0),
  asOf: z.string().datetime(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type ClosedOrdersResponse = z.infer<typeof ClosedOrdersResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.9 — GET /reports/category-sales (ADR-015 Amendment 1, Karar 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Range pencere semantiği (TZ-aware, `tenant_settings.timezone`) —
 * ADR-015 Amendment 2 (2026-05-12, BREAKING):
 *   today | yesterday | last7 | last30 | custom (from/to ile)
 *
 * Eski `week`/`month` enum'ları KALDIRILDI (BREAKING). Frontend Sprint 15 PR-2'de
 * revize edilecek. `range='custom'` verildiğinde `from`+`to` ZORUNLU; preset
 * range'lerde from/to verilirse 400 VALIDATION_ERROR (kullanıcı kararı —
 * implicit override semantiği kaldırıldı).
 */
export const CategorySalesQuerySchema = ReportRangeQuerySchema;
export type CategorySalesQuery = z.infer<typeof CategorySalesQuerySchema>;

export const CategorySalesItemSchema = z.object({
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  qty: z.number().int().nonnegative(),
  revenueCents: MoneyCentsSchema,
  sharePct: z.number().min(0).max(100),
});
export type CategorySalesItem = z.infer<typeof CategorySalesItemSchema>;

export const CategorySalesResponseSchema = z.object({
  categories: z.array(CategorySalesItemSchema),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type CategorySalesResponse = z.infer<typeof CategorySalesResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.10 — GET /reports/anomalies (ADR-015 Amendment 1, Karar 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MVP scope: cancel-only. void/comp her zaman 0/empty döner — domain emit'leri
 * (`order.item_void`, `order.comp_*`) ve `comped_at`/`comp_amount`/`void_at`
 * kolonları henüz mevcut değil. Schema 3 tipi destekler; void/comp emit/storage
 * ayrı PR'da implement edildiğinde response otomatik dolacak.
 *
 * Range pencere semantiği — ADR-015 Amendment 2 (2026-05-12, BREAKING):
 *   today | yesterday | last7 | last30 | custom. `week`/`month` enum'ları
 *   KALDIRILDI.
 *
 * RBAC (Karar 7): admin + cashier ALLOW; waiter + kitchen DENY (403).
 */
export const AnomaliesQuerySchema = ReportRangeQuerySchema;
export type AnomaliesQuery = z.infer<typeof AnomaliesQuerySchema>;

export const AnomaliesSummarySchema = z.object({
  cancelCount: z.number().int().nonnegative(),
  voidCount: z.number().int().nonnegative(),
  compCount: z.number().int().nonnegative(),
  totalLossCents: z.number().int().nonnegative(),
});
export type AnomaliesSummary = z.infer<typeof AnomaliesSummarySchema>;

export const AnomalyDetailSchema = z.object({
  type: z.enum(['cancel', 'void', 'comp']),
  orderId: z.string().uuid(),
  amountCents: z.number().int().nonnegative(),
  reason: z.string().nullable(),
  occurredAt: z.string().datetime(),
  actorUserId: z.string().uuid().nullable(),
});
export type AnomalyDetail = z.infer<typeof AnomalyDetailSchema>;

export const AnomaliesResponseSchema = z.object({
  summary: AnomaliesSummarySchema,
  details: z.array(AnomalyDetailSchema),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type AnomaliesResponse = z.infer<typeof AnomaliesResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.11 — GET /reports/user-performance (ADR-015 Amendment 1, Karar 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Operasyonel yorum (decisions.md §A1.3):
 *   schema'da `orders.cashier_id` YOK; cashier = ödemeyi alan
 *   (`payments.created_by_user_id`). Bu endpoint iki SQL union ile döner:
 *     - waiter row: orders.waiter_user_id × COUNT(orders) × SUM(orders.total_cents)
 *     - cashier row: payments.created_by_user_id × COUNT(DISTINCT payment.order_id)
 *                    × SUM(payments.amount_cents)
 *   Aynı user iki rolde de görünebilir (örn. cashier hem sipariş aldı hem ödeme
 *   aldı) → 2 ayrı row (`role` farklı). Bu kabul.
 *
 * Range pencere semantiği — ADR-015 Amendment 2 (2026-05-12, BREAKING):
 *   today | yesterday | last7 | last30 | custom. `week`/`month` enum'ları
 *   KALDIRILDI.
 *
 * `role` query param:
 *   - `'waiter'` → sadece waiter SQL
 *   - `'cashier'` → sadece cashier SQL
 *   - undefined → her iki SQL union (mixed response)
 *
 * `users` array'i `revenueCents DESC` sıralı.
 *
 * RBAC (Karar 7): admin + cashier ALLOW; waiter + kitchen DENY (403).
 *   Cashier kendi performansını görebilir (Karar 3 onayı: küçük restoran
 *   şeffaflığı).
 *
 * Index audit (Karar A1):
 *   - orders_waiter_user_id_idx ✅ Migration 005
 *   - payments tablosunda created_by_user_id index henüz YOK; küçük tablo
 *     başlangıçta sorun değil. Sprint 14d'de EXPLAIN ANALYZE ile review.
 */
export const UserPerformanceQuerySchema = ReportRangeQuerySchema.and(
  z.object({
    role: z.enum(['cashier', 'waiter']).optional(),
  }),
);
export type UserPerformanceQuery = z.infer<typeof UserPerformanceQuerySchema>;

export const UserPerformanceItemSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  role: z.enum(['cashier', 'waiter']),
  orderCount: z.number().int().nonnegative(),
  revenueCents: MoneyCentsSchema,
  avgBillCents: MoneyCentsSchema,
});
export type UserPerformanceItem = z.infer<typeof UserPerformanceItemSchema>;

export const UserPerformanceResponseSchema = z.object({
  users: z.array(UserPerformanceItemSchema),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});
export type UserPerformanceResponse = z.infer<
  typeof UserPerformanceResponseSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.12 — GET /reports/daily-close (Z) + GET /reports/snapshot (X)
//        ADR-015 Amendment 1, Karar 4 + Karar 5 (shared schema)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Operasyonel yorum (decisions.md §A1.4 + §A1.5):
 *   daily-close (Z): tüm günü kapsayan KPI snapshot
 *     window = [start_of_day(date), end_of_day(date)) — tenant TZ
 *     date undefined → bugün (local TZ)
 *   snapshot (X): gün başlangıcından şu ana kadar (ara kapanış)
 *     window = [start_of_day(at), at) — tenant TZ
 *     at undefined → şu an
 *
 * Karar 5: ortak response schema (DailyCloseResponse) iki endpoint için.
 *
 * Aggregate KPI'lar: totalRevenue/orderCount/avgBill (paid-only),
 * paymentBreakdown (3 ödeme tipi), topCategories (top 5), anomalySummary
 * (cancel-only, void/comp 0), hourlyBuckets (24 entry, hour 0-23 local TZ).
 *
 * RBAC (Karar 7): admin + cashier ALLOW; waiter + kitchen DENY (403).
 */

export const DailyCloseQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type DailyCloseQuery = z.infer<typeof DailyCloseQuerySchema>;

export const SnapshotQuerySchema = z.object({
  at: z.string().datetime().optional(),
});
export type SnapshotQuery = z.infer<typeof SnapshotQuerySchema>;

export const PaymentBreakdownItemSchema = z.object({
  paymentType: PaymentTypeSchema,
  count: z.number().int().nonnegative(),
  amountCents: MoneyCentsSchema,
  sharePct: z.number().min(0).max(100),
});
export type PaymentBreakdownItem = z.infer<typeof PaymentBreakdownItemSchema>;

export const TopCategoryItemSchema = z.object({
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  qty: z.number().int().nonnegative(),
  revenueCents: MoneyCentsSchema,
});
export type TopCategoryItem = z.infer<typeof TopCategoryItemSchema>;

export const AnomalySummaryEmbeddedSchema = z.object({
  cancelCount: z.number().int().nonnegative(),
  voidCount: z.number().int().nonnegative(),
  compCount: z.number().int().nonnegative(),
  totalLossCents: z.number().int().nonnegative(),
});
export type AnomalySummaryEmbedded = z.infer<
  typeof AnomalySummaryEmbeddedSchema
>;

export const DailyCloseHourlyBucketSchema = z.object({
  hour: z.number().int().min(0).max(23),
  orderCount: z.number().int().nonnegative(),
  revenueCents: MoneyCentsSchema,
});
export type DailyCloseHourlyBucket = z.infer<
  typeof DailyCloseHourlyBucketSchema
>;

export const DailyCloseResponseSchema = z.object({
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  totalRevenueCents: MoneyCentsSchema,
  orderCount: z.number().int().nonnegative(),
  avgBillCents: MoneyCentsSchema,
  paymentBreakdown: z.array(PaymentBreakdownItemSchema),
  topCategories: z.array(TopCategoryItemSchema),
  anomalySummary: AnomalySummaryEmbeddedSchema,
  hourlyBuckets: z.array(DailyCloseHourlyBucketSchema).length(24),
});
export type DailyCloseResponse = z.infer<typeof DailyCloseResponseSchema>;
