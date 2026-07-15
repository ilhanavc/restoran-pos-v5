import { sql, type Kysely } from 'kysely';
import type { DB } from '@restoran-pos/db';

/**
 * ADR-015 Amendment 1 (Karar 4 + Karar 5) — daily-close + snapshot ortak
 * aggregate hesaplayıcısı. İki endpoint aynı response schema'yı (DailyClose)
 * paylaşır; window dışındaki tüm aggregation logic burada.
 *
 * 5 bağımsız query, hepsi `Promise.all` ile parallel:
 *   1. revenue/orderCount/avgBill — orders.status='paid' SUM(total_cents)
 *   2. paymentBreakdown — payments JOIN orders.status='paid'
 *   3. topCategories (top 5) — categories LEFT JOIN order_items (paid orders)
 *   4. anomalySummary (cancel-only) — orders.status='cancelled'
 *   5. hourlyBuckets (24 entry, hour 0-23 local TZ) — payments JOIN orders.paid
 *
 * Pencere — ADR-015 Amendment 5 (R7-TZ-12) iki mod:
 *   - `businessDay` (Z-raporu): tüm sorgular `orders.store_date = date`.
 *     Ödemeler SİPARİŞİNİN iş-gününe atfedilir (p.created_at penceresi YOK) →
 *     `SUM(revenue) == SUM(paymentBreakdown)` invariantı gün-sınırında korunur
 *     (23:50 açılan, 00:10 ödenen masa iki tarafta da aynı güne düşer).
 *   - `timeRange` (X-raporu/snapshot): [startUtc, endUtc) created_at kesiti —
 *     gün-içi "şu ana kadar" semantiği, Amd5 K2 ile bilinçli DEĞİŞMEDİ.
 * Para birimi her zaman kuruş integer (float yok, ADR-015).
 *
 * void/comp ayrı PR'da emit edilecek; şimdilik 0 sabit (PR-2b paritesi).
 */

/**
 * ADR-015 Amd5 K1/K2 — Z: iş-günü (store_date) · X: zaman-kesiti (created_at).
 * `date` bilinçli STRING (`YYYY-MM-DD`): JS Date, pg driver'da süreç-TZ'siyle
 * serialize edilir (UTC-batısı host'ta D-1'e kayardı — gate SQL-TZ-01); string
 * `::date` cast'i TZ-bağımsızdır.
 */
export type DailyCloseWindow =
  | { kind: 'businessDay'; date: string }
  | { kind: 'timeRange'; startUtc: Date; endUtc: Date };

export interface DailyCloseAggregateInput {
  db: Kysely<DB>;
  tenantId: string;
  tz: string;
  window: DailyCloseWindow;
  /** sql tag'ini caller'dan al (test/import simetri sağlamak için aslında
   *  modül-içi sql kullanıyoruz; bu field forward compat için tutulur). */
  sqlRef?: typeof sql;
}

export interface DailyCloseAggregateResult {
  totalRevenueCents: number;
  orderCount: number;
  avgBillCents: number;
  paymentBreakdown: Array<{
    paymentType: 'cash' | 'card' | 'transfer';
    count: number;
    amountCents: number;
    sharePct: number;
  }>;
  topCategories: Array<{
    categoryId: string;
    categoryName: string;
    qty: number;
    revenueCents: number;
  }>;
  anomalySummary: {
    cancelCount: number;
    voidCount: number;
    compCount: number;
    totalLossCents: number;
  };
  hourlyBuckets: Array<{
    hour: number;
    orderCount: number;
    revenueCents: number;
  }>;
}

export async function computeDailyCloseAggregate(
  input: DailyCloseAggregateInput,
): Promise<DailyCloseAggregateResult> {
  const { db, tenantId, tz, window } = input;
  const isDay = window.kind === 'businessDay';

  // ─── 5 query parallel ─────────────────────────────────────────────────────
  const [revenueRow, paymentRows, categoryRows, anomalyRow, hourlyRows] =
    await Promise.all([
      // 1. revenue + orderCount (paid only) — today-revenue paritesi.
      db
        .selectFrom('orders')
        .select((eb) => [
          eb.fn
            .coalesce(eb.fn.sum<number>('total_cents'), sql<number>`0`)
            .as('total'),
          eb.fn.countAll<number>().as('order_count'),
        ])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'paid')
        .$if(isDay, (qb) =>
          qb.where('store_date', '=', sql<Date>`${(window as { date: string }).date}::date`),
        )
        .$if(!isDay, (qb) =>
          qb
            .where('created_at', '>=', (window as { startUtc: Date }).startUtc)
            .where('created_at', '<', (window as { endUtc: Date }).endUtc),
        )
        .executeTakeFirstOrThrow(),

      // 2. payment breakdown — payment-distribution paritesi.
      //    Amd5 K1: businessDay modunda ödeme SİPARİŞİNİN gününe atfedilir
      //    (o.store_date filtresi; p.created_at penceresi YOK).
      db
        .selectFrom('payments as p')
        .innerJoin('orders as o', (join) =>
          join
            .onRef('o.id', '=', 'p.order_id')
            .onRef('o.tenant_id', '=', 'p.tenant_id'),
        )
        .select((eb) => [
          'p.payment_type as payment_type',
          eb.fn
            .coalesce(eb.fn.sum<number>('p.amount_cents'), sql<number>`0`)
            .as('total'),
          eb.fn.countAll<number>().as('cnt'),
        ])
        .where('p.tenant_id', '=', tenantId)
        .where('o.status', '=', 'paid')
        .$if(isDay, (qb) =>
          qb.where('o.store_date', '=', sql<Date>`${(window as { date: string }).date}::date`),
        )
        .$if(!isDay, (qb) =>
          qb
            .where('p.created_at', '>=', (window as { startUtc: Date }).startUtc)
            .where('p.created_at', '<', (window as { endUtc: Date }).endUtc),
        )
        // ADR-033 SUM fan-out — void'lenmiş ödeme gün-sonu ödeme dağılımına SAYILMAZ.
        .where('p.voided_at', 'is', null)
        .groupBy('p.payment_type')
        .execute(),

      // 3. top 5 categories — category-sales paritesi (paid only, cancelled
      //    item dışlanır), `revenue_cents DESC LIMIT 5`.
      db
        .selectFrom('categories as c')
        .leftJoin('products as p', (join) =>
          join
            .onRef('p.category_id', '=', 'c.id')
            .onRef('p.tenant_id', '=', 'c.tenant_id')
            .on('p.deleted_at', 'is', null),
        )
        .leftJoin('order_items as oi', (join) =>
          join
            .onRef('oi.product_id', '=', 'p.id')
            .onRef('oi.tenant_id', '=', 'c.tenant_id')
            .on('oi.status', '!=', 'cancelled'),
        )
        .leftJoin('orders as o', (join) =>
          join
            .onRef('o.id', '=', 'oi.order_id')
            .onRef('o.tenant_id', '=', 'c.tenant_id')
            .on('o.status', '=', 'paid')
            .$call((j) =>
              isDay
                ? j.on('o.store_date', '=', sql<Date>`${(window as { date: string }).date}::date`)
                : j
                    .on('o.created_at', '>=', (window as { startUtc: Date }).startUtc)
                    .on('o.created_at', '<', (window as { endUtc: Date }).endUtc),
            ),
        )
        .select((eb) => [
          'c.id as category_id',
          'c.name as category_name',
          eb.fn
            .coalesce(
              sql<number>`SUM(CASE WHEN "o"."id" IS NOT NULL THEN "oi"."quantity" ELSE 0 END)`,
              sql<number>`0`,
            )
            .as('qty'),
          eb.fn
            .coalesce(
              sql<number>`SUM(CASE WHEN "o"."id" IS NOT NULL THEN "oi"."total_cents" ELSE 0 END)`,
              sql<number>`0`,
            )
            .as('revenue_cents'),
        ])
        .where('c.tenant_id', '=', tenantId)
        .where('c.deleted_at', 'is', null)
        .groupBy(['c.id', 'c.name'])
        .orderBy('revenue_cents', 'desc')
        .limit(5)
        .execute(),

      // 4. anomaly summary — cancel-only MVP (PR-2b paritesi). void/comp
      //    şu an emit edilmiyor → 0 sabit.
      db
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
        .$if(isDay, (qb) =>
          qb.where('o.store_date', '=', sql<Date>`${(window as { date: string }).date}::date`),
        )
        .$if(!isDay, (qb) =>
          qb
            .where('o.created_at', '>=', (window as { startUtc: Date }).startUtc)
            .where('o.created_at', '<', (window as { endUtc: Date }).endUtc),
        )
        .executeTakeFirstOrThrow(),

      // 5. hourly buckets — hourly-revenue paritesi (paid-only, EXTRACT HOUR
      //    AT TIME ZONE local). 24 entry, boş saatler 0/0.
      db
        .selectFrom('payments as p')
        .innerJoin('orders as o', (join) =>
          join
            .onRef('o.id', '=', 'p.order_id')
            .onRef('o.tenant_id', '=', 'p.tenant_id'),
        )
        .select((eb) => [
          sql<number>`EXTRACT(HOUR FROM (p.created_at AT TIME ZONE ${sql.lit(tz)}))::int`.as(
            'hr',
          ),
          eb.fn
            .coalesce(eb.fn.sum<number>('p.amount_cents'), sql<number>`0`)
            .as('rev'),
          sql<number>`COUNT(DISTINCT p.order_id)`.as('cnt'),
        ])
        .where('p.tenant_id', '=', tenantId)
        .where('o.status', '=', 'paid')
        // Amd5 K1+K5: businessDay'de atıf o.store_date; kova saati p.created_at
        // AT TZ kalır (00:10 ödemesi D gününün hour=0 kovası — dürüst gösterim).
        .$if(isDay, (qb) =>
          qb.where('o.store_date', '=', sql<Date>`${(window as { date: string }).date}::date`),
        )
        .$if(!isDay, (qb) =>
          qb
            .where('p.created_at', '>=', (window as { startUtc: Date }).startUtc)
            .where('p.created_at', '<', (window as { endUtc: Date }).endUtc),
        )
        // ADR-033 SUM fan-out — void'lenmiş ödeme gün-sonu saatlik ciroya SAYILMAZ.
        .where('p.voided_at', 'is', null)
        .groupBy('hr')
        .execute(),
    ]);

  // ─── 1. Revenue / orderCount / avgBill ──────────────────────────────────
  const totalRevenueCents = Number(revenueRow.total);
  const orderCount = Number(revenueRow.order_count);
  const avgBillCents =
    orderCount === 0 ? 0 : Math.floor(totalRevenueCents / orderCount);

  // ─── 2. Payment breakdown + sharePct ────────────────────────────────────
  const paymentTotal = paymentRows.reduce((s, r) => s + Number(r.total), 0);
  const paymentBreakdown = paymentRows.map((r) => {
    const amount = Number(r.total);
    const sharePct =
      paymentTotal === 0 ? 0 : Math.round((amount * 1000) / paymentTotal) / 10;
    return {
      paymentType: r.payment_type,
      count: Number(r.cnt),
      amountCents: amount,
      sharePct,
    };
  });

  // ─── 3. Top categories (top 5, only categories with revenue > 0) ────────
  const topCategories = categoryRows
    .filter((r) => Number(r.revenue_cents) > 0)
    .map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      qty: Number(r.qty),
      revenueCents: Number(r.revenue_cents),
    }));

  // ─── 4. Anomaly summary (cancel-only) ───────────────────────────────────
  const anomalySummary = {
    cancelCount: Number(anomalyRow.cancel_count),
    voidCount: 0,
    compCount: 0,
    totalLossCents: Number(anomalyRow.total_loss),
  };

  // ─── 5. Hourly buckets (24 entry, hour 0-23) ────────────────────────────
  const hourMap = new Map<
    number,
    { revenueCents: number; orderCount: number }
  >();
  for (const r of hourlyRows) {
    hourMap.set(Number(r.hr), {
      revenueCents: Number(r.rev),
      orderCount: Number(r.cnt),
    });
  }
  const hourlyBuckets = Array.from({ length: 24 }, (_, hour) => {
    const v = hourMap.get(hour);
    return {
      hour,
      revenueCents: v?.revenueCents ?? 0,
      orderCount: v?.orderCount ?? 0,
    };
  });

  return {
    totalRevenueCents,
    orderCount,
    avgBillCents,
    paymentBreakdown,
    topCategories,
    anomalySummary,
    hourlyBuckets,
  };
}
