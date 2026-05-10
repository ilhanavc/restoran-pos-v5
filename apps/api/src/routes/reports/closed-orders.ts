import {
  Router,
  type Request,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  ClosedOrdersQuerySchema,
  ClosedOrdersResponseSchema,
  type PaymentType,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 §3.8 — GET /reports/closed-orders?limit=N
 * ADR-021 PR-4b2 — `?format=csv` desteği eklendi.
 *
 * Schema customer info içermez (tableCode + paymentTypeMix) → PII mask GEREKMEZ.
 * paymentTypeMix CSV'de pipe-separated string ('cash|card') — TR Excel `,`/`;`
 * delimiter çakışmasını engeller.
 */

type ClosedOrdersData = ReturnType<typeof ClosedOrdersResponseSchema.parse>;

export function closedOrdersRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<ClosedOrdersData> => {
    const parsed = ClosedOrdersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { limit } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = getCalendarDayWindow(tz);

    const rows = await deps.db
      .selectFrom('orders as o')
      .innerJoin(
        (eb) =>
          eb
            .selectFrom('payments')
            .select((eb2) => [
              'order_id',
              sql<Date>`MAX(created_at)`.as('paid_at'),
            ])
            .where('tenant_id', '=', tenantId)
            .groupBy('order_id')
            .as('p'),
        (jb) => jb.onRef('p.order_id', '=', 'o.id'),
      )
      .leftJoin('tables as t', 't.id', 'o.table_id')
      .select([
        'o.id as order_id',
        't.code as table_code',
        'o.total_cents',
        'p.paid_at as paid_at',
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      .where('p.paid_at', '>=', startUtc)
      .where('p.paid_at', '<', endUtc)
      .orderBy('p.paid_at', 'desc')
      .limit(limit)
      .execute();

    const orderIds = rows.map((r) => r.order_id);
    const typeRows = orderIds.length === 0
      ? []
      : await deps.db
          .selectFrom('payments')
          .select(['order_id', 'payment_type'])
          .where('tenant_id', '=', tenantId)
          .where('order_id', 'in', orderIds)
          .groupBy(['order_id', 'payment_type'])
          .execute();

    const typesByOrder = new Map<string, PaymentType[]>();
    for (const tr of typeRows) {
      const list = typesByOrder.get(tr.order_id) ?? [];
      if (!list.includes(tr.payment_type)) list.push(tr.payment_type);
      typesByOrder.set(tr.order_id, list);
    }

    const totalRow = await deps.db
      .selectFrom('orders as o')
      .innerJoin(
        (eb) =>
          eb
            .selectFrom('payments')
            .select((eb2) => [
              'order_id',
              sql<Date>`MAX(created_at)`.as('paid_at'),
            ])
            .where('tenant_id', '=', tenantId)
            .groupBy('order_id')
            .as('p'),
        (jb) => jb.onRef('p.order_id', '=', 'o.id'),
      )
      .select((eb) => eb.fn.countAll<number>().as('cnt'))
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      .where('p.paid_at', '>=', startUtc)
      .where('p.paid_at', '<', endUtc)
      .executeTakeFirstOrThrow();

    const orders = rows.map((r) => ({
      orderId: r.order_id,
      tableCode: r.table_code,
      totalCents: Number(r.total_cents),
      paidAt: new Date(r.paid_at as unknown as string | Date).toISOString(),
      paymentTypeMix: typesByOrder.get(r.order_id) ?? [],
    }));

    return ClosedOrdersResponseSchema.parse({
      orders,
      totalClosedCount: Number(totalRow.cnt),
      asOf: new Date().toISOString(),
    });
  };

  const csvSpec: CsvSpec<ClosedOrdersData> = {
    reportName: 'closed-orders',
    toCsv: (data) => ({
      headers: [
        'order_id',
        'table_code',
        'total_cents',
        'paid_at',
        'payment_type_mix',
      ],
      rows: data.orders.map((o) => ({
        order_id: o.orderId,
        table_code: o.tableCode,
        total_cents: o.totalCents,
        paid_at: o.paidAt,
        payment_type_mix: o.paymentTypeMix.join('|'),
      })),
    }),
  };

  router.get(
    '/closed-orders',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
