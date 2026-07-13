import { Router, type Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import type { Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import { AUTH_MESSAGE_KEYS } from '../../errors';
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
import { dailyCloseRoute } from './daily-close';
import { snapshotRoute } from './snapshot';

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

  // R7-DOS-01 (Session 94 denetim fix) — /reports rate-limit.
  // Rapor endpoint'leri 90 güne kadar tarih-aralığı üzerinde ağır aggregation
  // yapar (GROUP BY + SUM + tarih range); throttle'sız bırakılırsa yetkili bir
  // kullanıcı (compromised/malicious) bunları limitsiz tekrarlayıp DB CPU
  // exhaustion yaratabilir (loginLimiter/agentAuthLimiter paritesi).
  //
  // Limit 120/dk-IP CÖMERT seçildi — meşru kullanımı ASLA kırmasın:
  //   - dashboard/reports sayfaları POLL_MS=60sn ile passive polling yapar
  //     (~4-11 sorgu/dk) + sayfa açılışı ~8-13 paralel istek + tarih-aralığı
  //     değişimi batch-refetch → 120/dk bunların çok üstünde headroom.
  //   - trust proxy=1 (app.ts:63) → req.ip gerçek client IP (X-Forwarded-For),
  //     limiter global değil per-IP. Restoran NAT'ında birden çok cihaz aynı
  //     public IP'yi paylaşsa bile birleşik yük 120/dk'nın altında.
  // Scripted abuse ise 120 ağır sorgu/dk = ~2/sn ile kapanır (Migration 047
  // index'leriyle her sorgu hızlandığı için PG bunu rahat karşılar).
  //
  // Limiter auth ÖNCESİ: yetkisiz probing DB'ye vurmadan sayılır + 401'ler
  // ucuz. Per-app in-memory store (buildApp başına izole → test suite'leri
  // birbirini etkilemez). E2E_BYPASS: rapor-MANTIĞI test suite'i (reports.test)
  // tek app'e 120+ istek atar → bypass'la; 429 davranışı reports-rate-limit.test.
  const bypassLimit =
    process.env['E2E_BYPASS_REPORTS_LIMIT'] === '1' ||
    process.env['E2E_BYPASS_REPORTS_LIMIT'] === 'true';
  const reportsLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => bypassLimit,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'REPORTS_RATE_LIMITED',
          message_key: AUTH_MESSAGE_KEYS['REPORTS_RATE_LIMITED'],
        },
      });
    },
  });
  router.use(reportsLimiter);

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
  // ADR-015 Amendment 1 — Karar 4 (daily-close Z) + Karar 5 (snapshot X
  // shared schema). Aggregate logic daily-close-aggregate.ts'de reuse.
  router.use(dailyCloseRoute(deps));
  router.use(snapshotRoute(deps));
  return router;
}
