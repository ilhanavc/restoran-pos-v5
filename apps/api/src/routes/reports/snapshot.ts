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
  SnapshotQuerySchema,
  DailyCloseResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getSnapshotWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { computeDailyCloseAggregate } from './daily-close-aggregate';

/**
 * ADR-015 Amendment 1 (Karar 4, 2026-05-11) — GET /reports/snapshot
 *
 * X-Report semantik: gün başlangıcından şu ana kadar (ara kapanış).
 *
 * Query: `at` opsiyonel ISO8601 datetime. Default: now.
 * Window: [start_of_day(at), at) — gün başlangıcından `at`'e kadar.
 *
 * Karar 5: shared response schema (DailyCloseResponse) — daily-close ile
 * aynı. Aggregate hesaplaması `daily-close-aggregate.ts` helper'ında
 * reuse edilir.
 *
 * RBAC (Karar 7): admin + cashier ALLOW; waiter + kitchen DENY (403).
 */
export function snapshotRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/snapshot',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = SnapshotQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return next(domainError('VALIDATION_ERROR', 400));
        }
        const { at } = parsed.data;
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } = getSnapshotWindow(tz, at);

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
