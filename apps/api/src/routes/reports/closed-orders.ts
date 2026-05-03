import {
  Router,
  type NextFunction,
  type Request,
  type Response,
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

/**
 * ADR-015 §3.8 — GET /reports/closed-orders?limit=N
 * Bugün kapanmış (status='paid') siparişler. paidAt = MAX(payments.created_at).
 * paymentTypeMix = distinct payment_type'lar (array).
 */
export function closedOrdersRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/closed-orders',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = ClosedOrdersQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return next(domainError('VALIDATION_ERROR', 400));
        }
        const { limit } = parsed.data;
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } = getCalendarDayWindow(tz);

        // paidAt = MAX(payments.created_at) per order. Bugün filtresi MAX üzerine.
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

        const payload = ClosedOrdersResponseSchema.parse({
          orders,
          totalClosedCount: Number(totalRow.cnt),
          asOf: new Date().toISOString(),
        });
        res.status(200).json({ data: payload });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
