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
import { resolveRangeWindow, storeDateBound } from '../../utils/business-day';
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
 * ADR-015 Amendment 7 (2026-08-10, K6) — ALTI sorgunun (3 özet + 3 detay)
 *   pencere kaynağı TEK: `orders.store_date`. Böylece "özet sayısı = detay
 *   satır sayısı" yapısal invariant olur; eskiden özet `o.created_at`, cancel
 *   detayı `audit_logs.created_at`, comp ise `order_items.updated_at` okuduğu
 *   için "5 iptal var" deyip 4 satır listelemek mümkündü.
 *   K7 — `occurredAt` GERÇEK olay anını göstermeye devam eder; pencerenin
 *   dışına düşebilir (D'de açılıp D+1'de iptal edilen sipariş).
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
    const { startUtc, endUtc, startDate, endDate } = resolveRangeWindow({
      range,
      from,
      to,
      tz,
    });

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
            // Denetim bulgusu R7-AGG-10 (2026-07-11): ikram edilip SONRA iptal/void
            // edilen bir kalem hem burada hem `compSummary`'de sayılıyordu (çift
            // kayıp). `order_items.total_cents` ikram satırlarda da GERÇEK değeri
            // tutar (yalnız fiş render'ında görüntü-amaçlı 0 basılır — DB kolonu
            // sıfırlanmaz); iki kategori mutually-exclusive olmalı: ikram edilen
            // kalemin "kaybı" yalnız comp_loss'ta sayılır. `oi.is_comped IS NOT
            // TRUE` (WHERE değil, CASE İÇİNDE) — WHERE'e taşınsaydı TÜM kalemleri
            // ikram olan bir sipariş cancel/void SAYIMINDAN (COUNT DISTINCT o.id)
            // da düşerdi; sayım o.status'e bağlı kalmalı, yalnız tutar filtrelenir.
            sql<number>`SUM(CASE WHEN "oi"."is_comped" IS NOT TRUE THEN "oi"."total_cents" ELSE 0 END)`,
            sql<number>`0`,
          )
          .as('cancel_void_loss'),
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', 'in', ['cancelled', 'void'])
      // ADR-015 Amd7 K6 — altı sorgunun ortak pencere kaynağı.
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
      .executeTakeFirstOrThrow();

    // comp: item-level COUNT (her ikram item = 1 satır) + SUM(total_cents).
    // Amd7 K6 — pencere `oi.updated_at` DEĞİL `o.store_date`: `updated_at`
    // bump-trigger'lıdır (her satır güncellemesinde ilerler) → ikram anının
    // kanıtı değildir; bugün ikram edilip yarın not eklenen kalem yarına kayardı.
    const compSummary = await deps.db
      .selectFrom('order_items as oi')
      .innerJoin('orders as o', (join) =>
        join
          .onRef('o.id', '=', 'oi.order_id')
          .onRef('o.tenant_id', '=', 'oi.tenant_id'),
      )
      .select((eb) => [
        eb.fn.count<number>('oi.id').as('comp_count'),
        eb.fn
          .coalesce(sql<number>`SUM("oi"."total_cents")`, sql<number>`0`)
          .as('comp_loss'),
      ])
      .where('oi.tenant_id', '=', tenantId)
      .where('oi.is_comped', '=', true)
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
      .executeTakeFirstOrThrow();

    const cancelCount = Number(cancelVoidSummary.cancel_count);
    const voidCount = Number(cancelVoidSummary.void_count);
    const compCount = Number(compSummary.comp_count);
    const cancelVoidLoss = Number(cancelVoidSummary.cancel_void_loss);
    const compLoss = Number(compSummary.comp_loss);
    const totalLossCents = cancelVoidLoss + compLoss;

    // --- DETAILS ---
    // cancel: audit_logs join order_items SUM. Amd7 K6 — pencere artık olay
    // anında (`al.created_at`) değil, iptal edilen SİPARİŞİN iş-gününde;
    // `orders` join'i bunu sağlar (özetle aynı WHERE).
    const cancelRows = await deps.db
      .selectFrom('audit_logs as al')
      .innerJoin('orders as o', (join) =>
        join
          .onRef('o.id', '=', 'al.entity_id')
          .onRef('o.tenant_id', '=', 'al.tenant_id'),
      )
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
        // R7-AGG-10 — ikram edilen kalem tutarı burada SAYILMAZ (comp_rows'ta
        // ayrı sayılır); sipariş yine görünür, yalnız ikram-satırlarının tutarı 0.
        eb.fn
          .coalesce(
            sql<number>`SUM(CASE WHEN "oi"."is_comped" IS NOT TRUE THEN "oi"."total_cents" ELSE 0 END)`,
            sql<number>`0`,
          )
          .as('amount_cents'),
      ])
      .where('al.tenant_id', '=', tenantId)
      .where('al.event_type', '=', 'order.cancelled')
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
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
        // R7-AGG-10 — cancelRows ile aynı ayrım (ikram tutarı comp_rows'ta).
        eb.fn
          .coalesce(
            sql<number>`SUM(CASE WHEN "oi"."is_comped" IS NOT TRUE THEN "oi"."total_cents" ELSE 0 END)`,
            sql<number>`0`,
          )
          .as('amount_cents'),
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', '=', 'void')
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
      .groupBy(['o.id', 'o.updated_at'])
      .execute();

    // comp: order_items.is_comped=true DB-direct (item-level granularity).
    // Amd7 K6 — `compSummary` ile AYNI pencere/join → sayılar zorunlu eşit.
    // K7 — `occurredAt` yine `oi.updated_at` (görüntü gerçeği).
    const compRows = await deps.db
      .selectFrom('order_items as oi')
      .innerJoin('orders as o', (join) =>
        join
          .onRef('o.id', '=', 'oi.order_id')
          .onRef('o.tenant_id', '=', 'oi.tenant_id'),
      )
      .select([
        'oi.order_id as order_id',
        'oi.updated_at as occurred_at',
        'oi.total_cents as amount_cents',
      ])
      .where('oi.tenant_id', '=', tenantId)
      .where('oi.is_comped', '=', true)
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
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
