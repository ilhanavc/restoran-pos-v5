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
});
export type PaymentDistributionResponse = z.infer<
  typeof PaymentDistributionResponseSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.6 — GET /reports/top-selling?limit=N
// ─────────────────────────────────────────────────────────────────────────────

export const TopSellingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
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
});
export type TopSellingResponse = z.infer<typeof TopSellingResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.7 — GET /reports/recent-orders?limit=N
// ─────────────────────────────────────────────────────────────────────────────

export const RecentOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
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
});
export type RecentOrdersResponse = z.infer<typeof RecentOrdersResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3.8 — GET /reports/closed-orders?limit=N
// ─────────────────────────────────────────────────────────────────────────────

export const ClosedOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
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
});
export type ClosedOrdersResponse = z.infer<typeof ClosedOrdersResponseSchema>;
