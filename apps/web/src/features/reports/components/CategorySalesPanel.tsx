import { useTranslation } from 'react-i18next';
import { Tag } from 'lucide-react';
import { useCategorySales } from '../api';
import { formatTryFromCents } from '../../dashboard/lib/format';

/**
 * Per-category revenue + qty share. Mirrors the dashboard list panel pattern
 * (loading skeleton / muted error / empty illustration / hover row). Share is
 * already 0-100 from the backend; we render it with a single decimal so totals
 * remain legible on tablet widths.
 */
export function CategorySalesPanel(): JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError } = useCategorySales();

  if (isPending) {
    return <div className="h-32 animate-pulse rounded-lg bg-stone-100/60" />;
  }
  if (isError || !data) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('reports.tables.errors.loadFailed')}
      </p>
    );
  }
  if (data.categories.length === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Tag className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('reports.tables.categorySales.empty')}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {data.categories.map((c) => (
        <li
          key={c.categoryId}
          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-stone-50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">{c.categoryName}</span>
            <span className="block text-[11px] text-muted-foreground tabular-nums">
              {c.qty} {t('reports.tables.categorySales.qtyShort')} · {c.sharePct.toFixed(1)}%
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatTryFromCents(c.revenueCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}
