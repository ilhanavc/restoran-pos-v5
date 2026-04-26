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
import { TableCreateRequestSchema } from '@restoran-pos/shared-types';
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

  return router;
}
