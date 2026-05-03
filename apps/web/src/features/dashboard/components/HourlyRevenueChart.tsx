import { useTranslation } from 'react-i18next';
import { useHourlyRevenue } from '../api/reports';
import { formatTryFromCents, formatTryCompact } from '../lib/format';
import { HourlyRevenueSkeleton } from './HourlyRevenueSkeleton';

/**
 * 24-saatlik bar chart — pure CSS (recharts vb. dep yok).
 * Her bar: relative height = revenueCents / max * 100%.
 * Tooltip: native `title` (HCI checklist v3 paritesi yeterli).
 */
export function HourlyRevenueChart() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useHourlyRevenue();

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

  return (
    <div>
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">
        {formatTryCompact(max)}
      </p>
      <div className="relative h-[200px] rounded-lg bg-stone-50/60">
        <div className="absolute inset-0 flex flex-col justify-between p-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-t border-stone-200/40" />
          ))}
        </div>
        <div className="absolute inset-x-3 bottom-0 flex items-end justify-between gap-1 pb-2">
          {data.buckets.map((b) => {
            const heightPct = (b.revenueCents / max) * 100;
            return (
              <div
                key={b.hour}
                className="flex w-full max-w-[14px] flex-col items-center"
                title={`${String(b.hour).padStart(2, '0')}:00 — ${formatTryFromCents(b.revenueCents)} (${b.orderCount} sipariş)`}
              >
                <div
                  className="w-full rounded-t bg-gradient-to-t from-amber-500 to-orange-400"
                  style={{ height: `${Math.max(heightPct, 2)}%`, minHeight: '2px' }}
                />
              </div>
            );
          })}
        </div>
        <div className="absolute inset-x-0 bottom-1.5 h-px bg-stone-300/60" />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        {[0, 4, 8, 12, 16, 20, 23].map((h) => (
          <span key={h}>{String(h).padStart(2, '0')}:00</span>
        ))}
      </div>
    </div>
  );
}
