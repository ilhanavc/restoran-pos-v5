import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  TablePerformanceQuerySchema,
  TablePerformanceResponseSchema,
  type TablePerformanceResponse,
} from '@restoran-pos/shared-types';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { resolveRangeWindow, storeDateBound } from '../../utils/business-day';
import { resolveTenantTimezone } from './tz';
import { domainError } from '../../errors.js';
import { withCsvFormat, type CsvSpec } from '../../utils/csv-format-handler';
import { getTenantInfo } from '../../utils/tenant-info';

/**
 * ADR-015 Amendment 9 (2026-09-03) — GET /reports/table-performance
 *
 * "Hangi masa ne kazandırıyor, ne kadar hızlı dönüyor?" Charter MVP maddesi
 * `docs/project-charter.md:67` ("masa/paket dağılımı") ilk kez masa ekseninde
 * karşılanır; v3'te masa-bazlı gruplama HİÇ yoktu.
 *
 * K1 — Ayrı endpoint: `closed-orders` satır-bazlı listedir, ona `groupBy=table`
 * eklemek kontratı polimorfik yapardı (`closed-orders.ts` diff'te GÖRÜNMEZ).
 *
 * K5 — PENCERE ekseni `o.store_date` (Amd7 K1, `storeDateBound`). `MAX(aktif
 * p.created_at)` pencere KURMAZ, sıralama YAPMAZ; yalnız (a) K3 süre hesabının
 * sağ ucu, (b) `lastClosedAt` gösterim alanıdır. Sıralama `revenueCents DESC`,
 * eşitlikte `tableCode ASC` (deterministik).
 *
 * K7 — Filtre: `order_type='dine_in'` + `status='paid'` (yani "kapanan
 * masalar"; `open/sent_to_kitchen/partially_served/served/billed/cancelled/
 * void/merged` hepsi dışarıda) + her ödeme agregasyonunda `p.voided_at IS NULL`.
 *
 * K13 — MIGRATION YOK / INDEX YOK: pencere sorgusu zaten mevcut
 * `orders_tenant_store_date_order_no_uq (tenant_id, store_date, order_no)`
 * index'inin lider kolonlarını kullanıyor (EXPLAIN ile doğrulandı — Bitmap
 * Index Scan), yeni bir kısmi index redundant olurdu.
 */

/** Süre agregasyonu tavanı — unutulup ertesi gün kapatılan masa (K3.f). */
const MAX_OCCUPANCY_SECONDS = 86_400;

interface TableRowSql {
  table_code: string;
  area_name: string | null;
  bill_count: string | number;
  revenue_cents: string | number;
  duration_sample_size: string | number;
  avg_occupancy_seconds: string | number | null;
  last_closed_at: Date | string | null;
}

interface SummarySql {
  active_day_count: string | number;
  duration_excluded_count: string | number;
  unassigned_order_count: string | number;
  unassigned_revenue_cents: string | number;
  total_table_count: string | number;
}

/**
 * Her iki sorgunun paylaştığı CTE gövdesi (`base` + `scored`).
 *
 * `base`  — pencereye giren kapanmış salon adisyonları; masa KODU ekseni
 *           `COALESCE(table_code_snapshot, t.code)` (K2), son aktif ödeme anı
 *           LATERAL alt-sorgudan, `is_merge_target` (K3.e) küme-temelli
 *           `LEFT JOIN` ile.
 *
 * `is_merge_target` neden JOIN, neden EXISTS değil: SELECT listesindeki EXISTS
 * semi-join'e pull-up EDİLEMEZ; `merged_into_order_id` indexsiz olduğundan
 * planner tahmini `work_mem`'i aşınca korele Seq Scan'e düşer ve CTE bu alt
 * sorguyu iki sorguda birden tetikler (O(n²) riski). Tenant'ın birleştirme
 * hedeflerini TEK seferde küme olarak toplayıp `o.id` ile eşliyoruz —
 * sonuç aynı, plan hash join.
 * `scored`— adisyon başına `occupancy_seconds`; dışlananlar NULL olur:
 *           birleştirme hedefi (K3.e), ödemesi bulunamayan satır, `<= 0` veya
 *           `> 86400` aykırı değer (K3.f). Dışlama YALNIZ süreyi etkiler; ciro
 *           ve `billCount` etkilenmez.
 */
function scoredCte(
  tenantId: string,
  startDate: string,
  endDate: string,
): RawBuilder<unknown> {
  return sql`
    base AS (
      SELECT
        o.id AS id,
        COALESCE(o.table_code_snapshot, t.code) AS table_code,
        o.area_name_snapshot AS area_name,
        o.store_date AS store_date,
        o.total_cents AS total_cents,
        o.created_at AS opened_at,
        pay.last_paid_at AS last_paid_at,
        (mt.id IS NOT NULL) AS is_merge_target
      FROM orders o
      LEFT JOIN tables t
        ON t.id = o.table_id
        AND t.tenant_id = o.tenant_id
      LEFT JOIN (
        SELECT DISTINCT merged_into_order_id AS id
        FROM orders
        WHERE tenant_id = ${tenantId}::uuid
          AND merged_into_order_id IS NOT NULL
      ) mt ON mt.id = o.id
      LEFT JOIN LATERAL (
        SELECT MAX(p.created_at) AS last_paid_at
        FROM payments p
        WHERE p.tenant_id = o.tenant_id
          AND p.order_id = o.id
          AND p.voided_at IS NULL
      ) pay ON TRUE
      WHERE o.tenant_id = ${tenantId}::uuid
        AND o.order_type = 'dine_in'
        AND o.status = 'paid'
        AND o.store_date >= ${storeDateBound(startDate)}
        AND o.store_date <= ${storeDateBound(endDate)}
    ),
    scored AS (
      SELECT
        b.*,
        CASE
          WHEN b.is_merge_target THEN NULL
          WHEN b.last_paid_at IS NULL THEN NULL
          WHEN EXTRACT(EPOCH FROM (b.last_paid_at - b.opened_at)) <= 0 THEN NULL
          WHEN EXTRACT(EPOCH FROM (b.last_paid_at - b.opened_at))
               > ${sql.lit(MAX_OCCUPANCY_SECONDS)} THEN NULL
          ELSE EXTRACT(EPOCH FROM (b.last_paid_at - b.opened_at))
        END AS occupancy_seconds
      FROM base b
    )
  `;
}

/** `bigint`/`numeric` sütunları pg sürücüsünden string döner — tek yerde çevir. */
function toInt(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value));
}

export function tablePerformanceRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<TablePerformanceResponse> => {
    const parsed = TablePerformanceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { limit, range, from, to } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc, startDate, endDate } = resolveRangeWindow({
      range,
      from,
      to,
      tz,
    });

    const cte = scoredCte(tenantId, startDate, endDate);

    // Masa satırları — masasız (veri anomalisi) adisyonlar satır ÜRETMEZ, ama
    // özet sorgusunda `unassigned*` olarak dürüstçe raporlanır (K7/K16.f).
    const rowsResult = await sql<TableRowSql>`
      WITH ${cte}
      SELECT
        s.table_code AS table_code,
        MAX(s.area_name) AS area_name,
        COUNT(*) AS bill_count,
        COALESCE(SUM(s.total_cents), 0) AS revenue_cents,
        COUNT(s.occupancy_seconds) AS duration_sample_size,
        AVG(s.occupancy_seconds) AS avg_occupancy_seconds,
        MAX(s.last_paid_at) AS last_closed_at
      FROM scored s
      WHERE s.table_code IS NOT NULL
      GROUP BY s.table_code
      ORDER BY revenue_cents DESC, s.table_code ASC
      LIMIT ${limit}
    `.execute(deps.db);

    // K4 — `activeDayCount` TENANT GENELİ: pencere içinde en az bir kapanmış
    // salon adisyonu üretmiş DISTINCT iş-günü. Masa bazlı saymak "hiç açılmayan
    // masa = sonsuz devir" saçmalığı üretirdi; takvim gününe bölmek ise kapalı
    // günlerde her masayı haksızca cezalandırırdı.
    const summaryResult = await sql<SummarySql>`
      WITH ${cte}
      SELECT
        COUNT(DISTINCT s.store_date) AS active_day_count,
        COUNT(*) FILTER (WHERE s.occupancy_seconds IS NULL)
          AS duration_excluded_count,
        COUNT(*) FILTER (WHERE s.table_code IS NULL) AS unassigned_order_count,
        COALESCE(SUM(s.total_cents) FILTER (WHERE s.table_code IS NULL), 0)
          AS unassigned_revenue_cents,
        COUNT(DISTINCT s.table_code) AS total_table_count
      FROM scored s
    `.execute(deps.db);

    const summary = summaryResult.rows[0];
    const activeDayCount = toInt(summary?.active_day_count);

    const tables = rowsResult.rows.map((r) => {
      const billCount = toInt(r.bill_count);
      const revenueCents = toInt(r.revenue_cents);
      const durationSampleSize = toInt(r.duration_sample_size);
      return {
        tableCode: r.table_code,
        areaName: r.area_name,
        billCount,
        revenueCents,
        // §3.3 integer division — kuruş float'a ASLA dönüşmez.
        averageBillCents:
          billCount === 0 ? 0 : Math.floor(revenueCents / billCount),
        // K3.g — örneklem boşsa `null`; 0 basmak "sıfır dakika oturdu" yalanıdır.
        avgOccupancySeconds:
          durationSampleSize === 0 || r.avg_occupancy_seconds === null
            ? null
            : Math.round(Number(r.avg_occupancy_seconds)),
        durationSampleSize,
        // K4 — devir hızı ×1000 (integer kontrat); payda yoksa `null`.
        turnsPerThousand:
          activeDayCount === 0
            ? null
            : Math.round((billCount * 1000) / activeDayCount),
        lastClosedAt:
          r.last_closed_at === null
            ? null
            : new Date(r.last_closed_at).toISOString(),
      };
    });

    return TablePerformanceResponseSchema.parse({
      tables,
      activeDayCount,
      durationExcludedCount: toInt(summary?.duration_excluded_count),
      unassignedOrderCount: toInt(summary?.unassigned_order_count),
      unassignedRevenueCents: toInt(summary?.unassigned_revenue_cents),
      totalTableCount: toInt(summary?.total_table_count),
      asOf: new Date().toISOString(),
      timezone: tz,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  // K17 — masa başına 1 satır, başlık sırası KİLİTLİ. Boş süre hücresi `''`
  // (0 DEĞİL — K3.g dürüstlüğü CSV'de de korunur).
  const csvSpec: CsvSpec<TablePerformanceResponse> = {
    reportName: 'table-performance',
    auditQueryKeys: ['range', 'from', 'to', 'limit', 'format'],
    toCsv: (data) => ({
      headers: [
        'window_start',
        'window_end',
        'table_code',
        'area_name',
        'bill_count',
        'revenue_cents',
        'average_bill_cents',
        'avg_occupancy_seconds',
        'duration_sample_size',
        'turns_per_thousand',
        'last_closed_at',
      ],
      rows: data.tables.map((row) => ({
        window_start: data.windowStart,
        window_end: data.windowEnd,
        table_code: row.tableCode,
        area_name: row.areaName ?? '',
        bill_count: row.billCount,
        revenue_cents: row.revenueCents,
        average_bill_cents: row.averageBillCents,
        avg_occupancy_seconds: row.avgOccupancySeconds ?? '',
        duration_sample_size: row.durationSampleSize,
        turns_per_thousand: row.turnsPerThousand ?? '',
        last_closed_at: row.lastClosedAt ?? '',
      })),
    }),
  };

  router.get(
    '/table-performance',
    authenticate(deps.accessSecret),
    // K6 — uniform `reports/` ailesi politikası: masa cirosu PII içermez,
    // `closed-orders` aynı veriyi zaten kasiyere satır bazında gösteriyor.
    // `rbac-parity.test.ts` istisna haritası DEĞİŞMEZ. CSV yine admin-only
    // (Amd6, `withCsvFormat` içinde).
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}
