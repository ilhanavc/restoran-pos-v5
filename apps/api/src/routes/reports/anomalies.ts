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
  AnomaliesQuerySchema,
  AnomaliesResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getRangeWindow } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';

/**
 * ADR-015 Amendment 1 (Karar 2, 2026-05-11) — GET /reports/anomalies
 *
 * MVP scope: CANCEL-ONLY. void + comp domain emit'leri (`order.item_void`,
 * `order.comp_*`) ve storage kolonları (`comped_at`, `comp_amount`, `void_at`)
 * henüz YOK. Bu PR'da `summary.voidCount` + `summary.compCount` her zaman 0,
 * `details` array'i yalnız `type='cancel'` kayıt içerir. void/comp emit + migration
 * ayrı PR'da implement edilecek (Sprint 14d veya Sprint 15) — schema 3 tipi
 * destekler, otomatik dolacak.
 *
 * Query: range=today|week|month (default today) VEYA from=YYYY-MM-DD&to=YYYY-MM-DD.
 * Yalnız biri verilirse 400 VALIDATION_ERROR (zod refine — category-sales paritesi).
 *
 * SQL — summary:
 *   COUNT(DISTINCT orders.id) WHERE status='cancelled'
 *   + SUM(order_items.total_cents) — cancelTakeawayOrder repo orders.total_cents=0
 *     set eder ama order_items.total_cents'i KORUR (kayıp tutarın gerçek değeri).
 *
 * SQL — details:
 *   audit_logs (event_type='order.cancelled') × order_items aggregation. Reason
 *   `payload->>'reason'` JSONB'den çekilir; cancel emit'inde şu an reason yok
 *   (orders.ts:704 `rawPayload: { order_id }`) → null döner. Reason ekleme
 *   gelecek PR'da (audit payload schema değişikliği gerekir).
 *
 * Index kullanımı (Karar A1): `audit_logs_tenant_event_created_idx` (tenant_id,
 * event_type, created_at) — 000_init.sql:425. Migration GEREKMİYOR.
 *
 * RBAC: admin + cashier. waiter + kitchen → 403.
 */
export function anomaliesRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  router.get(
    '/anomalies',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = AnomaliesQuerySchema.safeParse(req.query);
        if (!parsed.success) {
          return next(domainError('VALIDATION_ERROR', 400));
        }
        const { range, from, to } = parsed.data;
        const tenantId = req.user!.tenantId;
        const tz = await resolveTenantTimezone(deps.db, tenantId);
        const { startUtc, endUtc } =
          from !== undefined && to !== undefined
            ? getRangeWindow(tz, { kind: 'explicit', from, to })
            : getRangeWindow(tz, { kind: 'range', range });

        // ─── Summary: cancel only ───────────────────────────────────────────
        // orders.status='cancelled' COUNT + order_items.total_cents SUM.
        // void/comp şu an emit edilmiyor → 0 sabit.
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

        // ─── Details: audit_logs.event_type='order.cancelled' ──────────────
        // entity_id (UUID) → orders.id; payload JSONB'den reason çekilir.
        // GROUP BY ile aynı order için tek satır + amount = SUM(oi.total_cents).
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

        const payload = AnomaliesResponseSchema.parse({
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
        res.status(200).json({ data: payload });
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
