import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  ReportRangeQuerySchema,
  TipsReportResponseSchema,
  type TipsReportResponse,
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
 * ADR-015 Amendment 8 K9/K10 (2026-08-11) — GET /reports/tips — **ADMIN-ONLY**.
 *
 * `payments.tip_amount_cents` (Migration 025) ilk kez okunuyor: kolon yazılıyordu
 * ama hiçbir rapor göstermiyordu.
 *
 * Yetki (K9): `reports.tips.read` — `reports/` ailesinin tek-tip
 * `[admin, cashier]` politikasından BİLİNÇLİ sapma; bahşiş personel geliridir,
 * işletme sahibi dışında görünmez. `rbac-parity.test.ts` bunu
 * `REPORTS_EXCEPTIONS` haritasıyla kayıt altında tutar (drift-guard sıkılığı korunur).
 *
 * Semantik (K10 + ADR-015 §3 notu): bahşiş HİÇBİR ciro toplamına eklenmez.
 * Bu yanıt ciro alanı taşımaz; UI'da ciro kartlarından ayrı panelde
 * "Ciroya dahil değildir" alt-metniyle gösterilir.
 *
 * Kırılım YOK (K9): personel/kullanıcı bazlı bahşiş dağılımı ürün sahibi
 * kararıyla reddedildi (KVKK veri minimizasyonu + personel ilişkileri).
 *
 * Beklenti (K11): bahşiş bugün yalnız web "Detaylı Ödeme" ekranından giriliyor →
 * toplam düşük/sıfır görünebilir. Bu rapor hatası değil, giriş-kapsamı gerçeğidir.
 */

export function tipsRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<TipsReportResponse> => {
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
      // Amd7 K4 deseni — bahşiş, ödemenin SİPARİŞİNİN iş-gününe atfedilir.
      .innerJoin('orders as o', (join) =>
        join
          .onRef('o.id', '=', 'p.order_id')
          .onRef('o.tenant_id', '=', 'p.tenant_id'),
      )
      .select((eb) => [
        sql<string>`to_char("o"."store_date", 'YYYY-MM-DD')`.as('store_date'),
        eb.fn.coalesce(eb.fn.sum<number>('p.tip_amount_cents'), sql<number>`0`).as('tip_cents'),
        eb.fn.countAll<number>().as('cnt'),
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
      // ADR-033 — void'lenen ödemenin bahşişi SAYILMAZ (para geri alındı).
      .where('p.voided_at', 'is', null)
      // Bahşişsiz ödemeler `tipPaymentCount`'a girmemeli: NULL **ve** 0 elenir.
      .where('p.tip_amount_cents', 'is not', null)
      .where('p.tip_amount_cents', '>', 0)
      .groupBy('o.store_date')
      .execute();

    const byDate = new Map(
      rows.map((r) => [
        r.store_date,
        { tipCents: Number(r.tip_cents), paymentCount: Number(r.cnt) },
      ]),
    );

    // K4 — tam seri: bahşiş girilmeyen gün 0 ile basılır (grafik boşluk yapmaz).
    const byDay = enumerateCalendarDates(startDate, endDate).map((date) => {
      const cell = byDate.get(date);
      return {
        date,
        tipCents: cell?.tipCents ?? 0,
        paymentCount: cell?.paymentCount ?? 0,
      };
    });

    return TipsReportResponseSchema.parse({
      totalTipCents: byDay.reduce((s, d) => s + d.tipCents, 0),
      tipPaymentCount: byDay.reduce((s, d) => s + d.paymentCount, 0),
      byDay,
      asOf: new Date().toISOString(),
      timezone: tz,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  // K13 — CSV long-format. İKİ kilit: route zaten admin-only, `withCsvFormat`
  // Amd6 gereği CSV'yi ayrıca admin'e daraltır.
  const csvSpec: CsvSpec<TipsReportResponse> = {
    reportName: 'tips',
    auditQueryKeys: ['range', 'from', 'to', 'format'],
    toCsv: (data) => ({
      headers: [
        'date',
        'tip_cents',
        'payment_count',
        'total_tip_cents',
        'timezone',
        'as_of',
      ],
      rows: data.byDay.map((d) => ({
        date: d.date,
        tip_cents: d.tipCents,
        payment_count: d.paymentCount,
        total_tip_cents: data.totalTipCents,
        timezone: data.timezone,
        as_of: data.asOf,
      })),
    }),
  };

  router.get(
    '/tips',
    authenticate(deps.accessSecret),
    // K9 — ADMIN-ONLY. cashier/waiter/kitchen → 403 AUTH_FORBIDDEN.
    authorize(['admin']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
