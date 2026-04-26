import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { createTablesRepository, type DB } from '@restoran-pos/db';
import {
  TableCreateRequestSchema,
  TableListQuerySchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';

export interface TablesRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

export function tablesRouter(deps: TablesRouterDeps): ExpressRouter {
  const router = Router();

  router.post(
    '/',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(TableCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createTablesRepository(deps.db);
        const table = await repo.create(req.user!.tenantId, {
          id: randomUUID(),
          code: req.body.code,
          capacity: req.body.capacity ?? null,
        });
        res.status(201).json({ data: { table } });
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
        const parsed = TableListQuerySchema.safeParse(req.query);
        if (!parsed.success) return next(parsed.error);

        const repo = createTablesRepository(deps.db);
        const tables = parsed.data.status !== undefined
          ? await repo.findByStatus(req.user!.tenantId, parsed.data.status)
          : await repo.findAll(req.user!.tenantId);
        res.status(200).json({ data: { tables } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
