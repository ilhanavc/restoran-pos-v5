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
  RecentOrdersQuerySchema,
  RecentOrdersResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { domainError } from '../../errors.js';

/**
 * ADR-015 §3.7 (Session 53c Amendment 2026-05-05) — GET /reports/recent-orders?limit=N
 * Paid-only: yalnız ödenmiş (kapanmış) siparişler. Anasayfa "Son Siparişler"
 * paneli artık "Son Kapanan Siparişler" semantiğinde — açık siparişler
 * masa kartlarında / takeaway kuyruğunda zaten görünür, raporda tekrar yer
 * almasın. Sıralama: created_at DESC. tableCode + waiterName JOIN.
 * `totalOpenCount` field adı korunur (UI sözleşmesi); değer = paid count.
 */
export function recentOrdersRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/recent-orders',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = RecentOrdersQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return next(domainError('VALIDATION_ERROR', 400));
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
          // Session 53c: paid-only — açık siparişler raporda yer almaz.
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

        const payload = RecentOrdersResponseSchema.parse({
          orders,
          totalOpenCount: Number(totalRow.cnt),
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
