import type { ReactNode } from 'react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { KpiCard } from '../dashboard/components/KpiCard';
import { SectionCard } from '../dashboard/components/SectionCard';
import { HourlyRevenueChart } from '../dashboard/components/HourlyRevenueChart';
import { PaymentDistributionPanel } from '../dashboard/components/PaymentDistributionPanel';
import { TopSellingPanel } from '../dashboard/components/TopSellingPanel';
import { formatTryFromCents } from '../dashboard/lib/format';
import { cn } from '../../lib/utils';
import {
  useAverageBill,
  useOrderCount,
  useTodayRevenue,
} from '../dashboard/api/reports';
import { useAnomalies } from './api';
import { CategorySalesPanel } from './components/CategorySalesPanel';
import { UserPerformancePanel } from './components/UserPerformancePanel';
import { AnomaliesDetailPanel } from './components/AnomaliesDetailPanel';
import { CsvDownloadButton } from './components/CsvDownloadButton';
import { SnapshotButton } from './components/SnapshotButton';
import { DailyCloseButton } from './components/DailyCloseButton';
import { todayStamp } from './lib/downloadCsv';

/** Fallback string shown when a KPI query has no data yet. */
const VALUE_FALLBACK = '—';

/** Shown while a query is pending — animate-pulse on the tile communicates loading. */
const LOADING_PLACEHOLDER = '…';

interface KpiTileProps {
  label: string;
  value: string;
  icon: ReactNode;
  iconGradient: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  className?: string;
  tooltip?: string;
}

/**
 * Wrapper around `KpiCard` adding loading/error/tooltip affordances:
 *   - `isLoading`: tile gets `animate-pulse`, value is replaced with "…".
 *   - `isError`: tile dims and an inline Türkçe retry button appears below.
 *   - `tooltip`: Radix Tooltip primitive (PR-7) — touch-friendly long-press
 *     replaces the native `title` attribute (which never fired on tablets).
 */
function KpiTile({
  label,
  value,
  icon,
  iconGradient,
  isLoading,
  isError,
  onRetry,
  className,
  tooltip,
}: KpiTileProps): JSX.Element {
  const { t } = useTranslation();
  const displayValue = isLoading ? LOADING_PLACEHOLDER : value;
  const card = (
    <KpiCard
      label={label}
      value={displayValue}
      icon={icon}
      iconGradient={iconGradient}
      className={cn(isLoading && 'animate-pulse', isError && 'opacity-60')}
    />
  );
  const cardSlot = tooltip ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-stone-500"
          >
            {card}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    card
  );
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {cardSlot}
      {isError ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center self-start rounded px-3 py-2 text-xs font-medium text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          {t('reports.kpi.error.retry')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * `/raporlar` page — Sprint 14 PR-5b1 (initial) + PR-5b2a (HCI fixes).
 *
 * Four KPI tiles bound to today's data (backend endpoints accept no range
 * param yet; RangeFilter returns once backend supports `?range=...`).
 *
 * PR-5b2a additions (HCI feedback from PR-5b1 review):
 *   1. Loading: tiles render `animate-pulse` + placeholder "…" while pending.
 *   2. Error: dimmed tile + inline "Tekrar Dene" button (refetch).
 *   3. Hierarchy: revenue tile spans 2 cols on lg with an emerald ring.
 *   4. Tooltip: cancel-count tile carries a `title` explaining the scope
 *      (void/comp items land in PR-5c).
 */
export default function ReportsPage(): JSX.Element {
  const { t } = useTranslation();

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

  return (
    <AppShell>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        icon={BarChart3}
        actions={
          <>
            <SnapshotButton />
            <DailyCloseButton />
          </>
        }
      />

      <div className="flex-1 space-y-6 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiTile
            label={t('reports.kpi.todayRevenue')}
            value={revenueValue}
            icon={<TrendingUp className="h-6 w-6" />}
            iconGradient="from-emerald-500 to-emerald-700"
            isLoading={todayRevenue.isPending}
            isError={todayRevenue.isError}
            onRetry={() => void todayRevenue.refetch()}
            className="sm:col-span-2 lg:col-span-2"
          />
          <KpiTile
            label={t('reports.kpi.orderCount')}
            value={orderCountValue}
            icon={<ShoppingCart className="h-6 w-6" />}
            iconGradient="from-blue-500 to-blue-700"
            isLoading={orderCount.isPending}
            isError={orderCount.isError}
            onRetry={() => void orderCount.refetch()}
          />
          <KpiTile
            label={t('reports.kpi.averageBill')}
            value={averageBillValue}
            icon={<Receipt className="h-6 w-6" />}
            iconGradient="from-amber-500 to-amber-700"
            isLoading={averageBill.isPending}
            isError={averageBill.isError}
            onRetry={() => void averageBill.refetch()}
          />
          <KpiTile
            label={t('reports.kpi.cancelCount')}
            value={cancelCountValue}
            icon={<AlertTriangle className="h-6 w-6" />}
            iconGradient="from-red-500 to-red-700"
            isLoading={anomalies.isPending}
            isError={anomalies.isError}
            onRetry={() => void anomalies.refetch()}
            tooltip={t('reports.kpi.cancelCountInfo')}
          />
        </div>

        <SectionCard
          title={t('dashboard.panels.hourlyRevenue')}
          rightSlot={
            <CsvDownloadButton
              endpoint="/reports/hourly-revenue"
              filename={`saatlik-ciro-${todayStamp()}.csv`}
            />
          }
        >
          <HourlyRevenueChart />
        </SectionCard>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard
            title={t('dashboard.panels.paymentDistribution')}
            rightSlot={
              <CsvDownloadButton
                endpoint="/reports/payment-distribution"
                filename={`odeme-dagilimi-${todayStamp()}.csv`}
              />
            }
          >
            <PaymentDistributionPanel />
          </SectionCard>
          <SectionCard
            title={t('dashboard.panels.topSelling')}
            rightSlot={
              <CsvDownloadButton
                endpoint="/reports/top-selling"
                filename={`en-cok-satan-${todayStamp()}.csv`}
              />
            }
          >
            <TopSellingPanel />
          </SectionCard>
        </div>

        {/* Detail panels (PR-5c) — category sales + user performance side by
            side, anomaly feed full-width below since rows can carry long
            reason text. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard
            title={t('reports.tables.categorySales.title')}
            rightSlot={
              <CsvDownloadButton
                endpoint="/reports/category-sales"
                filename={`kategori-satislari-${todayStamp()}.csv`}
              />
            }
          >
            <CategorySalesPanel />
          </SectionCard>
          <SectionCard
            title={t('reports.tables.userPerformance.title')}
            rightSlot={
              <CsvDownloadButton
                endpoint="/reports/user-performance"
                filename={`kullanici-performansi-${todayStamp()}.csv`}
              />
            }
          >
            <UserPerformancePanel />
          </SectionCard>
        </div>

        <SectionCard
          title={t('reports.tables.anomalies.title')}
          rightSlot={
            <CsvDownloadButton
              endpoint="/reports/anomalies"
              filename={`iptal-duzeltmeler-${todayStamp()}.csv`}
            />
          }
        >
          <AnomaliesDetailPanel />
        </SectionCard>
      </div>
    </AppShell>
  );
}
