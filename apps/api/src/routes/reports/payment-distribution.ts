import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  PaymentDistributionResponseSchema,
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
 * ADR-015 §3.5 (Amendment 2 — 2026-05-12) —
 *   GET /reports/payment-distribution?range=today|yesterday|last7|last30|custom
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * Default `range='today'`. Ödeme tipi (cash|card|transfer) bazında dağılım +
 * sharePct (1 ondalık). Toplam=0 ise segments=[]. Paid-only.
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
  windowStart: string;
  windowEnd: string;
};

export function paymentDistributionRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<PaymentDistributionData> => {
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
        'p.payment_type as payment_type',
        eb.fn.coalesce(eb.fn.sum<number>('p.amount_cents'), sql<number>`0`).as('total'),
        eb.fn.countAll<number>().as('cnt'),
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      .where('p.created_at', '>=', startUtc)
      .where('p.created_at', '<', endUtc)
      // ADR-033 SUM fan-out — void'lenmiş ödeme ödeme-tipi dağılımına SAYILMAZ
      // (reopen→reclose sonrası void satır paid order'da kalır → yoksa çift sayım).
      .where('p.voided_at', 'is', null)
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
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  const csvSpec: CsvSpec<PaymentDistributionData> = {
    reportName: 'payment-distribution',
    toCsv: (data) => ({
      headers: [
        'window_start',
        'window_end',
        'payment_type',
        'count',
        'total_cents',
        'share_pct',
        'grand_total_cents',
        'as_of',
      ],
      rows: data.segments.map((s) => ({
        window_start: data.windowStart,
        window_end: data.windowEnd,
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
