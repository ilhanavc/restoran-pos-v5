import {
  Router,
  type Request,
  type Router as ExpressRouter,
} from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  DailyCloseQuerySchema,
  DailyCloseResponseSchema,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { getDailyCloseWindow } from '../../utils/business-day';
import { parseDateParam, todayStoreDateString } from '../../utils/store-date.js';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { computeDailyCloseAggregate } from './daily-close-aggregate';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 1 (Karar 4, 2026-05-11) — GET /reports/daily-close (Z-Report).
 * ADR-021 PR-4b2 — `?format=csv` desteği eklendi.
 *
 * CSV: tek-satır summary (response array'leri Excel parser uyumu için
 * flatten edilmez — kullanıcı detaylı array'ler için ilgili endpoint'i ayrı
 * CSV ile indirir: category-sales, payment-distribution, hourly-revenue).
 */

type DailyCloseData = ReturnType<typeof DailyCloseResponseSchema.parse>;

export function dailyCloseRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<DailyCloseData> => {
    const parsed = DailyCloseQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { date } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    // Regex'ten geçen ama takvimde olmayan tarih (örn. 2026-13-99): ISO parse
    // Invalid Date üretir → 400 (eski davranış sessiz normalize idi; Amd5 K9).
    if (date !== undefined && Number.isNaN(parseDateParam(date).getTime())) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    // Tek saat-kaynağı (gate AMD5-KR-02): pencere etiketi (windowStart/End,
    // K8 — kontrat değişmez) ile sorgulanan iş-günü aynı andan türer.
    const now = new Date();
    const { startUtc, endUtc } = getDailyCloseWindow(tz, date, now);
    // Sorgu günü YYYY-MM-DD STRING (gate SQL-TZ-01 — pg Date serializasyonu
    // süreç-TZ-bağımlı; string ::date cast'i değil).
    const storeDate = date ?? todayStoreDateString(tz, now);

    const aggregate = await computeDailyCloseAggregate({
      db: deps.db,
      tenantId,
      tz,
      window: { kind: 'businessDay', date: storeDate },
      sqlRef: sql,
    });

    return DailyCloseResponseSchema.parse({
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
      ...aggregate,
    });
  };

  const csvSpec: CsvSpec<DailyCloseData> = {
    reportName: 'daily-close',
    toCsv: (data) => {
      const top = data.topCategories[0];
      return {
        headers: [
          'window_start',
          'window_end',
          'total_revenue_cents',
          'order_count',
          'avg_bill_cents',
          'cancel_count',
          'total_loss_cents',
          'top_category_name',
          'top_category_revenue_cents',
        ],
        rows: [
          {
            window_start: data.windowStart,
            window_end: data.windowEnd,
            total_revenue_cents: data.totalRevenueCents,
            order_count: data.orderCount,
            avg_bill_cents: data.avgBillCents,
            cancel_count: data.anomalySummary.cancelCount,
            total_loss_cents: data.anomalySummary.totalLossCents,
            top_category_name: top?.categoryName ?? '',
            top_category_revenue_cents: top?.revenueCents ?? 0,
          },
        ],
      };
    },
  };

  router.get(
    '/daily-close',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
