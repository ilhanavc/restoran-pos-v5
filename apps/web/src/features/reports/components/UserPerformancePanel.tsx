import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { useUserPerformance } from '../api';
import { formatTryFromCents } from '../../dashboard/lib/format';

interface UserPerformancePanelProps {
  range?: ReportRangeQuery;
}

/**
 * Per-user (cashier/waiter) revenue contribution + average bill.
 * Same list affordance as `CategorySalesPanel`. The role label is i18n-keyed
 * so a future "kitchen" role doesn't fall through as English.
 */
export function UserPerformancePanel({ range }: UserPerformancePanelProps = {}): JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError } = useUserPerformance(range);

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
  if (data.users.length === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Users className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('reports.tables.userPerformance.empty')}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {data.users.map((u) => (
        <li
          key={u.userId}
          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-stone-50"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="truncate">{u.name}</span>
              <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-stone-600">
                {t(`reports.tables.userPerformance.role.${u.role}`)}
              </span>
            </span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {u.orderCount} {t('reports.tables.userPerformance.orderCountShort')} ·{' '}
              {t('reports.tables.userPerformance.avgShort')}{' '}
              {formatTryFromCents(u.avgBillCents)}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatTryFromCents(u.revenueCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}
