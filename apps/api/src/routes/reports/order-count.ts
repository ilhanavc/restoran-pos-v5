import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { OrderCountResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';

/**
 * ADR-015 §3.2 (Session 53c Amendment 2026-05-05) — GET /reports/kpi/order-count
 * Bugünkü kapanmış sipariş sayısı + status breakdown (forensic).
 *
 * `totalOrders` SEMANTİĞİ: paid count (Session 53c). UI sözleşmesi (alan adı)
 * korundu — anasayfa "Toplam Sipariş" KPI'ı artık "Tamamlanan Sipariş" anlamı
 * taşır. byStatus breakdown (open/paid/cancelled) korunur — debug/forensic
 * panelinde hâlâ erişilebilir.
 *
 * Karar 8: ADR-013/014 kapsamında `OrderStatus` enum'unda extra durumlar
 * (`sent_to_kitchen`, `served`, `partially_served`, `billed`, `void`) da
 * geçebilir; v5 MVP UI yalnız 'open' + 'paid' + 'cancelled' kullanır.
 * v3 paritesi: bilinmeyen statüleri 'open' bucket'ına kat (UI yorumu).
 */
export function orderCountRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/kpi/order-count',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } = getCalendarDayWindow(tz);

        const rows = await deps.db
          .selectFrom('orders')
          .select((eb) => [
            'status',
            eb.fn.countAll<number>().as('cnt'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('created_at', '>=', startUtc)
          .where('created_at', '<', endUtc)
          .groupBy('status')
          .execute();

        let open = 0;
        let paid = 0;
        let cancelled = 0;
        for (const r of rows) {
          const c = Number(r.cnt);
          if (r.status === 'paid') paid += c;
          else if (r.status === 'cancelled' || r.status === 'void') cancelled += c;
          else open += c;
        }
        // Session 53c Amendment (2026-05-05): paid-only.
        // Eski: total = open + paid (iptal hariç).
        // Yeni: total = paid (kasaya giren sipariş sayısı). open + cancelled
        // breakdown'da forensic erişim için kalır.
        const total = paid;

        const payload = OrderCountResponseSchema.parse({
          totalOrders: total,
          byStatus: { open, paid, cancelled },
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
