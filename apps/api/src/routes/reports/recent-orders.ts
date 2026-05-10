import {
  Router,
  type Request,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  RecentOrdersQuerySchema,
  RecentOrdersResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.7 (Session 53c Amendment 2026-05-05) — GET /reports/recent-orders
 * ADR-021 PR-4b2 — `?format=csv` desteği eklendi.
 *
 * Schema customer info içermez (tableCode + waiterName) → PII mask GEREKMEZ.
 * Paid-only: yalnız ödenmiş siparişler.
 */

type RecentOrdersData = ReturnType<typeof RecentOrdersResponseSchema.parse>;

export function recentOrdersRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<RecentOrdersData> => {
    const parsed = RecentOrdersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { limit } = parsed.data;
    const tenantId = req.user!.tenantId;

    const rows = await deps.db
      .selectFrom('orders as o')
      .leftJoin('tables as t', 't.id', 'o.table_id')
      .leftJoin('users as u', 'u.id', 'o.waiter_user_id')
      .select((eb) => [
        'o.id as order_id',
        'o.table_id',
        't.code as table_code',
        'o.total_cents',
        'o.created_at',
        'u.username as waiter_username',
        eb
          .selectFrom('order_items as oi')
          .select(eb2 => eb2.fn.coalesce(eb2.fn.sum<number>('oi.quantity'), sql<number>`0`).as('c'))
          .whereRef('oi.order_id', '=', 'o.id')
          .where('oi.status', '!=', 'cancelled')
          .as('item_count'),
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      .orderBy('o.created_at', 'desc')
      .limit(limit)
      .execute();

    const totalRow = await deps.db
      .selectFrom('orders')
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'paid')
      .executeTakeFirstOrThrow();

    const orders = rows.map((r) => ({
      orderId: r.order_id,
      tableId: r.table_id,
      tableCode: r.table_code,
      totalCents: Number(r.total_cents),
      itemCount: Number(r.item_count ?? 0),
      createdAt: new Date(r.created_at as unknown as string | Date).toISOString(),
      waiterName: r.waiter_username,
    }));

    return RecentOrdersResponseSchema.parse({
      orders,
      totalOpenCount: Number(totalRow.cnt),
      asOf: new Date().toISOString(),
    });
  };

  const csvSpec: CsvSpec<RecentOrdersData> = {
    reportName: 'recent-orders',
    toCsv: (data) => ({
      headers: [
        'order_id',
        'table_id',
        'table_code',
        'total_cents',
        'item_count',
        'created_at',
        'waiter_name',
      ],
      rows: data.orders.map((o) => ({
        order_id: o.orderId,
        table_id: o.tableId,
        table_code: o.tableCode,
        total_cents: o.totalCents,
        item_count: o.itemCount,
        created_at: o.createdAt,
        waiter_name: o.waiterName,
      })),
    }),
  };

  router.get(
    '/recent-orders',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
