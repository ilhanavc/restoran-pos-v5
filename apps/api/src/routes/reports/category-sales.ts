import {
  Router,
  type Request,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  CategorySalesQuerySchema,
  CategorySalesResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { resolveRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 1 (Karar 1, 2026-05-11) — GET /reports/category-sales
 * ADR-015 Amendment 2 (2026-05-12, BREAKING) — range enum revize.
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi (compute fn ayrıştırıldı).
 *
 * Query: range=today|yesterday|last7|last30|custom (default today). `custom`
 * için from+to ZORUNLU; preset range'lerde from/to verilirse 400.
 *
 * SQL:
 *   categories LEFT JOIN order_items (paid orders) → kategori bazında qty + revenue.
 *   Paid-only (top-selling/payment-distribution paritesi). Cancelled item dışlanır.
 *   Snapshot field'ı: `order_items.total_cents` (mevcut top-selling endpoint
 *   ile aynı revenue alanı — tutarlılık şart).
 *
 * sharePct JS tarafında: round((rev * 1000) / total) / 10. Total=0 ise 0.
 *
 * RBAC: admin + cashier. waiter + kitchen → 403.
 *
 * Response'a windowStart/windowEnd UTC ISO8601 eklenir (Karar A1, UI tooltip).
 */

type CategorySalesData = {
  categories: Array<{
    categoryId: string;
    categoryName: string;
    qty: number;
    revenueCents: number;
    sharePct: number;
  }>;
  windowStart: string;
  windowEnd: string;
};

export function categorySalesRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<CategorySalesData> => {
    const parsed = CategorySalesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { range, from, to } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = resolveRangeWindow({ range, from, to, tz });

    // categories LEFT JOIN products LEFT JOIN order_items (paid order'lar).
    // Tüm join'lerde tenant_id eşitliği şart (multi-tenant izolasyon).
    // status='cancelled' kalemler revenue/qty hesabından dışlanır.
    // categories.deleted_at IS NULL (soft-delete filter).
    const rows = await deps.db
      .selectFrom('categories as c')
      .leftJoin('products as p', (join) =>
        join
          .onRef('p.category_id', '=', 'c.id')
          .onRef('p.tenant_id', '=', 'c.tenant_id')
          .on('p.deleted_at', 'is', null),
      )
      .leftJoin('order_items as oi', (join) =>
        join
          .onRef('oi.product_id', '=', 'p.id')
          .onRef('oi.tenant_id', '=', 'c.tenant_id')
          .on('oi.status', '!=', 'cancelled'),
      )
      .leftJoin('orders as o', (join) =>
        join
          .onRef('o.id', '=', 'oi.order_id')
          .onRef('o.tenant_id', '=', 'c.tenant_id')
          .on('o.status', '=', 'paid')
          .on('o.created_at', '>=', startUtc)
          .on('o.created_at', '<', endUtc),
      )
      .select((eb) => [
        'c.id as category_id',
        'c.name as category_name',
        eb.fn
          .coalesce(
            // Yalnızca paid order'a bağlı kalemleri say (o.id NOT NULL).
            sql<number>`SUM(CASE WHEN "o"."id" IS NOT NULL THEN "oi"."quantity" ELSE 0 END)`,
            sql<number>`0`,
          )
          .as('qty'),
        eb.fn
          .coalesce(
            sql<number>`SUM(CASE WHEN "o"."id" IS NOT NULL THEN "oi"."total_cents" ELSE 0 END)`,
            sql<number>`0`,
          )
          .as('revenue_cents'),
      ])
      .where('c.tenant_id', '=', tenantId)
      .where('c.deleted_at', 'is', null)
      .groupBy(['c.id', 'c.name'])
      .orderBy('revenue_cents', 'desc')
      .execute();

    const grand = rows.reduce((s, r) => s + Number(r.revenue_cents), 0);
    const categories = rows.map((r) => {
      const revenue = Number(r.revenue_cents);
      const sharePct =
        grand === 0 ? 0 : Math.round((revenue * 1000) / grand) / 10;
      return {
        categoryId: r.category_id,
        categoryName: r.category_name,
        qty: Number(r.qty),
        revenueCents: revenue,
        sharePct,
      };
    });

    return CategorySalesResponseSchema.parse({
      categories,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  const csvSpec: CsvSpec<CategorySalesData> = {
    reportName: 'category-sales',
    toCsv: (data) => ({
      headers: [
        'category_id',
        'category_name',
        'qty',
        'revenue_cents',
        'share_pct',
        'window_start',
        'window_end',
      ],
      rows: data.categories.map((c) => ({
        category_id: c.categoryId,
        category_name: c.categoryName,
        qty: c.qty,
        revenue_cents: c.revenueCents,
        share_pct: c.sharePct,
        window_start: data.windowStart,
        window_end: data.windowEnd,
      })),
    }),
  };

  router.get(
    '/category-sales',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
