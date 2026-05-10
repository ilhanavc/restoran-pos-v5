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
  DailyCloseQuerySchema,
  DailyCloseResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getDailyCloseWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { computeDailyCloseAggregate } from './daily-close-aggregate';

/**
 * ADR-015 Amendment 1 (Karar 4, 2026-05-11) — GET /reports/daily-close
 *
 * Z-Report semantik: tüm günü kapsayan KPI snapshot.
 *
 * Query: `date` opsiyonel `YYYY-MM-DD`. Default: bugün (tenant TZ).
 * Window: [start_of_day(date), end_of_day(date)) — yani 00:00 → ertesi gün
 * 00:00, tenant TZ.
 *
 * Karar 5: shared response schema (DailyCloseResponse) — snapshot endpoint
 * aynı schema'yı kullanır. Aggregate hesaplaması `daily-close-aggregate.ts`
 * helper'ında reuse edilir (DRY).
 *
 * RBAC (Karar 7): admin + cashier ALLOW; waiter + kitchen DENY (403).
 *
 * Index audit: PR-2a/2b/2c indeksleri (orders.tenant_id+status+created_at,
 * payments.tenant_id+created_at, audit_logs_tenant_event_created_idx)
 * yeterli. Migration GEREKMİYOR.
 */
export function dailyCloseRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/daily-close',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = DailyCloseQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return next(domainError('VALIDATION_ERROR', 400));
        }
        const { date } = parsed.data;
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } = getDailyCloseWindow(tz, date);

        const aggregate = await computeDailyCloseAggregate({
          db: deps.db,
          tenantId,
          tz,
          startUtc,
          endUtc,
          sqlRef: sql,
        });

        const payload = DailyCloseResponseSchema.parse({
          windowStart: startUtc.toISOString(),
          windowEnd: endUtc.toISOString(),
          ...aggregate,
        });
        res.status(200).json({ data: payload });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
