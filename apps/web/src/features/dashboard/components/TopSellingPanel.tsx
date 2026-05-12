import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { useTopSelling } from '../api/reports';
import { formatTryFromCents } from '../lib/format';

interface TopSellingPanelProps {
  range?: ReportRangeQuery;
}

export function TopSellingPanel({ range }: TopSellingPanelProps = {}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useTopSelling(5, range);

  if (isLoading) {
    return <div className="h-32 animate-pulse rounded-lg bg-stone-100/60" />;
  }
  if (isError || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('dashboard.errors.loadFailed')}
      </p>
    );
  }
  if (data.items.length === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <TrendingUp className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">{t('dashboard.empty.noSalesToday')}</p>
      </div>
    );
  }

  return (
    <ol className="space-y-2">
      {data.items.map((it, i) => (
        <li
          key={`${it.productId}-${i}`}
          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-stone-50"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">
              {i + 1}
            </span>
            <span className="truncate text-sm font-medium text-foreground">
              {it.productNameSnapshot}
            </span>
          </span>
          <span className="flex shrink-0 items-baseline gap-3 text-sm tabular-nums">
            <span className="text-muted-foreground">×{it.totalQuantity}</span>
            <span className="font-semibold text-foreground">
              {formatTryFromCents(it.totalRevenueCents)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
