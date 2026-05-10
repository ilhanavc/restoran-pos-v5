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
import { categorySalesRoute } from './category-sales';
import { anomaliesRoute } from './anomalies';
import { userPerformanceRoute } from './user-performance';

export interface ReportsRouterDeps {
  db: Kysely<DB>;
  accessSecret: string;
}

/**
 * ADR-015 — `/reports` aggregator.
 * 8 + Amendment 1 (5 yeni) endpoint: per-file (Karar 4). Tek mount:
 * app.use('/reports', reportsRouter). Her endpoint kendi auth + RBAC
 * (admin + cashier) middleware'ini eder.
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
  // ADR-015 Amendment 1 — Karar 1
  router.use(categorySalesRoute(deps));
  // ADR-015 Amendment 1 — Karar 2 (cancel-only MVP; void/comp ayrı PR'da)
  router.use(anomaliesRoute(deps));
  // ADR-015 Amendment 1 — Karar 3 (waiter via orders, cashier via payments)
  router.use(userPerformanceRoute(deps));
  return router;
}
