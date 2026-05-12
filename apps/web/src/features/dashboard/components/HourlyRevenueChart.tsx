import { useTranslation } from 'react-i18next';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { useHourlyRevenue } from '../api/reports';
import { formatTryFromCents, formatTryCompact } from '../lib/format';
import { HourlyRevenueSkeleton } from './HourlyRevenueSkeleton';

interface HourlyRevenueChartProps {
  /** Optional range. Default `undefined` → backend returns today (Dashboard default). */
  range?: ReportRangeQuery;
}

/**
 * 24-saatlik bar chart — pure CSS (recharts vb. dep yok).
 * Her bar: relative height = revenueCents / max * 100%.
 * Hover: değer + saat tooltip'i bar üstünde (group-hover).
 *
 * `range` prop'u opsiyonel — Dashboard'da kullanılırken parametresiz çağrılır
 * (default "today"), ReportsPage'de RangeFilter'dan gelen range geçer.
 */
export function HourlyRevenueChart({ range }: HourlyRevenueChartProps = {}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useHourlyRevenue(range);

  if (isLoading) return <HourlyRevenueSkeleton />;
  if (isError || !data) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t('dashboard.errors.loadFailed')}
      </p>
    );
  }

  const max = Math.max(...data.buckets.map((b) => b.revenueCents), 1);
  const allZero = data.buckets.every((b) => b.revenueCents === 0);

  if (allZero) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t('dashboard.empty.noRevenueToday')}
      </p>
    );
  }

  const yLabels = [
    { pct: 100, value: max },
    { pct: 75, value: Math.round(max * 0.75) },
    { pct: 50, value: Math.round(max * 0.5) },
    { pct: 25, value: Math.round(max * 0.25) },
  ];

  return (
    <div>
      <div className="relative h-[240px] pl-12 pr-2">
        <div className="absolute inset-y-0 left-0 w-12 pt-1">
          {yLabels.map((y) => (
            <div
              key={y.pct}
              className="absolute right-2 -translate-y-1/2 text-[10px] font-medium text-stone-400"
              style={{ top: `${100 - y.pct}%` }}
            >
              {formatTryCompact(y.value)}
            </div>
          ))}
        </div>

        <div className="relative h-full rounded-lg bg-gradient-to-b from-stone-50 to-white ring-1 ring-stone-100">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-t border-dashed border-stone-200" />
            ))}
          </div>

          <div className="absolute inset-x-3 bottom-1 top-1 flex items-end justify-between gap-1.5">
            {data.buckets.map((b) => {
              const heightPct = (b.revenueCents / max) * 100;
              const filled = b.revenueCents > 0;
              return (
                <div
                  key={b.hour}
                  className="group relative flex h-full w-full max-w-[22px] flex-col justify-end"
                >
                  {filled && (
                    <div className="pointer-events-none absolute -top-9 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-stone-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                      <div className="font-bold">{formatTryFromCents(b.revenueCents)}</div>
                      <div className="text-[9px] text-stone-300">
                        {String(b.hour).padStart(2, '0')}:00 · {b.orderCount} sipariş
                      </div>
                    </div>
                  )}
                  <div
                    className={`w-full origin-bottom rounded-t-md transition-all duration-300 ease-out ${
                      filled
                        ? 'bg-gradient-to-t from-amber-600 via-orange-500 to-orange-400 shadow-[0_2px_8px_-2px_rgba(251,146,60,0.5)] group-hover:from-amber-500 group-hover:via-orange-400 group-hover:to-orange-300 group-hover:shadow-[0_4px_12px_-2px_rgba(251,146,60,0.7)]'
                        : ''
                    }`}
                    style={{
                      height: filled ? `${heightPct}%` : '0',
                      minHeight: filled ? '4px' : '0',
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
        {[0, 4, 8, 12, 16, 20, 23].map((h) => (
          <span key={h}>{String(h).padStart(2, '0')}:00</span>
        ))}
      </div>
    </div>
  );
}
