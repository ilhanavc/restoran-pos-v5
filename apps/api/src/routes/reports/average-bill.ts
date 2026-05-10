import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { AverageBillResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.3 (Amendment 4 — 2026-05-05 / Session 53c) — GET /reports/kpi/average-bill
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * SUM(orders.total_cents) / COUNT(*) WHERE bugün AND status='paid'.
 * Paid-only. sampleSize=0 → 0. Math.floor.
 */

type AverageBillData = {
  averageBillCents: number;
  sampleSize: number;
  asOf: string;
};

export function averageBillRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<AverageBillData> => {
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = getCalendarDayWindow(tz);

    const row = await deps.db
      .selectFrom('orders')
      .select((eb) => [
        eb.fn.coalesce(eb.fn.sum<number>('total_cents'), sql<number>`0`).as('total'),
        eb.fn.countAll<number>().as('cnt'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'paid')
      .where('created_at', '>=', startUtc)
      .where('created_at', '<', endUtc)
      .executeTakeFirstOrThrow();

    const total = Number(row.total);
    const cnt = Number(row.cnt);
    const avg = cnt > 0 ? Math.floor(total / cnt) : 0;

    return AverageBillResponseSchema.parse({
      averageBillCents: avg,
      sampleSize: cnt,
      asOf: new Date().toISOString(),
    });
  };

  const csvSpec: CsvSpec<AverageBillData> = {
    reportName: 'average-bill',
    toCsv: (data) => ({
      headers: ['average_bill_cents', 'sample_size', 'as_of'],
      rows: [
        {
          average_bill_cents: data.averageBillCents,
          sample_size: data.sampleSize,
          as_of: data.asOf,
        },
      ],
    }),
  };

  router.get(
    '/kpi/average-bill',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
