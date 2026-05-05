import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { HourlyRevenueResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';

/**
 * ADR-015 §3.4 — GET /reports/hourly-revenue
 * 24-saatlik bucket array (yerel saat 0-23). Boş saatler 0 ile doldurulur.
 *
 * EXTRACT(HOUR FROM payments.created_at AT TIME ZONE tz) ile yerel saat.
 * `AT TIME ZONE` Postgres-spesifik; SQLite'da bu route çalışmaz (MVP'de
 * unit test için stub gerekirse ayrı path). Üretim DB Postgres (CLAUDE.md).
 */
export function hourlyRevenueRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/hourly-revenue',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } = getCalendarDayWindow(tz);

        // Session 53c Amendment v2 (2026-05-05): paid-only.
        // payments JOIN orders → WHERE order.status='paid'. Kısmi ödeme yapılmış
        // ama henüz kapatılmamış (status='open'/'partially_served') siparişlerin
        // payments satırları SAATLİK CİROYA DAHİL DEĞİL.
        const rows = await deps.db
          .selectFrom('payments as p')
          .innerJoin('orders as o', (join) =>
            join
              .onRef('o.id', '=', 'p.order_id')
              .onRef('o.tenant_id', '=', 'p.tenant_id'),
          )
          .select((eb) => [
            sql<number>`EXTRACT(HOUR FROM (p.created_at AT TIME ZONE ${sql.lit(tz)}))::int`.as('hr'),
            eb.fn.coalesce(eb.fn.sum<number>('p.amount_cents'), sql<number>`0`).as('rev'),
            sql<number>`COUNT(DISTINCT p.order_id)`.as('cnt'),
          ])
          .where('p.tenant_id', '=', tenantId)
          .where('o.status', '=', 'paid')
          .where('p.created_at', '>=', startUtc)
          .where('p.created_at', '<', endUtc)
          .groupBy('hr')
          .execute();

        const map = new Map<number, { revenueCents: number; orderCount: number }>();
        for (const r of rows) {
          map.set(Number(r.hr), {
            revenueCents: Number(r.rev),
            orderCount: Number(r.cnt),
          });
        }
        const buckets = Array.from({ length: 24 }, (_, hour) => {
          const v = map.get(hour);
          return {
            hour,
            revenueCents: v?.revenueCents ?? 0,
            orderCount: v?.orderCount ?? 0,
          };
        });

        const payload = HourlyRevenueResponseSchema.parse({
          buckets,
          asOf: new Date().toISOString(),
          timezone: tz,
        });
        res.status(200).json({ data: payload });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
