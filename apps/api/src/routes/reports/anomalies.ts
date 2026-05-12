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
import { resolveRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 1 (Karar 2, 2026-05-11) — GET /reports/anomalies
 * ADR-015 Amendment 2 (2026-05-12, BREAKING) — range enum revize
 *   (today|yesterday|last7|last30|custom).
 * ADR-015 Amendment 3 (2026-05-13, Session 61) — scope: cancel + comp + void.
 *   - cancel: `audit_logs.event_type='order.cancelled'` (mevcut, değişmez)
 *   - comp:   `order_items.is_comped=true` DB-direct (audit event YOK)
 *   - void:   `orders.status='void'` DB-direct (future-proof; emit endpoint v5.1)
 *   Domain emit eklenmez; yalnız rapor okuma kapsamı genişler.
 * ADR-021 PR-4b2 — `?format=csv` desteği (compute fn ayrıştırıldı).
 */

type AnomalyDetail = {
  type: 'cancel' | 'void' | 'comp';
  orderId: string;
  amountCents: number;
  reason: string | null;
  occurredAt: string;
  actorUserId: string | null;
};

type AnomaliesData = {
  summary: {
    cancelCount: number;
    voidCount: number;
    compCount: number;
    totalLossCents: number;
  };
  details: AnomalyDetail[];
  windowStart: string;
  windowEnd: string;
};

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string).toISOString();
}

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
    const { startUtc, endUtc } = resolveRangeWindow({ range, from, to, tz });

    // --- SUMMARY ---
    // cancel + void: order-level COUNT + SUM(order_items.total_cents).
    const cancelVoidSummary = await deps.db
      .selectFrom('orders as o')
      .leftJoin('order_items as oi', (join) =>
        join
          .onRef('oi.order_id', '=', 'o.id')
          .onRef('oi.tenant_id', '=', 'o.tenant_id'),
      )
      .select((eb) => [
        eb.fn
          .count<number>(
            sql<string>`DISTINCT CASE WHEN "o"."status"='cancelled' THEN "o"."id" END`,
          )
          .as('cancel_count'),
        eb.fn
          .count<number>(
            sql<string>`DISTINCT CASE WHEN "o"."status"='void' THEN "o"."id" END`,
          )
          .as('void_count'),
        eb.fn
          .coalesce(
            sql<number>`SUM("oi"."total_cents")`,
            sql<number>`0`,
          )
          .as('cancel_void_loss'),
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', 'in', ['cancelled', 'void'])
      .where('o.created_at', '>=', startUtc)
      .where('o.created_at', '<', endUtc)
      .executeTakeFirstOrThrow();

    // comp: item-level COUNT (her ikram item = 1 satır) + SUM(total_cents).
    const compSummary = await deps.db
      .selectFrom('order_items')
      .select((eb) => [
        eb.fn.count<number>('id').as('comp_count'),
        eb.fn
          .coalesce(sql<number>`SUM("total_cents")`, sql<number>`0`)
          .as('comp_loss'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('is_comped', '=', true)
      .where('updated_at', '>=', startUtc)
      .where('updated_at', '<', endUtc)
      .executeTakeFirstOrThrow();

    const cancelCount = Number(cancelVoidSummary.cancel_count);
    const voidCount = Number(cancelVoidSummary.void_count);
    const compCount = Number(compSummary.comp_count);
    const cancelVoidLoss = Number(cancelVoidSummary.cancel_void_loss);
    const compLoss = Number(compSummary.comp_loss);
    const totalLossCents = cancelVoidLoss + compLoss;

    // --- DETAILS ---
    // cancel: audit_logs join order_items SUM (mevcut davranış).
    const cancelRows = await deps.db
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
      .execute();

    // void: orders.status='void' DB-direct (future-proof; bugün 0 satır).
    const voidRows = await deps.db
      .selectFrom('orders as o')
      .leftJoin('order_items as oi', (join) =>
        join
          .onRef('oi.order_id', '=', 'o.id')
          .onRef('oi.tenant_id', '=', 'o.tenant_id'),
      )
      .select((eb) => [
        'o.id as order_id',
        'o.updated_at as occurred_at',
        eb.fn
          .coalesce(sql<number>`SUM("oi"."total_cents")`, sql<number>`0`)
          .as('amount_cents'),
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', '=', 'void')
      .where('o.created_at', '>=', startUtc)
      .where('o.created_at', '<', endUtc)
      .groupBy(['o.id', 'o.updated_at'])
      .execute();

    // comp: order_items.is_comped=true DB-direct (item-level granularity).
    const compRows = await deps.db
      .selectFrom('order_items')
      .select([
        'order_id',
        'updated_at as occurred_at',
        'total_cents as amount_cents',
      ])
      .where('tenant_id', '=', tenantId)
      .where('is_comped', '=', true)
      .where('updated_at', '>=', startUtc)
      .where('updated_at', '<', endUtc)
      .execute();

    const cancelDetails: AnomalyDetail[] = cancelRows.map((r) => ({
      type: 'cancel',
      orderId: r.order_id as string,
      amountCents: Number(r.amount_cents),
      reason: r.reason ?? null,
      occurredAt: toIsoString(r.occurred_at),
      actorUserId: r.actor_user_id,
    }));

    const voidDetails: AnomalyDetail[] = voidRows.map((r) => ({
      type: 'void',
      orderId: r.order_id,
      amountCents: Number(r.amount_cents),
      reason: null,
      occurredAt: toIsoString(r.occurred_at),
      actorUserId: null,
    }));

    const compDetails: AnomalyDetail[] = compRows.map((r) => ({
      type: 'comp',
      orderId: r.order_id,
      amountCents: Number(r.amount_cents),
      reason: null,
      occurredAt: toIsoString(r.occurred_at),
      actorUserId: null,
    }));

    const details = [...cancelDetails, ...voidDetails, ...compDetails].sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    return AnomaliesResponseSchema.parse({
      summary: {
        cancelCount,
        voidCount,
        compCount,
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
