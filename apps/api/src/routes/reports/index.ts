import { Router, type Router as ExpressRouter } from 'express';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { todayRevenueRoute } from './today-revenue';
import { orderCountRoute } from './order-count';
import { averageBillRoute } from './average-bill';
import { hourlyRevenueRoute } from './hourly-revenue';
import { paymentDistributionRoute } from './payment-distribution';
import { topSellingRoute } from './top-selling';
import { recentOrdersRoute } from './recent-orders';
import { closedOrdersRoute } from './closed-orders';

export interface ReportsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * ADR-015 — `/reports` aggregator.
 * 8 endpoint: per-file (Karar 4). Tek mount: app.use('/reports', reportsRouter).
 * Her endpoint kendi auth + RBAC (admin + cashier) middleware'ini eder.
 */
export function reportsRouter(deps: ReportsRouterDeps): ExpressRouter {
  const router = Router();
  router.use(todayRevenueRoute(deps));
  router.use(orderCountRoute(deps));
  router.use(averageBillRoute(deps));
  router.use(hourlyRevenueRoute(deps));
  router.use(paymentDistributionRoute(deps));
  router.use(topSellingRoute(deps));
  router.use(recentOrdersRoute(deps));
  router.use(closedOrdersRoute(deps));
  return router;
}
