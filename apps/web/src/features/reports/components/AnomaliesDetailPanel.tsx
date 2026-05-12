import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { useAnomalies } from '../api';
import { formatTryFromCents, formatTimeHm } from '../../dashboard/lib/format';

interface AnomaliesDetailPanelProps {
  range?: ReportRangeQuery;
}

/**
 * Detailed anomaly feed (cancel/void/comp) for the current window.
 * The KPI tile above already surfaces the cancel count; this panel adds the
 * per-row context (who/when/why) so the manager can spot patterns. We reuse
 * the cancel-count query (`useAnomalies`) — `data.details` is the new field.
 */
export function AnomaliesDetailPanel({ range }: AnomaliesDetailPanelProps = {}): JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError } = useAnomalies(range);

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
  if (data.details.length === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('reports.tables.anomalies.empty')}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {data.details.map((d, idx) => (
        <li
          key={`${d.orderId}-${d.type}-${idx}`}
          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-stone-50"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-red-700">
                {t(`reports.tables.anomalies.type.${d.type}`)}
              </span>
              <span className="tabular-nums">{formatTryFromCents(d.amountCents)}</span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {formatTimeHm(d.occurredAt)}
              {d.reason ? ` · ${d.reason}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
