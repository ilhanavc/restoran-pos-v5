import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { AverageBillResponseSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getCalendarDayWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';

/**
 * ADR-015 §3.3 (Amendment 2026-05-03) — GET /reports/kpi/average-bill
 * SUM(orders.total_cents) / COUNT(*) WHERE created_at bugün (v3 paritesi).
 * TÜM siparişler dahil (open + paid + cancelled) — açık masalar henüz para
 * getirmediği için ortalamayı düşürür, işletmeci için daha gerçekçi sinyal.
 * sampleSize=0 → averageBillCents=0 (frontend "—" gösterir). Math.floor.
 */
export function averageBillRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/kpi/average-bill',
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
            eb.fn.countAll<number>().as('cnt'),
          ])
          .where('tenant_id', '=', tenantId)
          .where('created_at', '>=', startUtc)
          .where('created_at', '<', endUtc)
          .executeTakeFirstOrThrow();

        const total = Number(row.total);
        const cnt = Number(row.cnt);
        const avg = cnt > 0 ? Math.floor(total / cnt) : 0;

        const payload = AverageBillResponseSchema.parse({
          averageBillCents: avg,
          sampleSize: cnt,
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
