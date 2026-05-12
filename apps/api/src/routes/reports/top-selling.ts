import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  TopSellingQuerySchema,
  TopSellingResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { resolveRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.6 (Session 53c Amendment 2026-05-05; Amendment 2 — 2026-05-12) —
 *   GET /reports/top-selling?limit=N&range=today|yesterday|last7|last30|custom
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * Default `range='today'`. Paid-only: yalnız ödenmiş siparişlerin kalemleri
 * "satış" sayılır. GROUP BY product_id + product_name (snapshot — v3 paritesi).
 *
 * NFR (Amendment 2): `last30` ile büyük dataset → product_id index var (Migration 005).
 */

type TopSellingData = {
  items: Array<{
    productId: string;
    productNameSnapshot: string;
    totalQuantity: number;
    totalRevenueCents: number;
  }>;
  asOf: string;
  windowStart: string;
  windowEnd: string;
};

export function topSellingRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<TopSellingData> => {
    const parsed = TopSellingQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { limit, range, from, to } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = resolveRangeWindow({ range, from, to, tz });

    const rows = await deps.db
      .selectFrom('order_items as oi')
      .innerJoin('orders as o', 'o.id', 'oi.order_id')
      .select((eb) => [
        'oi.product_id as product_id',
        'oi.product_name as product_name',
        eb.fn.sum<number>('oi.quantity').as('qty'),
        eb.fn.sum<number>('oi.total_cents').as('rev'),
      ])
      .where('oi.tenant_id', '=', tenantId)
      .where('oi.status', '!=', 'cancelled')
      .where('o.status', '=', 'paid')
      .where('o.created_at', '>=', startUtc)
      .where('o.created_at', '<', endUtc)
      .where('oi.product_id', 'is not', null)
      .groupBy(['oi.product_id', 'oi.product_name'])
      .orderBy(sql`SUM(oi.quantity)`, 'desc')
      .limit(limit)
      .execute();

    const items = rows
      .filter((r) => r.product_id !== null)
      .map((r) => ({
        productId: r.product_id as string,
        productNameSnapshot: r.product_name,
        totalQuantity: Number(r.qty),
        totalRevenueCents: Number(r.rev),
      }));

    return TopSellingResponseSchema.parse({
      items,
      asOf: new Date().toISOString(),
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  const csvSpec: CsvSpec<TopSellingData> = {
    reportName: 'top-selling',
    toCsv: (data) => ({
      headers: [
        'window_start',
        'window_end',
        'product_id',
        'product_name',
        'total_quantity',
        'total_revenue_cents',
        'as_of',
      ],
      rows: data.items.map((i) => ({
        window_start: data.windowStart,
        window_end: data.windowEnd,
        product_id: i.productId,
        product_name: i.productNameSnapshot,
        total_quantity: i.totalQuantity,
        total_revenue_cents: i.totalRevenueCents,
        as_of: data.asOf,
      })),
    }),
  };

  router.get(
    '/top-selling',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
