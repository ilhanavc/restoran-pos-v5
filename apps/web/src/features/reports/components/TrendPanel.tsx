import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ReportRangeQuery,
  TrendDimension,
  TrendPaymentMixPoint,
} from '@restoran-pos/shared-types';
import { formatTryCompact, formatTryFromCents } from '../../dashboard/lib/format';
import { cn } from '../../../lib/utils';
import { useTrendDaily, useTrendPaymentMix, useTrendProductMix } from '../api';
import { formatDayLong, formatDayShort } from '../lib/formatDay';

/**
 * ADR-015 Amendment 8 K14 — Trend paneli (`ReportsPage` içinde).
 *
 * **Kendi 7/30 gün anahtarını taşır** — sayfanın `RangeFilter`'ına BAĞLI DEĞİL:
 * trend `range=today` için anlamsızdır (tek çubuk). Varsayılan `last7`.
 *
 * Üç blok, üç ayrı endpoint (K2) tek pencere durumunu paylaşır:
 *   1. Ciro trendi        → /reports/trend/daily
 *   2. Ödeme dağılımı     → /reports/trend/payment-mix (gün-gün yığılmış)
 *   3. Kategori/ürün mixi → /reports/trend/product-mix (pencere geneli Top-N)
 *
 * Tüm metinler `reports.trend.*` i18n key'leri üzerinden — hardcoded string yok.
 */

/** Panelin sunduğu tek pencere seçeneği kümesi (K14: yalnız 7/30). */
export const TREND_RANGES = ['last7', 'last30'] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

const DIMENSIONS: readonly TrendDimension[] = ['category', 'product'];

/** Ödeme türü → bar segmenti rengi. Sıra kontratla sabit (cash, card, transfer). */
const PAYMENT_COLORS: Record<string, string> = {
  cash: 'bg-emerald-500',
  card: 'bg-blue-500',
  transfer: 'bg-violet-500',
};

interface TrendPanelProps {
  /**
   * Panelin KENDİ pencere durumu — `ReportsPage`'de tutulur ki CSV butonu
   * ekranda görünenin aynısını indirsin (sayfa `RangeFilter`'ı ile karışmaz).
   */
  value: TrendRange;
  onChange: (range: TrendRange) => void;
}

export function TrendPanel({ value: range, onChange }: TrendPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [dimension, setDimension] = useState<TrendDimension>('category');

  const rangeQuery: ReportRangeQuery = { range };
  const daily = useTrendDaily(rangeQuery);
  const paymentMix = useTrendPaymentMix(rangeQuery);
  const productMix = useTrendProductMix(dimension, rangeQuery);

  return (
    <div className="space-y-6">
      {/*
        Pencere anahtarı — sayfanın RangeFilter'ından bağımsız (K14).
        HCI: sayfa filtresi nötr slate/stone; panel-içi dönem anahtarı indigo
        accent + görünür etiket taşır ki yönetici iki kontrolü karıştırmasın.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-indigo-700">
          {t('reports.trend.rangeHint')}
        </span>
        <div
          role="group"
          aria-label={t('reports.trend.rangeLabel')}
          className="flex flex-wrap items-center gap-2"
        >
          {TREND_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onChange(r)}
              aria-pressed={range === r}
              className={cn(
                'min-h-[44px] rounded-lg px-4 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                range === r
                  ? 'bg-indigo-600 text-white'
                  : 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100',
              )}
            >
              {t(`reports.trend.range.${r}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ── 1) Ciro trendi ────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          {t('reports.trend.revenue.title')}
        </h3>
        {daily.isPending ? (
          <PanelSkeleton />
        ) : daily.isError || !daily.data ? (
          <PanelError message={t('reports.trend.errors.loadFailed')} />
        ) : (
          <>
            <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <SummaryStat
                label={t('reports.trend.summary.totalRevenue')}
                value={formatTryFromCents(daily.data.totalRevenueCents)}
              />
              <SummaryStat
                label={t('reports.trend.summary.orderCount')}
                value={String(daily.data.totalOrderCount)}
              />
              <SummaryStat
                label={t('reports.trend.summary.dailyAverage')}
                value={formatTryFromCents(
                  daily.data.points.length === 0
                    ? 0
                    : Math.floor(
                        daily.data.totalRevenueCents / daily.data.points.length,
                      ),
                )}
              />
            </dl>
            {daily.data.totalRevenueCents === 0 ? (
              <PanelEmpty message={t('reports.trend.revenue.empty')} />
            ) : (
              <DailyBars
                points={daily.data.points}
                ordersLabel={(n) => t('reports.trend.tooltip.orders', { count: n })}
              />
            )}
          </>
        )}
      </section>

      {/* ── 2) Ödeme dağılımı (gün-gün yığılmış) ──────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          {t('reports.trend.payment.title')}
        </h3>
        {paymentMix.isPending ? (
          <PanelSkeleton />
        ) : paymentMix.isError || !paymentMix.data ? (
          <PanelError message={t('reports.trend.errors.loadFailed')} />
        ) : paymentMix.data.totalCents === 0 ? (
          <PanelEmpty message={t('reports.trend.payment.empty')} />
        ) : (
          <>
            <StackedPaymentBars points={paymentMix.data.points} />
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {(paymentMix.data.points[0]?.paymentTypes ?? []).map((b) => (
                <li
                  key={b.paymentType}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-2.5 w-2.5 rounded-sm',
                      PAYMENT_COLORS[b.paymentType] ?? 'bg-stone-400',
                    )}
                  />
                  {t(`reports.trend.paymentType.${b.paymentType}`)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── 3) Kategori / ürün kırılımı ───────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t('reports.trend.mix.title')}
          </h3>
          <div
            role="group"
            aria-label={t('reports.trend.mix.dimensionLabel')}
            className="flex gap-2"
          >
            {DIMENSIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDimension(d)}
                aria-pressed={dimension === d}
                className={cn(
                  'min-h-[44px] rounded-lg px-3 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500',
                  dimension === d
                    ? 'bg-stone-800 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
                )}
              >
                {t(`reports.trend.mix.dimension.${d}`)}
              </button>
            ))}
          </div>
        </div>
        {productMix.isPending ? (
          <PanelSkeleton />
        ) : productMix.isError || !productMix.data ? (
          <PanelError message={t('reports.trend.errors.loadFailed')} />
        ) : productMix.data.entities.length === 0 ? (
          <PanelEmpty message={t('reports.trend.mix.empty')} />
        ) : (
          <>
            <ul className="space-y-2">
              {productMix.data.entities.map((e) => (
                <li
                  key={e.entityId ?? 'other'}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-stone-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {e.entityId === null ? t('reports.trend.mix.other') : e.entityName}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {t('reports.trend.mix.qty', { count: e.qty })}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatTryFromCents(e.revenueCents)}
                  </span>
                </li>
              ))}
            </ul>
            {/* K7 dürüstlük notu: kalem toplamı adisyon cirosuna eşit olmayabilir. */}
            <p className="mt-3 text-xs text-muted-foreground">
              {t('reports.trend.mix.note')}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

interface DailyBarsProps {
  points: readonly {
    date: string;
    revenueCents: number;
    orderCount: number;
    averageBillCents: number;
  }[];
  ordersLabel: (count: number) => string;
}

/** Gün-gün ciro çubukları — saf CSS (HourlyRevenueChart deseni, grafik dep'i yok). */
function DailyBars({ points, ordersLabel }: DailyBarsProps): JSX.Element {
  const max = Math.max(...points.map((p) => p.revenueCents), 1);
  // 30 günde her günün etiketi sığmaz; ~7 etiket kalacak şekilde seyrelt.
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div>
      <div className="relative h-[200px] pl-12 pr-2">
        <div className="absolute inset-y-0 left-0 w-12 pt-1">
          {[100, 50].map((pct) => (
            <div
              key={pct}
              className="absolute right-2 -translate-y-1/2 text-[10px] font-medium text-stone-400"
              style={{ top: `${100 - pct}%` }}
            >
              {formatTryCompact(Math.round((max * pct) / 100))}
            </div>
          ))}
        </div>
        <div className="relative h-full rounded-lg bg-gradient-to-b from-stone-50 to-white ring-1 ring-stone-100">
          <div className="absolute inset-x-3 bottom-1 top-1 flex items-end justify-between gap-1">
            {points.map((p) => {
              const filled = p.revenueCents > 0;
              return (
                <div
                  key={p.date}
                  className="group relative flex h-full w-full flex-col justify-end"
                >
                  <div className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-stone-900 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block">
                    <span className="block font-bold">
                      {formatTryFromCents(p.revenueCents)}
                    </span>
                    <span className="block text-[9px] text-stone-300">
                      {formatDayLong(p.date)} · {ordersLabel(p.orderCount)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'w-full origin-bottom rounded-t-md transition-all duration-300',
                      filled
                        ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 group-hover:from-emerald-500 group-hover:to-emerald-300'
                        : 'bg-stone-200',
                    )}
                    style={{
                      height: filled ? `${(p.revenueCents / max) * 100}%` : '2px',
                      minHeight: filled ? '4px' : '2px',
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div className="absolute inset-x-0 bottom-0 h-px bg-stone-300" />
        </div>
      </div>
      <div className="mt-2 flex justify-between pl-12 pr-2 text-[10px] font-medium text-stone-400">
        {points
          .filter((_, i) => i % labelEvery === 0)
          .map((p) => (
            <span key={p.date}>{formatDayShort(p.date)}</span>
          ))}
      </div>
    </div>
  );
}

/** Gün-gün yığılmış ödeme türü çubukları. */
function StackedPaymentBars({
  points,
}: {
  points: readonly TrendPaymentMixPoint[];
}): JSX.Element {
  const max = Math.max(...points.map((p) => p.totalCents), 1);
  return (
    <div className="flex h-[140px] items-end justify-between gap-1 rounded-lg bg-stone-50 p-2 ring-1 ring-stone-100">
      {points.map((p) => (
        <div
          key={p.date}
          className="group relative flex h-full w-full flex-col justify-end"
          title={`${formatDayLong(p.date)} — ${formatTryFromCents(p.totalCents)}`}
        >
          <div
            className="flex w-full flex-col-reverse overflow-hidden rounded-t-md"
            style={{ height: `${(p.totalCents / max) * 100}%` }}
          >
            {p.paymentTypes.map((b) => (
              <div
                key={b.paymentType}
                className={cn('w-full', PAYMENT_COLORS[b.paymentType] ?? 'bg-stone-400')}
                style={{
                  height:
                    p.totalCents === 0
                      ? '0'
                      : `${(b.totalCents / p.totalCents) * 100}%`,
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function PanelSkeleton(): JSX.Element {
  return <div className="h-32 animate-pulse rounded-lg bg-stone-100/60" />;
}

function PanelError({ message }: { message: string }): JSX.Element {
  return <p className="py-6 text-center text-sm text-muted-foreground">{message}</p>;
}

function PanelEmpty({ message }: { message: string }): JSX.Element {
  return <p className="py-6 text-center text-sm text-muted-foreground">{message}</p>;
}
