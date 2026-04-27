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
import {
  OrderCreateApiRequestSchema,
  OrderListQuerySchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';
import { parseDateParam, todayStoreDate } from '../utils/store-date.js';

export interface OrdersRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
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
          waiterUserId: req.user!.userId,
        });
        res.status(201).json({ data: { order } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = OrderListQuerySchema.safeParse(req.query);
        if (!parsed.success) return next(parsed.error);

        const storeDate = parsed.data.storeDate !== undefined
          ? parseDateParam(parsed.data.storeDate)
          : todayStoreDate();

        const repo = createOrdersRepository(deps.db);
        const orders = await repo.findMany(req.user!.tenantId, {
          ...(parsed.data.status !== undefined && { status: parsed.data.status }),
          ...(parsed.data.tableId !== undefined && { tableId: parsed.data.tableId }),
          ...(parsed.data.orderType !== undefined && { orderType: parsed.data.orderType }),
          storeDate,
        });
        res.status(200).json({ data: { orders } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
