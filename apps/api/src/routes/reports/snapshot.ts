import {
  Router,
  type Request,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  SnapshotQuerySchema,
  DailyCloseResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getSnapshotWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { computeDailyCloseAggregate } from './daily-close-aggregate';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 1 (Karar 5, 2026-05-11) — GET /reports/snapshot (X-Report).
 * ADR-021 PR-4b2 — `?format=csv` desteği eklendi.
 *
 * Karar 5 shared schema: daily-close ile aynı response. CSV header'ları da aynı
 * (tek-satır summary; sub-array'ler ayrı endpoint CSV'leriyle alınır).
 */

type SnapshotData = ReturnType<typeof DailyCloseResponseSchema.parse>;

export function snapshotRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<SnapshotData> => {
    const parsed = SnapshotQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { at } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = getSnapshotWindow(tz, at);

    // ADR-015 Amd5 K2 — snapshot (X) zaman-kesiti modunda KALIR:
    // [günbaşı(at), at) created_at penceresi, davranış Amd5 öncesiyle birebir.
    const aggregate = await computeDailyCloseAggregate({
      db: deps.db,
      tenantId,
      tz,
      window: { kind: 'timeRange', startUtc, endUtc },
      sqlRef: sql,
    });

    return DailyCloseResponseSchema.parse({
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
      ...aggregate,
    });
  };

  const csvSpec: CsvSpec<SnapshotData> = {
    reportName: 'snapshot',
    toCsv: (data) => {
      const top = data.topCategories[0];
      return {
        headers: [
          'window_start',
          'window_end',
          'total_revenue_cents',
          'order_count',
          'avg_bill_cents',
          'cancel_count',
          'total_loss_cents',
          'top_category_name',
          'top_category_revenue_cents',
        ],
        rows: [
          {
            window_start: data.windowStart,
            window_end: data.windowEnd,
            total_revenue_cents: data.totalRevenueCents,
            order_count: data.orderCount,
            avg_bill_cents: data.avgBillCents,
            cancel_count: data.anomalySummary.cancelCount,
            total_loss_cents: data.anomalySummary.totalLossCents,
            top_category_name: top?.categoryName ?? '',
            top_category_revenue_cents: top?.revenueCents ?? 0,
          },
        ],
      };
    },
  };

  router.get(
    '/snapshot',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
