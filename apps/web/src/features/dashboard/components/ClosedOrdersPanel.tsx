import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { useClosedOrders } from '../api/reports';
import { formatTryFromCents, formatTimeHm } from '../lib/format';

export function ClosedOrdersPanel() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useClosedOrders(5);

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
  if (data.orders.length === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('dashboard.empty.noClosedOrdersToday')}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {data.orders.map((o) => (
        <li
          key={o.orderId}
          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-stone-50"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-8 min-w-[2.5rem] items-center justify-center rounded-md bg-emerald-100 px-2 text-xs font-bold text-emerald-800">
              {o.tableCode ?? t('dashboard.takeaway')}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">
                {formatTimeHm(o.paidAt)}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {o.paymentTypeMix
                  .map((p) => t(`dashboard.paymentType.${p}`))
                  .join(' + ')}
              </span>
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatTryFromCents(o.totalCents)}
          </span>
        </li>
      ))}
      {data.totalClosedCount > data.orders.length && (
        <li className="px-2 pt-1 text-[11px] text-muted-foreground">
          {t('dashboard.moreClosedCount', {
            count: data.totalClosedCount - data.orders.length,
          })}
        </li>
      )}
    </ul>
  );
}
