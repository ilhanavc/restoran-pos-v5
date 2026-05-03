import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { TodayRevenueResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';

/**
 * ADR-015 §3.1 (Amendment 2026-05-03) — GET /reports/kpi/today-revenue
 *
 * SUM(orders.total_cents) WHERE status='paid' AND orders.created_at bugün.
 * Kullanıcı kuralı (Seçenek A): siparişin AÇILIŞ saati bugün olmalı; dünden
 * sarkıp bugün ödenenler ciroya dahil edilmez. Üç KPI da `orders` tablosu
 * ve `created_at` filtresi kullanır → ortalama × paid count = ciro.
 * İptal/açık siparişler dahil değil. Bahşiş orders.total_cents'e dahil değil.
 */
export function todayRevenueRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/kpi/today-revenue',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } = getCalendarDayWindow(tz);

        const row = await deps.db
          .selectFrom('orders')
          .select((eb) => [
            eb.fn.coalesce(eb.fn.sum<number>('total_cents'), sql<number>`0`).as('total'),
            eb.fn.countAll<number>().as('paid_orders'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('status', '=', 'paid')
          .where('created_at', '>=', startUtc)
          .where('created_at', '<', endUtc)
          .executeTakeFirstOrThrow();

        const payload = TodayRevenueResponseSchema.parse({
          totalRevenueCents: Number(row.total),
          paidOrderCount: Number(row.paid_orders),
          asOf: new Date().toISOString(),
          windowStart: startUtc.toISOString(),
          windowEnd: endUtc.toISOString(),
        });
        res.status(200).json({ data: payload });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
