import { randomUUID } from 'node:crypto';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import type { Kysely } from 'kysely';
import { createCategoriesRepository, type DB } from '@restoran-pos/db';
import { CategoryCreateRequestSchema } from '@restoran-pos/shared-types';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validateBody } from '../middleware/validate.js';

export interface MenuRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

export function menuRouter(deps: MenuRouterDeps): ExpressRouter {
  const router = Router();

  router.post(
    '/categories',
    authenticate(deps.accessSecret),
    authorize(['admin']),
    validateBody(CategoryCreateRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createCategoriesRepository(deps.db);
        const category = await repo.create(req.user!.tenantId, {
          id: randomUUID(),
          name: req.body.name,
          ...(req.body.sortOrder !== undefined && { sortOrder: req.body.sortOrder }),
        });
        res.status(201).json({ data: { category } });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/categories',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier', 'waiter', 'kitchen']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const repo = createCategoriesRepository(deps.db);
        const categories = await repo.findAll(req.user!.tenantId);
        res.status(200).json({ data: { categories } });
        return;
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
