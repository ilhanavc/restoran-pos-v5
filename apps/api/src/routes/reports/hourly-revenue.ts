import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { HourlyRevenueResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.4 — GET /reports/hourly-revenue
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * 24-saatlik bucket array (yerel saat 0-23). Boş saatler 0 ile doldurulur.
 * EXTRACT(HOUR FROM payments.created_at AT TIME ZONE tz). Postgres-spesifik.
 */

type HourlyRevenueData = {
  buckets: Array<{ hour: number; revenueCents: number; orderCount: number }>;
  asOf: string;
  timezone: string;
};

export function hourlyRevenueRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<HourlyRevenueData> => {
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = getCalendarDayWindow(tz);

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
    });
  };

  const csvSpec: CsvSpec<HourlyRevenueData> = {
    reportName: 'hourly-revenue',
    toCsv: (data) => ({
      headers: ['hour', 'revenue_cents', 'order_count', 'timezone', 'as_of'],
      rows: data.buckets.map((b) => ({
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
