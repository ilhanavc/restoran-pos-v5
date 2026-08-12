import { Router, type Request, type Router as ExpressRouter } from 'express';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';
import {
  TrendProductMixQuerySchema,
  TrendProductMixResponseSchema,
  type TrendDimension,
  type TrendEntityBucket,
  type TrendProductMixResponse,
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
 * ADR-015 Amendment 8 K2/K7 (2026-08-11) —
 *   GET /reports/trend/product-mix?dimension=category|product&limit=N
 *
 * Gün × varlık (kategori veya ürün) serisi. Varlıklar pencere GENELİ cirosuna
 * göre Top-N seçilir (default 10, max 25); kalan her şey günlük olarak tek
 * `{entityId: null, entityName: 'other'}` kovasına toplanır → yanıt boyutu
 * `gün × (N+1)` ile sınırlı (30×26 = 780 satır tavan).
 *
 * **Dürüstlük notu (K7):** `order_items` toplamları `orders.total_cents` ile
 * eşit OLMAK ZORUNDA DEĞİLDİR (ikram/iptal kalem, sipariş düzeyi düzeltmeler) —
 * `category-sales` ile aynı özellik. UI, `trend/daily` cirosuyla bu toplamı
 * toplamsal olarak eşitlemeye ÇALIŞMAZ.
 *
 * Ürüne/kategoriye bağlanamayan kalemler (silinmiş ürün, `product_id IS NULL`)
 * de `other` kovasına düşer — sessizce DÜŞÜRÜLMEZ (ciro kaybolmaz).
 */

/** Top-N dışı + atfedilemeyen kalemlerin toplandığı kova adı (UI i18n ile çevirir). */
const OTHER_BUCKET_NAME = 'other';

/** SQL'den okunan gün × varlık ham satırı. */
interface MixRow {
  readonly store_date: string;
  readonly entity_id: string | null;
  readonly entity_name: string | null;
  readonly qty: number;
  readonly revenue_cents: number;
}

export function trendProductMixRoute(deps: {
  db: Kysely<DB>;
  accessSecret: string;
}): ExpressRouter {
  const router = Router();

  const compute = async (req: Request): Promise<TrendProductMixResponse> => {
    const parsed = TrendProductMixQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw domainError('VALIDATION_ERROR', 400);
    }
    const { dimension, limit, range, from, to } = parsed.data;
    const tenantId = req.user!.tenantId;
    const tz = await resolveTenantTimezone(deps.db, tenantId);
    const { startUtc, endUtc, startDate, endDate } = resolveRangeWindow({
      range,
      from,
      to,
      tz,
    });

    const rows = await selectMixRows(deps.db, {
      tenantId,
      dimension,
      startDate,
      endDate,
    });

    // ── 1) Pencere geneli toplam → Top-N seçimi (K7) ──────────────────────
    const overall = new Map<string, TrendEntityBucket>();
    for (const r of rows) {
      // Atfedilemeyen kalem (NULL id) doğrudan `other`'a — Top-N yarışına girmez.
      const key = r.entity_id ?? OTHER_BUCKET_NAME;
      const prev = overall.get(key);
      const qty = Number(r.qty);
      const revenueCents = Number(r.revenue_cents);
      overall.set(key, {
        entityId: r.entity_id,
        entityName: prev?.entityName ?? r.entity_name ?? OTHER_BUCKET_NAME,
        qty: (prev?.qty ?? 0) + qty,
        revenueCents: (prev?.revenueCents ?? 0) + revenueCents,
      });
    }

    const named = [...overall.values()].filter((e) => e.entityId !== null);
    named.sort((a, b) => b.revenueCents - a.revenueCents);
    const topIds = new Set(named.slice(0, limit).map((e) => e.entityId!));

    // ── 2) Gün × varlık kovaları; Top-N dışı `other`'a katlanır ───────────
    const byDate = new Map<string, Map<string, TrendEntityBucket>>();
    for (const r of rows) {
      const inTop = r.entity_id !== null && topIds.has(r.entity_id);
      const key = inTop ? r.entity_id! : OTHER_BUCKET_NAME;
      const day = byDate.get(r.store_date) ?? new Map<string, TrendEntityBucket>();
      const prev = day.get(key);
      day.set(key, {
        entityId: inTop ? r.entity_id : null,
        entityName: inTop
          ? (prev?.entityName ?? r.entity_name ?? OTHER_BUCKET_NAME)
          : OTHER_BUCKET_NAME,
        qty: (prev?.qty ?? 0) + Number(r.qty),
        revenueCents: (prev?.revenueCents ?? 0) + Number(r.revenue_cents),
      });
      byDate.set(r.store_date, day);
    }

    // Pencere geneli özet: Top-N (ciro azalan) + varsa `other`.
    const otherOverall = foldOther(named.slice(limit), overall.get(OTHER_BUCKET_NAME));
    const entities: TrendEntityBucket[] = [
      ...named.slice(0, limit),
      ...(otherOverall === undefined ? [] : [otherOverall]),
    ];

    // K4 — tam seri: veri olmayan gün BOŞ `entities` dizisiyle basılır
    // (kova kümesi güne göre değişebilir; sıfır-dolgu gün SEVİYESİNDE garanti).
    const points = enumerateCalendarDates(startDate, endDate).map((date) => {
      const day = byDate.get(date);
      const dayEntities =
        day === undefined
          ? []
          : [...day.values()].sort((a, b) => b.revenueCents - a.revenueCents);
      return { date, entities: dayEntities };
    });

    return TrendProductMixResponseSchema.parse({
      dimension,
      entities,
      points,
      asOf: new Date().toISOString(),
      timezone: tz,
      windowStart: startUtc.toISOString(),
      windowEnd: endUtc.toISOString(),
    });
  };

  // K13 — CSV long-format: `date × entity` başına 1 satır.
  const csvSpec: CsvSpec<TrendProductMixResponse> = {
    reportName: 'trend-product-mix',
    auditQueryKeys: ['range', 'from', 'to', 'dimension', 'limit', 'format'],
    toCsv: (data) => ({
      headers: [
        'date',
        'dimension',
        'entity_id',
        'entity_name',
        'qty',
        'revenue_cents',
        'timezone',
        'as_of',
      ],
      rows: data.points.flatMap((p) =>
        p.entities.map((e) => ({
          date: p.date,
          dimension: data.dimension,
          entity_id: e.entityId ?? '',
          entity_name: e.entityName,
          qty: e.qty,
          revenue_cents: e.revenueCents,
          timezone: data.timezone,
          as_of: data.asOf,
        })),
      ),
    }),
  };

  router.get(
    '/trend/product-mix',
    authenticate(deps.accessSecret),
    authorize(['admin', 'cashier']),
    withCsvFormat(csvSpec, compute, {
      db: deps.db,
      getTenantInfo: (tid) => getTenantInfo(deps.db, tid),
    }),
  );

  return router;
}

/**
 * Top-N dışında kalanları + atfedilemeyenleri tek `other` kovasında birleştirir.
 * Hiç artık yoksa `undefined` döner (boş kova basılmaz).
 */
function foldOther(
  overflow: readonly TrendEntityBucket[],
  unattributed: TrendEntityBucket | undefined,
): TrendEntityBucket | undefined {
  const parts = unattributed === undefined ? overflow : [...overflow, unattributed];
  if (parts.length === 0) return undefined;
  return {
    entityId: null,
    entityName: OTHER_BUCKET_NAME,
    qty: parts.reduce((s, e) => s + e.qty, 0),
    revenueCents: parts.reduce((s, e) => s + e.revenueCents, 0),
  };
}

/**
 * Gün × varlık ham toplamlarını okur.
 *
 * Ortak filtreler (K6, mevcut raporlarla AYNI): `o.status='paid'`,
 * `oi.status != 'cancelled'`, pencere `o.store_date` (Amd7 K1).
 * Varlık kimliği boyuta göre değişir; `category` boyutunda `products` →
 * `categories` LEFT JOIN'i üzerinden (ürünü silinmiş kalem NULL id ile gelir,
 * çağıran onu `other`'a katlar).
 */
async function selectMixRows(
  db: Kysely<DB>,
  args: {
    tenantId: string;
    dimension: TrendDimension;
    startDate: string;
    endDate: string;
  },
): Promise<MixRow[]> {
  const base = db
    .selectFrom('order_items as oi')
    .innerJoin('orders as o', (join) =>
      join
        .onRef('o.id', '=', 'oi.order_id')
        .onRef('o.tenant_id', '=', 'oi.tenant_id'),
    )
    .where('oi.tenant_id', '=', args.tenantId)
    .where('oi.status', '!=', 'cancelled')
    .where('o.status', '=', 'paid')
    .where('o.store_date', '>=', storeDateBound(args.startDate))
    .where('o.store_date', '<=', storeDateBound(args.endDate));

  const day = sql<string>`to_char("o"."store_date", 'YYYY-MM-DD')`;

  if (args.dimension === 'product') {
    const rows = await base
      .select((eb) => [
        day.as('store_date'),
        'oi.product_id as entity_id',
        // Snapshot ad (top-selling paritesi): ürün sonradan yeniden adlandırılsa
        // bile geçmiş gün satıldığı adla raporlanır.
        'oi.product_name as entity_name',
        eb.fn.coalesce(eb.fn.sum<number>('oi.quantity'), sql<number>`0`).as('qty'),
        eb.fn.coalesce(eb.fn.sum<number>('oi.total_cents'), sql<number>`0`).as('revenue_cents'),
      ])
      .groupBy(['o.store_date', 'oi.product_id', 'oi.product_name'])
      .execute();
    return rows as MixRow[];
  }

  const rows = await base
    .leftJoin('products as p', (join) =>
      join
        .onRef('p.id', '=', 'oi.product_id')
        .onRef('p.tenant_id', '=', 'oi.tenant_id'),
    )
    .leftJoin('categories as c', (join) =>
      join
        .onRef('c.id', '=', 'p.category_id')
        .onRef('c.tenant_id', '=', 'oi.tenant_id'),
    )
    .select((eb) => [
      day.as('store_date'),
      'c.id as entity_id',
      'c.name as entity_name',
      eb.fn.coalesce(eb.fn.sum<number>('oi.quantity'), sql<number>`0`).as('qty'),
      eb.fn.coalesce(eb.fn.sum<number>('oi.total_cents'), sql<number>`0`).as('revenue_cents'),
    ])
    .groupBy(['o.store_date', 'c.id', 'c.name'])
    .execute();
  return rows as MixRow[];
}
