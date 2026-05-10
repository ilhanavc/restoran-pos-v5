import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { PaymentDistributionResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.5 — GET /reports/payment-distribution
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * Ödeme tipi (cash|card|transfer) bazında dağılım + sharePct (1 ondalık).
 * Toplam=0 ise segments=[]. Paid-only.
 */

type PaymentDistributionData = {
  segments: Array<{
    paymentType: string;
    totalCents: number;
    count: number;
    sharePct: number;
  }>;
  totalCents: number;
  asOf: string;
};

export function paymentDistributionRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<PaymentDistributionData> => {
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
        'p.payment_type as payment_type',
        eb.fn.coalesce(eb.fn.sum<number>('p.amount_cents'), sql<number>`0`).as('total'),
        eb.fn.countAll<number>().as('cnt'),
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      .where('p.created_at', '>=', startUtc)
      .where('p.created_at', '<', endUtc)
      .groupBy('p.payment_type')
      .execute();

    const grand = rows.reduce((s, r) => s + Number(r.total), 0);
    const segments = grand === 0
      ? []
      : rows.map((r) => {
          const total = Number(r.total);
          const sharePct = Math.round((total * 1000) / grand) / 10;
          return {
            paymentType: r.payment_type,
            totalCents: total,
            count: Number(r.cnt),
            sharePct,
          };
        });

    return PaymentDistributionResponseSchema.parse({
      segments,
      totalCents: grand,
      asOf: new Date().toISOString(),
    });
  };

  const csvSpec: CsvSpec<PaymentDistributionData> = {
    reportName: 'payment-distribution',
    toCsv: (data) => ({
      headers: [
        'payment_type',
        'count',
        'total_cents',
        'share_pct',
        'grand_total_cents',
        'as_of',
      ],
      rows: data.segments.map((s) => ({
        payment_type: s.paymentType,
        count: s.count,
        total_cents: s.totalCents,
        share_pct: s.sharePct,
        grand_total_cents: data.totalCents,
        as_of: data.asOf,
      })),
    }),
  };

  router.get(
    '/payment-distribution',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
