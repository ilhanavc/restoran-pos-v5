import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  ChannelMixResponseSchema,
  ReportRangeQuerySchema,
  type ChannelMixResponse,
  type OrderType,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { resolveRangeWindow, storeDateBound } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 9 (2026-09-03) — GET /reports/channel-mix
 *
 * "Salon mu paket mi, ve sipariş hangi saatte geliyor?" Tek endpoint, sabit
 * anahtarlı 3 kanal + 24 saat kovası, hepsi SIFIR-DOLGULU (K9/K10, Amd8 K5
 * deseni). `delivery` bugün 0 üretse de yanıttan BASTIRILMAZ.
 *
 * K9 — Oran/pay alanı YOKTUR: pay UI'da tek yerde hesaplanır. Sunucu yuvarlama
 * politikası icat etmez ve kontrata float yazmaz.
 *
 * K10 — KOVA SAATİ `o.created_at` (siparişin alındığı an), `p.created_at`
 * DEĞİL: bu panelin sorusu "sipariş ne zaman geliyor" (personel planlaması);
 * "para ne zaman tahsil ediliyor" sorusunu `hourly-revenue` zaten yanıtlıyor ve
 * paket siparişte iki an belirgin biçimde ayrışır. PENCERE yine `o.store_date`
 * (Amd7 K1) — bu ikinci bir pencere ekseni yaratmaz (Amd7 K9 emsali).
 *
 * K11 — `table-performance` ile ÇAKIŞMA YOK, ilişki bir INVARIANT'tır:
 *   `channels[dine_in].revenueCents`
 *     === Σ `table-performance.tables[].revenueCents` + `unassignedRevenueCents`
 * İki rapor dik eksenlerdedir (kanal ↔ masa).
 *
 * K12 — "Paket" (= `takeaway` + `delivery`) birleştirmesi UI'da, TEK yerde
 * yapılır; sunucu enum genişlemesine additive kalır.
 *
 * K13 — MIGRATION YOK / INDEX YOK.
 */

/**
 * Sabit kanal anahtarları — `TrendChannelSchema` ile aynı sıra ve içerik
 * (Amd8 K5). `OrderType`'a yeni değer eklenirse `satisfies` bu dosyayı
 * DERLETMEZ; kanal sessizce düşmez.
 */
const CHANNELS = [
  'dine_in',
  'takeaway',
  'delivery',
] as const satisfies readonly OrderType[];

const HOURS_IN_DAY = 24;

interface HourChannelSql {
  hr: number;
  order_type: OrderType;
  order_count: string | number;
  revenue_cents: string | number;
}

interface Cell {
  orderCount: number;
  revenueCents: number;
}

/** `hour × orderType` birleşik anahtarı — tek Map ile O(1) doldurma. */
function cellKey(hour: number, orderType: OrderType): string {
  return `${hour}:${orderType}`;
}

export function channelMixRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<ChannelMixResponse> => {
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

    // TEK sorgu: kanal özeti saat kovalarından TÜRETİLİR → `Σ byHour ===
    // Σ channels` invariantı (K15-c) yapısal olarak garanti, iki ayrı sorgunun
    // ayrışma riski yok. Ciro ekseni `o.total_cents` (trend/daily K5 emsali).
    const rows = await deps.db
      .selectFrom('orders as o')
      .select((eb) => [
        sql<number>`EXTRACT(HOUR FROM (o.created_at AT TIME ZONE ${sql.lit(tz)}))::int`.as(
          'hr',
        ),
        'o.order_type as order_type',
        eb.fn.countAll<number>().as('order_count'),
        eb.fn
          .coalesce(eb.fn.sum<number>('o.total_cents'), sql<number>`0`)
          .as('revenue_cents'),
      ])
      .where('o.tenant_id', '=', tenantId)
      .where('o.status', '=', 'paid')
      // Amd7 K1 — PENCERE siparişin iş-gününde; kova saati K10 gereği
      // `o.created_at`te kalır.
      .where('o.store_date', '>=', storeDateBound(startDate))
      .where('o.store_date', '<=', storeDateBound(endDate))
      .groupBy(['hr', 'o.order_type'])
      .execute();

    const cells = new Map<string, Cell>();
    for (const r of rows as unknown as HourChannelSql[]) {
      cells.set(cellKey(Number(r.hr), r.order_type), {
        orderCount: Number(r.order_count),
        revenueCents: Number(r.revenue_cents),
      });
    }

    // K10 — 24 kova × 3 kanal, veri olmasa da tam seri basılır.
    const byHour = Array.from({ length: HOURS_IN_DAY }, (_, hour) => ({
      hour,
      channels: CHANNELS.map((orderType) => {
        const cell = cells.get(cellKey(hour, orderType));
        return {
          orderType,
          revenueCents: cell?.revenueCents ?? 0,
          orderCount: cell?.orderCount ?? 0,
        };
      }),
    }));

    const channels = CHANNELS.map((orderType) => {
      let orderCount = 0;
      let revenueCents = 0;
      for (const bucket of byHour) {
        const cell = bucket.channels.find((c) => c.orderType === orderType);
        orderCount += cell?.orderCount ?? 0;
        revenueCents += cell?.revenueCents ?? 0;
      }
      return {
        orderType,
        orderCount,
        revenueCents,
        // §3.3 integer division; kanalda sipariş yoksa 0.
        averageBillCents:
          orderCount === 0 ? 0 : Math.floor(revenueCents / orderCount),
      };
    });

    return ChannelMixResponseSchema.parse({
      channels,
      byHour,
      asOf: new Date().toISOString(),
      timezone: tz,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  // K17 — CSV YALNIZ kanal özeti (3 satır). `byHour` CSV'ye GİRMEZ: tek dosyada
  // iki farklı satır şekli TR Excel'de kullanılamaz; saatlik kırılım grafiktir.
  const csvSpec: CsvSpec<ChannelMixResponse> = {
    reportName: 'channel-mix',
    auditQueryKeys: ['range', 'from', 'to', 'limit', 'format'],
    toCsv: (data) => ({
      headers: [
        'window_start',
        'window_end',
        'order_type',
        'order_count',
        'revenue_cents',
        'average_bill_cents',
      ],
      rows: data.channels.map((c) => ({
        window_start: data.windowStart,
        window_end: data.windowEnd,
        order_type: c.orderType,
        order_count: c.orderCount,
        revenue_cents: c.revenueCents,
        average_bill_cents: c.averageBillCents,
      })),
    }),
  };

  router.get(
    '/channel-mix',
    authenticate(deps.accessSecret),
    // K6 — uniform `reports/` ailesi politikası (admin + cashier); yeni RBAC
    // Action YOK, `rbac-parity.test.ts` istisna haritası DEĞİŞMEZ.
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
