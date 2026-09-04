import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Banknote,
  ShoppingBag,
  Receipt,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/button';
import { useAuthStore } from '../../store/auth';
import { KpiCard } from './components/KpiCard';
import { SectionCard } from './components/SectionCard';
import { HourlyRevenueChart } from './components/HourlyRevenueChart';
import { PaymentDistributionPanel } from './components/PaymentDistributionPanel';
import { TopSellingPanel } from './components/TopSellingPanel';
import { RecentOrdersPanel } from './components/RecentOrdersPanel';
import { ClosedOrdersPanel } from './components/ClosedOrdersPanel';
import {
  useTodayRevenue,
  useAverageBill,
  useRefreshReports,
} from './api/reports';
import { formatTryFromCents } from './lib/format';
import { openTabTotalCents } from '@restoran-pos/shared-domain';
import { useTables } from '../tables/api';

/**
 * ADR-015 — Anasayfa rapor widget'ları gerçek API bağlı.
 * 8 endpoint: 3 KPI + 5 panel. Polling 60s; Yenile butonu invalidateQueries.
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const displayName = user?.fullName ?? user?.email ?? '';

  const todayRevenue = useTodayRevenue();
  // S105 — "Açık hesap" KPI'sı masa projeksiyonundan beslenir (ek endpoint
  // gerekmez). Aynı query key masalar ekranıyla paylaşılır; ödeme/void
  // emit'leri (payments route) onu zaten invalidate ediyor.
  const tables = useTables();
  const averageBill = useAverageBill();
  const refresh = useRefreshReports();

  const lastUpdated = new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  const revenueValue = todayRevenue.isLoading
    ? '…'
    : todayRevenue.data
      ? formatTryFromCents(todayRevenue.data.totalRevenueCents)
      : '—';
  /**
   * S105 (ürün sahibi) — "Toplam Sipariş" kartının YERİNE **Açık hesap**:
   * o an masalarda TAHSİL EDİLECEK toplam. Gün sonu ciro raporları yalnız
   * `paid` siparişleri toplar; bu gösterge onların kör noktasını kapatır
   * ("şu an ne kadar para masada duruyor?").
   *
   * Brüt değil KALAN toplanır (`openTabTotalCents`, shared-domain): kısmi
   * ödeme adisyon toplamını düşürmediği için brüt gösterilse çekmecedeki
   * nakitle çift sayılırdı. Paket siparişler bu göstergeye GİRMEZ — masa
   * projeksiyonundan okunur; kapsam etikette açıkça yazılıdır.
   */
  const openTabValue = tables.isLoading
    ? '…'
    : tables.data
      ? formatTryFromCents(openTabTotalCents(tables.data))
      : '—';
  const avgValue = averageBill.isLoading
    ? '…'
    : averageBill.data && averageBill.data.sampleSize > 0
      ? formatTryFromCents(averageBill.data.averageBillCents)
      : '—';

  return (
    <AppShell>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.welcome', { name: displayName })}
        actions={
          <Button
            variant="outline"
            onClick={refresh}
            aria-label={t('dashboard.refresh')}
            className="h-10 w-10 p-0 sm:h-10 sm:w-auto sm:gap-2 sm:px-4"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">{t('dashboard.refresh')}</span>
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <KpiCard
            label={t('dashboard.kpi.todayRevenue')}
            value={revenueValue}
            icon={<Banknote className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-amber-400 to-orange-500"
          />
          <KpiCard
            label={t('dashboard.kpi.openTab')}
            value={openTabValue}
            icon={<ShoppingBag className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-orange-400 to-amber-500"
          />
          <KpiCard
            label={t('dashboard.kpi.averageBill')}
            value={avgValue}
            icon={<Receipt className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-orange-400 to-rose-400"
          />
        </div>

        <SectionCard
          title={t('dashboard.panels.hourlyRevenue')}
          description={t('dashboard.panels.hourlyRevenueRange')}
        >
          <HourlyRevenueChart />
        </SectionCard>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard title={t('dashboard.panels.paymentDistribution')}>
            <PaymentDistributionPanel />
          </SectionCard>
          <SectionCard title={t('dashboard.panels.topSelling')}>
            <TopSellingPanel />
          </SectionCard>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard title={t('dashboard.panels.recentOrders')}>
            <RecentOrdersPanel />
          </SectionCard>
          <SectionCard
            title={t('dashboard.panels.closedOrders')}
            rightSlot={
              // ADR-015 Amd10 — panel yalnız son 5'i gösterir; tam liste + tarih
              // aralığı + sayfalama /kapanan-siparisler'de.
              <Link
                to="/kapanan-siparisler"
                className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-orange-700 hover:bg-orange-50"
              >
                {t('dashboard.panels.viewAll')}
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <ClosedOrdersPanel />
          </SectionCard>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {t('dashboard.lastUpdated', { time: lastUpdated })}
        </p>
        </div>
      </div>
    </AppShell>
  );
}
