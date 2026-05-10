import { Router, type Request, type Router as ExpressRouter } from 'express';
import { type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { OrderCountResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.2 (Session 53c Amendment 2026-05-05) — GET /reports/kpi/order-count
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * Bugünkü kapanmış sipariş sayısı + status breakdown (forensic).
 * `totalOrders` SEMANTİĞİ: paid count (Session 53c).
 */

type OrderCountData = {
  totalOrders: number;
  byStatus: { open: number; paid: number; cancelled: number };
  asOf: string;
  windowStart: string;
  windowEnd: string;
};

export function orderCountRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<OrderCountData> => {
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = getCalendarDayWindow(tz);

    const rows = await deps.db
      .selectFrom('orders')
      .select((eb) => [
        'status',
        eb.fn.countAll<number>().as('cnt'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('created_at', '>=', startUtc)
      .where('created_at', '<', endUtc)
      .groupBy('status')
      .execute();

    let open = 0;
    let paid = 0;
    let cancelled = 0;
    for (const r of rows) {
      const c = Number(r.cnt);
      if (r.status === 'paid') paid += c;
      else if (r.status === 'cancelled' || r.status === 'void') cancelled += c;
      else open += c;
    }
    const total = paid;

    return OrderCountResponseSchema.parse({
      totalOrders: total,
      byStatus: { open, paid, cancelled },
      asOf: new Date().toISOString(),
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  // Tek satır KPI — open/paid/cancelled ayrı kolonlar olarak yatay açılır.
  const csvSpec: CsvSpec<OrderCountData> = {
    reportName: 'order-count',
    toCsv: (data) => ({
      headers: [
        'window_start',
        'window_end',
        'total_orders',
        'open',
        'paid',
        'cancelled',
        'as_of',
      ],
      rows: [
        {
          window_start: data.windowStart,
          window_end: data.windowEnd,
          total_orders: data.totalOrders,
          open: data.byStatus.open,
          paid: data.byStatus.paid,
          cancelled: data.byStatus.cancelled,
          as_of: data.asOf,
        },
      ],
    }),
  };

  router.get(
    '/kpi/order-count',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
