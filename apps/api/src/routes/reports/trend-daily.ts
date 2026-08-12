import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  ReportRangeQuerySchema,
  TrendDailyResponseSchema,
  type OrderType,
  type TrendDailyResponse,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  enumerateCalendarDates,
  resolveRangeWindow,
  storeDateBound,
} from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 8 K2 (2026-08-11) — GET /reports/trend/daily
 *
 * Gün-gün ciro / sipariş sayısı / ortalama adisyon + kanal (order_type) kırılımı.
 * Sistemdeki ilk GÜN EKSENLİ rapor: çıktı tekil skaler değil, artan sıralı seri.
 *
 * Pencere + gruplama ekseni `orders.store_date` (Amd7 K1/K3) — `created_at`'ten
 * gün TÜRETİLMEZ. Bunun ölçülebilir sonucu: bu endpoint'in D günü `revenueCents`
 * değeri, `today-revenue?range=custom&from=D&to=D` ile BİREBİR aynıdır (A8.5-a).
 *
 * Yalnız `orders` taranır (tek tablo, `FILTER (WHERE ...)` agregasyonları) —
 * `payments`/`order_items` join'i YOK (K2: üç ayrı tarama profili, üç endpoint).
 */

/** Kanal kırılımının sabit anahtar kümesi (K5) — 0 olsa bile HER GÜN basılır. */
const CHANNELS: readonly OrderType[] = ['dine_in', 'takeaway', 'delivery'];

/** Bir günün SQL'den okunan ham toplamları. */
interface DailyRow {
  readonly store_date: string;
  readonly revenue_cents: number;
  readonly order_count: number;
  readonly dine_in_revenue: number;
  readonly dine_in_count: number;
  readonly takeaway_revenue: number;
  readonly takeaway_count: number;
  readonly delivery_revenue: number;
  readonly delivery_count: number;
}

export function trendDailyRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<TrendDailyResponse> => {
    const parsed = ReportRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { range, from, to } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc, startDate, endDate } = resolveRangeWindow({
      range,
      from,
      to,
      tz,
    });

    // `store_date` PG `date` kolonu; `to_char` ile TZ'siz `YYYY-MM-DD` string'e
    // çevrilir. Ham `date` okunsaydı node-postgres onu JS `Date`'e (süreç TZ'si)
    // parse eder, gün etiketi UTC-batısı host'ta kayardı (Amd7 K3 sınıfı hata).
    const rows = await deps.db
      .selectFrom('orders as o')
      .select((eb) => [
        sql<string>`to_char("o"."store_date", 'YYYY-MM-DD')`.as('store_date'),
        eb.fn.coalesce(eb.fn.sum<number>('o.total_cents'), sql<number>`0`).as('revenue_cents'),
        eb.fn.countAll<number>().as('order_count'),
        sql<number>`COALESCE(SUM("o"."total_cents") FILTER (WHERE "o"."order_type" = 'dine_in'), 0)`.as('dine_in_revenue'),
        sql<number>`COUNT(*) FILTER (WHERE "o"."order_type" = 'dine_in')`.as('dine_in_count'),
        sql<number>`COALESCE(SUM("o"."total_cents") FILTER (WHERE "o"."order_type" = 'takeaway'), 0)`.as('takeaway_revenue'),
        sql<number>`COUNT(*) FILTER (WHERE "o"."order_type" = 'takeaway')`.as('takeaway_count'),
        sql<number>`COALESCE(SUM("o"."total_cents") FILTER (WHERE "o"."order_type" = 'delivery'), 0)`.as('delivery_revenue'),
        sql<number>`COUNT(*) FILTER (WHERE "o"."order_type" = 'delivery')`.as('delivery_count'),
      ])
      .where('o.tenant_id', '=', tenantId)
      // Amd v2 paid-only matrisi — mevcut ciro raporlarıyla AYNI küme (K6).
      .where('o.status', '=', 'paid')
      // ADR-015 Amd7 K1/K3 — tek eksen: siparişin iş-günü, `YYYY-MM-DD`::date bağlama.
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
      .groupBy('o.store_date')
      .execute();

    const byDate = new Map<string, DailyRow>();
    for (const r of rows) {
      byDate.set(r.store_date, r as DailyRow);
    }

    // K4 — tam seri: aralıktaki HER takvim günü, veri yoksa 0.
    const points = enumerateCalendarDates(startDate, endDate).map((date) => {
      const row = byDate.get(date);
      const revenueCents = row === undefined ? 0 : Number(row.revenue_cents);
      const orderCount = row === undefined ? 0 : Number(row.order_count);
      return {
        date,
        revenueCents,
        orderCount,
        // K6 / §3.3 — integer division (float para YASAK); örneklem 0 ise 0.
        averageBillCents:
          orderCount === 0 ? 0 : Math.floor(revenueCents / orderCount),
        channels: CHANNELS.map((orderType) => ({
          orderType,
          revenueCents: row === undefined ? 0 : channelRevenue(row, orderType),
          orderCount: row === undefined ? 0 : channelCount(row, orderType),
        })),
      };
    });

    return TrendDailyResponseSchema.parse({
      points,
      totalRevenueCents: points.reduce((s, p) => s + p.revenueCents, 0),
      totalOrderCount: points.reduce((s, p) => s + p.orderCount, 0),
      asOf: new Date().toISOString(),
      timezone: tz,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  // K13 — CSV long-format: gün başına 1 satır, kanal kolonları yanına açılır
  // (Excel pivot dostu; başlık sırası kilitli).
  const csvSpec: CsvSpec<TrendDailyResponse> = {
    reportName: 'trend-daily',
    auditQueryKeys: ['range', 'from', 'to', 'format'],
    toCsv: (data) => ({
      headers: [
        'date',
        'revenue_cents',
        'order_count',
        'average_bill_cents',
        'dine_in_revenue_cents',
        'dine_in_order_count',
        'takeaway_revenue_cents',
        'takeaway_order_count',
        'delivery_revenue_cents',
        'delivery_order_count',
        'timezone',
        'as_of',
      ],
      rows: data.points.map((p) => {
        const ch = (type: OrderType): { revenueCents: number; orderCount: number } =>
          p.channels.find((c) => c.orderType === type) ?? {
            revenueCents: 0,
            orderCount: 0,
          };
        return {
          date: p.date,
          revenue_cents: p.revenueCents,
          order_count: p.orderCount,
          average_bill_cents: p.averageBillCents,
          dine_in_revenue_cents: ch('dine_in').revenueCents,
          dine_in_order_count: ch('dine_in').orderCount,
          takeaway_revenue_cents: ch('takeaway').revenueCents,
          takeaway_order_count: ch('takeaway').orderCount,
          delivery_revenue_cents: ch('delivery').revenueCents,
          delivery_order_count: ch('delivery').orderCount,
          timezone: data.timezone,
          as_of: data.asOf,
        };
      }),
    }),
  };

  router.get(
    '/trend/daily',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}

/** Kanal cirosu — `FILTER` kolonlarını enum üzerinden okur (tip güvenli switch). */
function channelRevenue(row: DailyRow, orderType: OrderType): number {
  switch (orderType) {
    case 'dine_in':
      return Number(row.dine_in_revenue);
    case 'takeaway':
      return Number(row.takeaway_revenue);
    case 'delivery':
      return Number(row.delivery_revenue);
  }
}

/** Kanal sipariş sayısı — `channelRevenue` aynası. */
function channelCount(row: DailyRow, orderType: OrderType): number {
  switch (orderType) {
    case 'dine_in':
      return Number(row.dine_in_count);
    case 'takeaway':
      return Number(row.takeaway_count);
    case 'delivery':
      return Number(row.delivery_count);
  }
}
