import { useTranslation } from 'react-i18next';
import { CreditCard } from 'lucide-react';
import type { ReportRangeQuery } from '@restoran-pos/shared-types';
import { usePaymentDistribution, type PaymentType } from '../api/reports';
import { formatTryFromCents } from '../lib/format';

const TYPE_COLORS: Record<PaymentType, string> = {
  cash: 'bg-emerald-500',
  card: 'bg-amber-500',
  transfer: 'bg-sky-500',
};

interface PaymentDistributionPanelProps {
  range?: ReportRangeQuery;
}

/**
 * Ödeme tipi dağılımı — basit horizontal stacked bar + legend.
 * Pasta grafik yerine bar (mobile-friendly + lib bağımlı değil).
 */
export function PaymentDistributionPanel({ range }: PaymentDistributionPanelProps = {}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = usePaymentDistribution(range);

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
  if (data.segments.length === 0 || data.totalCents === 0) {
    return (
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <CreditCard className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('dashboard.empty.noPaymentToday')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-100">
        {data.segments.map((s) => (
          <div
            key={s.paymentType}
            className={TYPE_COLORS[s.paymentType]}
            style={{ width: `${s.sharePct}%` }}
            title={`${t(`dashboard.paymentType.${s.paymentType}`)} — ${s.sharePct.toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="space-y-2">
        {data.segments.map((s) => (
          <li key={s.paymentType} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${TYPE_COLORS[s.paymentType]}`} />
              <span className="font-medium text-foreground">
                {t(`dashboard.paymentType.${s.paymentType}`)}
              </span>
              <span className="text-xs text-muted-foreground">({s.count})</span>
            </span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="text-foreground">{formatTryFromCents(s.totalCents)}</span>
              <span className="text-xs text-muted-foreground">{s.sharePct.toFixed(1)}%</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-stone-200/60 pt-3 text-sm font-semibold">
        <span>{t('dashboard.total')}</span>
        <span className="tabular-nums">{formatTryFromCents(data.totalCents)}</span>
      </div>
    </div>
  );
}
