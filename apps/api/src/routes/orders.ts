import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { createOrdersRepository, type DB } from '@restoran-pos/db';
import { OrderCreateApiRequestSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';

export interface OrdersRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * UTC midnight olarak günün business date'ini döner.
 * MVP: cutoff hour yok (Phase 4'te tenant_settings'ten gelecek).
 */
function todayStoreDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function ordersRouter(deps: OrdersRouterDeps): ExpressRouter {
  const router = Router();

  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter']),
    validateBody(OrderCreateApiRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createOrdersRepository(deps.db);
        const order = await repo.create(req.user!.tenantId, {
          id: randomUUID(),
          tableId: req.body.tableId,
          orderType: req.body.orderType,
          note: req.body.note ?? null,
          customerId: req.body.customerId ?? null,
          storeDate: todayStoreDate(),
        });
        res.status(201).json({ data: { order } });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
