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
  UserPerformanceQuerySchema,
  UserPerformanceResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';

/**
 * ADR-015 Amendment 1 (Karar 3, 2026-05-11) — GET /reports/user-performance
 *
 * Schema audit bulgusu (decisions.md §A1.3 inline yorum):
 *   `orders.cashier_id` kolonu YOK. Cashier metric'i ödemeyi alandan türetilir:
 *   `payments.created_by_user_id`. Bu endpoint iki ayrı SQL union döndürür:
 *
 *   1. Waiter performance — orders × users üzerinden, paid-only:
 *      COUNT(orders) + SUM(orders.total_cents) → revenueCents
 *   2. Cashier performance — payments × users üzerinden, paid orders only:
 *      COUNT(DISTINCT payments.order_id) + SUM(payments.amount_cents)
 *      → parçalı ödeme durumunda her cashier kendi payment'i kadarını sayar.
 *
 * Aynı user iki rolde de görünebilir (cashier hem sipariş aldı hem ödeme aldı)
 *   → 2 ayrı satır, `role` farklı. Bu kabul.
 *
 * `users` tablosunda full_name kolonu YOK; `username` field'ı kullanılır
 *   (generated.ts:Users — id, password_hash, role, tenant_id, username, email).
 *
 * `avgBillCents = floor(revenueCents / orderCount)` — orderCount=0 ise 0.
 *
 * Sıralama: `revenueCents DESC`. `role` query param 'waiter' ya da 'cashier' ise
 *   yalnız o SQL çalıştırılır; verilmezse iki sonuç concat'lenir, sonra sort.
 *
 * Query: range=today|week|month (default today) VEYA from=YYYY-MM-DD&to=YYYY-MM-DD.
 * Yalnız biri verilirse 400 VALIDATION_ERROR (zod refine — pariter).
 *
 * Index audit (Karar A1):
 *   orders_waiter_user_id_idx ✅ Migration 005 — waiter SQL kapsamı.
 *   payments.created_by_user_id index YOK; küçük tablo başlangıçta sorun değil,
 *   gerekirse Sprint 14d'de EXPLAIN ANALYZE. Migration EKLENMEZ (kapsam dışı).
 *
 * RBAC: admin + cashier ALLOW. waiter + kitchen → 403.
 */
export function userPerformanceRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/user-performance',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = UserPerformanceQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return next(domainError('VALIDATION_ERROR', 400));
        }
        const { range, from, to, role } = parsed.data;
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } =
          from !== undefined && to !== undefined
            ? getRangeWindow(tz, { kind: 'explicit', from, to })
            : getRangeWindow(tz, { kind: 'range', range });

        type Row = {
          user_id: string;
          name: string;
          role: 'cashier' | 'waiter';
          order_count: number;
          revenue_cents: number;
        };

        const rows: Row[] = [];

        // ─── Waiter performance ────────────────────────────────────────────
        // orders.waiter_user_id × users (tenant_id eşitliği şart). paid-only.
        // SUM(orders.total_cents) — paid order'ın final tutarı.
        if (role === undefined || role === 'waiter') {
          const waiterRows = await deps.db
            .selectFrom('orders as o')
            .innerJoin('users as u', (join) =>
              join
                .onRef('u.id', '=', 'o.waiter_user_id')
                .onRef('u.tenant_id', '=', 'o.tenant_id'),
            )
            .select((eb) => [
              'o.waiter_user_id as user_id',
              'u.username as name',
              eb.fn.count<number>('o.id').as('order_count'),
              eb.fn
                .coalesce(sql<number>`SUM("o"."total_cents")`, sql<number>`0`)
                .as('revenue_cents'),
            ])
            .where('o.tenant_id', '=', tenantId)
            .where('o.status', '=', 'paid')
            .where('o.waiter_user_id', 'is not', null)
            .where('o.created_at', '>=', startUtc)
            .where('o.created_at', '<', endUtc)
            .groupBy(['o.waiter_user_id', 'u.username'])
            .execute();

          for (const r of waiterRows) {
            rows.push({
              user_id: r.user_id as string,
              name: r.name,
              role: 'waiter',
              order_count: Number(r.order_count),
              revenue_cents: Number(r.revenue_cents),
            });
          }
        }

        // ─── Cashier performance ───────────────────────────────────────────
        // payments × orders (status='paid') × users (tenant_id eşitliği şart).
        // COUNT(DISTINCT payment.order_id) — bir sipariş aynı kasiyer tarafından
        // birden fazla parçalı ödemeyle kapanmış olabilir, distinct ile
        // tek sayılır. SUM(payments.amount_cents) — kasiyerin gerçekten aldığı
        // tutar (parçalı ödemede iki kasiyer varsa her biri kendi pay'ini sayar).
        if (role === undefined || role === 'cashier') {
          const cashierRows = await deps.db
            .selectFrom('payments as p')
            .innerJoin('orders as o', (join) =>
              join
                .onRef('o.id', '=', 'p.order_id')
                .onRef('o.tenant_id', '=', 'p.tenant_id')
                .on('o.status', '=', 'paid'),
            )
            .innerJoin('users as u', (join) =>
              join
                .onRef('u.id', '=', 'p.created_by_user_id')
                .onRef('u.tenant_id', '=', 'p.tenant_id'),
            )
            .select((eb) => [
              'p.created_by_user_id as user_id',
              'u.username as name',
              eb.fn
                .count<number>(sql<string>`DISTINCT "p"."order_id"`)
                .as('order_count'),
              eb.fn
                .coalesce(sql<number>`SUM("p"."amount_cents")`, sql<number>`0`)
                .as('revenue_cents'),
            ])
            .where('p.tenant_id', '=', tenantId)
            .where('p.created_by_user_id', 'is not', null)
            .where('p.created_at', '>=', startUtc)
            .where('p.created_at', '<', endUtc)
            .groupBy(['p.created_by_user_id', 'u.username'])
            .execute();

          for (const r of cashierRows) {
            rows.push({
              user_id: r.user_id as string,
              name: r.name,
              role: 'cashier',
              order_count: Number(r.order_count),
              revenue_cents: Number(r.revenue_cents),
            });
          }
        }

        // Sıralama TS tarafında: revenueCents DESC. Aynı revenue durumunda
        // userId stable secondary key (tutarlı response için).
        rows.sort((a, b) => {
          if (b.revenue_cents !== a.revenue_cents)
            return b.revenue_cents - a.revenue_cents;
          return a.user_id.localeCompare(b.user_id);
        });

        const users = rows.map((r) => {
          const orderCount = r.order_count;
          const revenueCents = r.revenue_cents;
          const avgBillCents =
            orderCount === 0 ? 0 : Math.floor(revenueCents / orderCount);
          return {
            userId: r.user_id,
            name: r.name,
            role: r.role,
            orderCount,
            revenueCents,
            avgBillCents,
          };
        });

        const payload = UserPerformanceResponseSchema.parse({
          users,
          windowStart: startUtc.toISOString(),
          windowEnd: endUtc.toISOString(),
        });
        res.status(200).json({ data: payload });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
