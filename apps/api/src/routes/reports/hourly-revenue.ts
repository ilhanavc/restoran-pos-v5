import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  HourlyRevenueResponseSchema,
  ReportRangeQuerySchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { resolveRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.4 (Amendment 2 — 2026-05-12) —
 *   GET /reports/hourly-revenue?range=today|yesterday|last7|last30|custom
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * Default `range='today'`. 24-saatlik bucket array (yerel saat 0-23). Boş
 * saatler 0 ile doldurulur. EXTRACT(HOUR FROM payments.created_at AT TIME ZONE
 * tz). Postgres-spesifik.
 *
 * UYARI (multi-day range): `range=last7|last30` veya custom window tek 24h
 * bucket array'e indirgenir (tüm güne ait saat toplamları toplanır). UI gün
 * bazında detay isterse anomalies / category-sales paritesi gerekir; Sprint 15
 * PR-2'de bu davranış UI tarafında tooltip ile açıklanır.
 */

type HourlyRevenueData = {
  buckets: Array<{ hour: number; revenueCents: number; orderCount: number }>;
  asOf: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
};

export function hourlyRevenueRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<HourlyRevenueData> => {
    const parsed = ReportRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { range, from, to } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = resolveRangeWindow({ range, from, to, tz });

    // Session 53c Amendment v2 (2026-05-05): paid-only.
    const rows = await deps.db
      .selectFrom('payments as p')
      .innerJoin('orders as o', (join) =>
        join
          .onRef('o.id', '=', 'p.order_id')
          .onRef('o.tenant_id', '=', 'p.tenant_id'),
      )
      .select((eb) => [
        sql<number>`EXTRACT(HOUR FROM (p.created_at AT TIME ZONE ${sql.lit(tz)}))::int`.as('hr'),
        eb.fn.coalesce(eb.fn.sum<number>('p.amount_cents'), sql<number>`0`).as('rev'),
        sql<number>`COUNT(DISTINCT p.order_id)`.as('cnt'),
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      .where('p.created_at', '>=', startUtc)
      .where('p.created_at', '<', endUtc)
      // ADR-033 SUM fan-out — void'lenmiş ödeme saatlik ciroya SAYILMAZ.
      .where('p.voided_at', 'is', null)
      .groupBy('hr')
      .execute();

    const map = new Map<number, { revenueCents: number; orderCount: number }>();
    for (const r of rows) {
      map.set(Number(r.hr), {
        revenueCents: Number(r.rev),
        orderCount: Number(r.cnt),
      });
    }
    const buckets = Array.from({ length: 24 }, (_, hour) => {
      const v = map.get(hour);
      return {
        hour,
        revenueCents: v?.revenueCents ?? 0,
        orderCount: v?.orderCount ?? 0,
      };
    });

    return HourlyRevenueResponseSchema.parse({
      buckets,
      asOf: new Date().toISOString(),
      timezone: tz,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  const csvSpec: CsvSpec<HourlyRevenueData> = {
    reportName: 'hourly-revenue',
    toCsv: (data) => ({
      headers: [
        'window_start',
        'window_end',
        'hour',
        'revenue_cents',
        'order_count',
        'timezone',
        'as_of',
      ],
      rows: data.buckets.map((b) => ({
        window_start: data.windowStart,
        window_end: data.windowEnd,
        hour: b.hour,
        revenue_cents: b.revenueCents,
        order_count: b.orderCount,
        timezone: data.timezone,
        as_of: data.asOf,
      })),
    }),
  };

  router.get(
    '/hourly-revenue',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
