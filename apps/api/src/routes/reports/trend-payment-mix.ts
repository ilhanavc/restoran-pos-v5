import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  ReportRangeQuerySchema,
  TrendPaymentMixResponseSchema,
  type PaymentType,
  type TrendPaymentMixResponse,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import {
  enumerateCalendarDates,
  resolveRangeWindow,
  storeDateBound,
} from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 8 K2 (2026-08-11) — GET /reports/trend/payment-mix
 *
 * Gün × ödeme türü serisi. `payment-distribution`'ın gün eksenli karşılığı:
 * bir günün toplamı, aynı gün için çağrılan `payment-distribution`'ın
 * `totalCents` değeriyle BİREBİR eşittir (A8.5-a invariant testi).
 *
 * Pencere `o.store_date` (Amd7 K4): ödeme, SİPARİŞİNİN iş-gününe atfedilir —
 * `payments`'a tarih kolonu eklenmez, gün `p.created_at`'ten türetilmez. Aksi
 * halde 23:50'de açılıp 00:10'da ödenen adisyon iki farklı güne düşerdi.
 */

/** Ödeme türü kırılımının sabit anahtar kümesi (K5) — 0 olsa bile HER GÜN basılır. */
const PAYMENT_TYPES: readonly PaymentType[] = ['cash', 'card', 'transfer'];

export function trendPaymentMixRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<TrendPaymentMixResponse> => {
    const parsed = ReportRangeQuerySchema.safeParse(req.query);
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

    const rows = await deps.db
      .selectFrom('payments as p')
      .innerJoin('orders as o', (join) =>
        join
          .onRef('o.id', '=', 'p.order_id')
          .onRef('o.tenant_id', '=', 'p.tenant_id'),
      )
      .select((eb) => [
        sql<string>`to_char("o"."store_date", 'YYYY-MM-DD')`.as('store_date'),
        'p.payment_type as payment_type',
        eb.fn.coalesce(eb.fn.sum<number>('p.amount_cents'), sql<number>`0`).as('total'),
        eb.fn.countAll<number>().as('cnt'),
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      // ADR-015 Amd7 K1/K4 — ödeme siparişinin iş-gününe yazılır.
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
      // ADR-033 — void'lenmiş ödeme dağılıma SAYILMAZ (reopen→reclose sonrası
      // void satır paid order'da kalır; filtrelenmezse çift sayım).
      .where('p.voided_at', 'is', null)
      .groupBy(['o.store_date', 'p.payment_type'])
      .execute();

    // date → paymentType → {total, count}
    const byDate = new Map<string, Map<string, { total: number; count: number }>>();
    for (const r of rows) {
      const day = byDate.get(r.store_date) ?? new Map();
      day.set(r.payment_type, { total: Number(r.total), count: Number(r.cnt) });
      byDate.set(r.store_date, day);
    }

    // K4 — tam seri + K5 — sabit anahtarlı, sıfır dolgulu kırılım.
    const points = enumerateCalendarDates(startDate, endDate).map((date) => {
      const day = byDate.get(date);
      const paymentTypes = PAYMENT_TYPES.map((paymentType) => {
        const cell = day?.get(paymentType);
        return {
          paymentType,
          totalCents: cell?.total ?? 0,
          count: cell?.count ?? 0,
        };
      });
      return {
        date,
        totalCents: paymentTypes.reduce((s, b) => s + b.totalCents, 0),
        paymentTypes,
      };
    });

    return TrendPaymentMixResponseSchema.parse({
      points,
      totalCents: points.reduce((s, p) => s + p.totalCents, 0),
      asOf: new Date().toISOString(),
      timezone: tz,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  // K13 — CSV long-format: `date × payment_type` başına 1 satır.
  const csvSpec: CsvSpec<TrendPaymentMixResponse> = {
    reportName: 'trend-payment-mix',
    auditQueryKeys: ['range', 'from', 'to', 'format'],
    toCsv: (data) => ({
      headers: [
        'date',
        'payment_type',
        'total_cents',
        'payment_count',
        'day_total_cents',
        'timezone',
        'as_of',
      ],
      rows: data.points.flatMap((p) =>
        p.paymentTypes.map((b) => ({
          date: p.date,
          payment_type: b.paymentType,
          total_cents: b.totalCents,
          payment_count: b.count,
          day_total_cents: p.totalCents,
          timezone: data.timezone,
          as_of: data.asOf,
        })),
      ),
    }),
  };

  router.get(
    '/trend/payment-mix',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
