import {
  Router,
  type Request,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  AnomaliesQuerySchema,
  AnomaliesResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 1 (Karar 2, 2026-05-11) — GET /reports/anomalies
 * ADR-021 PR-4b2 — `?format=csv` desteği eklendi (compute fn ayrıştırıldı).
 *
 * MVP scope: CANCEL-ONLY. void + comp domain emit'leri henüz YOK.
 * Schema 3 tipi destekler — gelecek event emit'leriyle otomatik dolar.
 */

type AnomaliesData = {
  summary: {
    cancelCount: number;
    voidCount: number;
    compCount: number;
    totalLossCents: number;
  };
  details: Array<{
    type: 'cancel' | 'void' | 'comp';
    orderId: string;
    amountCents: number;
    reason: string | null;
    occurredAt: string;
    actorUserId: string | null;
  }>;
  windowStart: string;
  windowEnd: string;
};

export function anomaliesRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<AnomaliesData> => {
    const parsed = AnomaliesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { range, from, to } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc } =
      from !== undefined && to !== undefined
        ? getRangeWindow(tz, { kind: 'explicit', from, to })
        : getRangeWindow(tz, { kind: 'range', range });

    const summaryRow = await deps.db
      .selectFrom('orders as o')
      .leftJoin('order_items as oi', (join) =>
        join
          .onRef('oi.order_id', '=', 'o.id')
          .onRef('oi.tenant_id', '=', 'o.tenant_id'),
      )
      .select((eb) => [
        eb.fn
          .count<number>(sql<string>`DISTINCT "o"."id"`)
          .as('cancel_count'),
        eb.fn
          .coalesce(sql<number>`SUM("oi"."total_cents")`, sql<number>`0`)
          .as('total_loss'),
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', '=', 'cancelled')
      .where('o.created_at', '>=', startUtc)
      .where('o.created_at', '<', endUtc)
      .executeTakeFirstOrThrow();

    const detailRows = await deps.db
      .selectFrom('audit_logs as al')
      .leftJoin('order_items as oi', (join) =>
        join
          .onRef('oi.order_id', '=', 'al.entity_id')
          .onRef('oi.tenant_id', '=', 'al.tenant_id'),
      )
      .select((eb) => [
        'al.entity_id as order_id',
        'al.created_at as occurred_at',
        'al.actor_user_id',
        sql<string | null>`"al"."payload"->>'reason'`.as('reason'),
        eb.fn
          .coalesce(sql<number>`SUM("oi"."total_cents")`, sql<number>`0`)
          .as('amount_cents'),
      ])
      .where('al.tenant_id', '=', tenantId)
      .where('al.event_type', '=', 'order.cancelled')
      .where('al.created_at', '>=', startUtc)
      .where('al.created_at', '<', endUtc)
      .where('al.entity_id', 'is not', null)
      .groupBy([
        'al.entity_id',
        'al.created_at',
        'al.actor_user_id',
        sql`"al"."payload"->>'reason'`,
      ])
      .orderBy('al.created_at', 'desc')
      .execute();

    const cancelCount = Number(summaryRow.cancel_count);
    const totalLossCents = Number(summaryRow.total_loss);

    const details = detailRows.map((r) => ({
      type: 'cancel' as const,
      orderId: r.order_id as string,
      amountCents: Number(r.amount_cents),
      reason: r.reason ?? null,
      occurredAt:
        r.occurred_at instanceof Date
          ? r.occurred_at.toISOString()
          : new Date(r.occurred_at as unknown as string).toISOString(),
      actorUserId: r.actor_user_id,
    }));

    return AnomaliesResponseSchema.parse({
      summary: {
        cancelCount,
        voidCount: 0,
        compCount: 0,
        totalLossCents,
      },
      details,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  const csvSpec: CsvSpec<AnomaliesData> = {
    reportName: 'anomalies',
    toCsv: (data) => ({
      headers: [
        'type',
        'order_id',
        'amount_cents',
        'reason',
        'occurred_at',
        'actor_user_id',
        'window_start',
        'window_end',
      ],
      rows: data.details.map((d) => ({
        type: d.type,
        order_id: d.orderId,
        amount_cents: d.amountCents,
        reason: d.reason,
        occurred_at: d.occurredAt,
        actor_user_id: d.actorUserId,
        window_start: data.windowStart,
        window_end: data.windowEnd,
      })),
    }),
  };

  router.get(
    '/anomalies',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
