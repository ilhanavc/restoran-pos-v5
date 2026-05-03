import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { PaymentDistributionResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';

/**
 * ADR-015 §3.5 — GET /reports/payment-distribution
 * Ödeme tipi (cash|card|transfer) bazında dağılım + sharePct (1 ondalık).
 * Toplam=0 ise segments=[].
 */
export function paymentDistributionRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/payment-distribution',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } = getCalendarDayWindow(tz);

        const rows = await deps.db
          .selectFrom('payments')
          .select((eb) => [
            'payment_type',
            eb.fn.coalesce(eb.fn.sum<number>('amount_cents'), sql<number>`0`).as('total'),
            eb.fn.countAll<number>().as('cnt'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('created_at', '>=', startUtc)
          .where('created_at', '<', endUtc)
          .groupBy('payment_type')
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

        const payload = PaymentDistributionResponseSchema.parse({
          segments,
          totalCents: grand,
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
