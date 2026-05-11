import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  BarChart3,
  Receipt,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import RangeFilter, {
  type RangeValue,
} from '../../components/reports/RangeFilter';
import { KpiCard } from '../dashboard/components/KpiCard';
import { formatTryFromCents } from '../dashboard/lib/format';
import {
  useAverageBill,
  useOrderCount,
  useTodayRevenue,
} from '../dashboard/api/reports';
import { useAnomalies } from './api';

/** Fallback string shown when a KPI query is pending or in error. */
const VALUE_FALLBACK = '—';

/**
 * `/raporlar` page — Sprint 14 PR-5b1 (4 KPI tiles).
 *
 * Backend ready (13 endpoints, ADR-015 + ADR-021). This PR wires four
 * KPI tiles on the reports page:
 *   1. Today revenue (cents → TRY).
 *   2. Total order count.
 *   3. Average bill (cents → TRY).
 *   4. Anomaly cancel count (loss / void & comp = 0 in MVP).
 *
 * Loading and error states render a "—" placeholder with reduced opacity;
 * each query is independent so a single failure does not block the others.
 *
 * RangeFilter is still preset-only UI; backend `range` wiring lands in
 * PR-5b2. Guarded upstream by ProtectedRoute (`admin`, `cashier`).
 */
export default function ReportsPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeValue>({ preset: 'today' });

  const todayRevenue = useTodayRevenue();
  const orderCount = useOrderCount();
  const averageBill = useAverageBill();
  const anomalies = useAnomalies();

  const revenueValue = todayRevenue.data
    ? formatTryFromCents(todayRevenue.data.totalRevenueCents)
    : VALUE_FALLBACK;
  const orderCountValue = orderCount.data
    ? String(orderCount.data.totalOrders)
    : VALUE_FALLBACK;
  const averageBillValue = averageBill.data
    ? formatTryFromCents(averageBill.data.averageBillCents)
    : VALUE_FALLBACK;
  const cancelCountValue = anomalies.data
    ? String(anomalies.data.summary.cancelCount)
    : VALUE_FALLBACK;

  const DIMMED = 'opacity-60';

  return (
    <AppShell>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        icon={BarChart3}
      />

      <div className="flex-1 space-y-6 overflow-auto p-6">
        <RangeFilter value={range} onChange={setRange} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label={t('reports.kpi.todayRevenue')}
            value={revenueValue}
            icon={<TrendingUp className="h-6 w-6" />}
            iconGradient="from-emerald-500 to-emerald-700"
            {...(todayRevenue.isError ? { className: DIMMED } : {})}
          />
          <KpiCard
            label={t('reports.kpi.orderCount')}
            value={orderCountValue}
            icon={<ShoppingCart className="h-6 w-6" />}
            iconGradient="from-blue-500 to-blue-700"
            {...(orderCount.isError ? { className: DIMMED } : {})}
          />
          <KpiCard
            label={t('reports.kpi.averageBill')}
            value={averageBillValue}
            icon={<Receipt className="h-6 w-6" />}
            iconGradient="from-amber-500 to-amber-700"
            {...(averageBill.isError ? { className: DIMMED } : {})}
          />
          <KpiCard
            label={t('reports.kpi.cancelCount')}
            value={cancelCountValue}
            icon={<AlertTriangle className="h-6 w-6" />}
            iconGradient="from-red-500 to-red-700"
            {...(anomalies.isError ? { className: DIMMED } : {})}
          />
        </div>
      </div>
    </AppShell>
  );
}
