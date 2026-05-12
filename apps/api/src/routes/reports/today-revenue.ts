import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  ReportRangeQuerySchema,
  TodayRevenueResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { resolveRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.1 (Amendment 3 — 2026-05-03; Amendment 2 — 2026-05-12) —
 *   GET /reports/kpi/today-revenue?range=today|yesterday|last7|last30|custom
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * Default `range='today'` — backwards-compatible URL'lerde aynı semantik.
 * SUM(orders.total_cents) WHERE pencere AND status='paid' (Session 53c paid-only).
 * İptal hariç. Bahşiş orders.total_cents'e dahil değil.
 */

type TodayRevenueData = {
  totalRevenueCents: number;
  paidOrderCount: number;
  asOf: string;
  windowStart: string;
  windowEnd: string;
};

export function todayRevenueRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<TodayRevenueData> => {
    const parsed = ReportRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { range, from, to } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = resolveRangeWindow({ range, from, to, tz });

    const row = await deps.db
      .selectFrom('orders')
      .select((eb) => [
        eb.fn.coalesce(eb.fn.sum<number>('total_cents'), sql<number>`0`).as('total'),
        eb.fn.countAll<number>().as('paid_orders'),
      ])
      .where('tenant_id', '=', tenantId)
      // Session 53c (Amendment v2 — 2026-05-05): paid-only.
      .where('status', '=', 'paid')
      .where('created_at', '>=', startUtc)
      .where('created_at', '<', endUtc)
      .executeTakeFirstOrThrow();

    return TodayRevenueResponseSchema.parse({
      totalRevenueCents: Number(row.total),
      paidOrderCount: Number(row.paid_orders),
      asOf: new Date().toISOString(),
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  // Tek satırlık scalar KPI — windowStart/End dosya satırına dahil edilir
  // (RFC 4180 yorum desteklemediği için header üstüne not eklenmez).
  const csvSpec: CsvSpec<TodayRevenueData> = {
    reportName: 'today-revenue',
    toCsv: (data) => ({
      headers: [
        'window_start',
        'window_end',
        'total_revenue_cents',
        'paid_order_count',
        'as_of',
      ],
      rows: [
        {
          window_start: data.windowStart,
          window_end: data.windowEnd,
          total_revenue_cents: data.totalRevenueCents,
          paid_order_count: data.paidOrderCount,
          as_of: data.asOf,
        },
      ],
    }),
  };

  router.get(
    '/kpi/today-revenue',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
