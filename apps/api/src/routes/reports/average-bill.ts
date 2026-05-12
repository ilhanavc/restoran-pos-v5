import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  AverageBillResponseSchema,
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
 * ADR-015 §3.3 (Amendment 4 — 2026-05-05 / Session 53c; Amendment 2 — 2026-05-12) —
 *   GET /reports/kpi/average-bill?range=today|yesterday|last7|last30|custom
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * Default `range='today'`. SUM(orders.total_cents) / COUNT(*) WHERE pencere AND
 * status='paid'. Paid-only. sampleSize=0 → 0. Math.floor.
 */

type AverageBillData = {
  averageBillCents: number;
  sampleSize: number;
  asOf: string;
  windowStart: string;
  windowEnd: string;
};

export function averageBillRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<AverageBillData> => {
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
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  const csvSpec: CsvSpec<AverageBillData> = {
    reportName: 'average-bill',
    toCsv: (data) => ({
      headers: [
        'window_start',
        'window_end',
        'average_bill_cents',
        'sample_size',
        'as_of',
      ],
      rows: [
        {
          window_start: data.windowStart,
          window_end: data.windowEnd,
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
