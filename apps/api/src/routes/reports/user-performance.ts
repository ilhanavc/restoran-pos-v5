import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  UserPerformanceQuerySchema,
  UserPerformanceResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { resolveRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 1 (Karar 3, 2026-05-11) — GET /reports/user-performance
 * ADR-015 Amendment 2 (2026-05-12, BREAKING) — range enum revize
 *   (today|yesterday|last7|last30|custom).
 * ADR-021 PR-4b1 — `?format=csv` desteği eklendi.
 *
 * Waiter (orders × users) + Cashier (payments × users) ayrı SQL union.
 * Aynı user iki rolde de görünebilir → 2 satır farklı `role`. RBAC: admin + cashier.
 *
 * `users` tablosunda full_name yok; `username` kullanılır.
 */

type UserPerformanceData = {
  users: Array<{
    userId: string;
    name: string;
    role: 'cashier' | 'waiter';
    orderCount: number;
    revenueCents: number;
    avgBillCents: number;
  }>;
  windowStart: string;
  windowEnd: string;
};

export function userPerformanceRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<UserPerformanceData> => {
    const parsed = UserPerformanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { range, from, to, role } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } = resolveRangeWindow({ range, from, to, tz });

    type Row = {
      user_id: string;
      name: string;
      role: 'cashier' | 'waiter';
      order_count: number;
      revenue_cents: number;
    };

    const rows: Row[] = [];

    // ─── Waiter performance ────────────────────────────────────────────
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

    return UserPerformanceResponseSchema.parse({
      users,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  const csvSpec: CsvSpec<UserPerformanceData> = {
    reportName: 'user-performance',
    toCsv: (data) => ({
      headers: [
        'user_id',
        'name',
        'role',
        'order_count',
        'revenue_cents',
        'avg_bill_cents',
        'window_start',
        'window_end',
      ],
      rows: data.users.map((u) => ({
        user_id: u.userId,
        name: u.name,
        role: u.role,
        order_count: u.orderCount,
        revenue_cents: u.revenueCents,
        avg_bill_cents: u.avgBillCents,
        window_start: data.windowStart,
        window_end: data.windowEnd,
      })),
    }),
  };

  router.get(
    '/user-performance',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
