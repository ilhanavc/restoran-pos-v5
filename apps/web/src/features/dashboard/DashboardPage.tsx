import { useTranslation } from 'react-i18next';
import {
  Banknote,
  ShoppingBag,
  Receipt,
  CreditCard,
  TrendingUp,
  Clock,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import { useAuthStore } from '../../store/auth';
import { KpiCard } from './components/KpiCard';
import { SectionCard } from './components/SectionCard';
import { PhaseLockedEmpty } from './components/PhaseLockedEmpty';
import { HourlyRevenueSkeleton } from './components/HourlyRevenueSkeleton';

/**
 * Anasayfa — v3 dashboard layout (KPI cards + saatlik ciro chart + 4 alt panel)
 * + modern revamp (glassmorphism, warm amber palette).
 *
 * Tüm operasyonel widget'lar Phase 3'e bağımlı (sipariş + ödeme).
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const displayName = user?.fullName ?? user?.email ?? '';

  const lastUpdated = new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  const handleRefresh = (): void => {
    window.location.reload();
  };

  return (
    <AppShell>
      {/* v3 page-header: tek satır, border yok. Hamburger AppShell fixed.
          Sol pl-[74px] = 12 (toggle left) + 42 (toggle w) + 12 (gap). */}
      <div className="pl-[74px] pr-4 py-3 sm:pr-6">
        <div className="flex items-center gap-4">
          <div className="flex flex-1 items-center gap-3 min-w-0">
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                {t('dashboard.title')}
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                {t('dashboard.welcome', { name: displayName })}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleRefresh}
            aria-label={t('dashboard.refresh')}
            className="h-10 w-10 p-0 sm:h-10 sm:w-auto sm:gap-2 sm:px-4"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">{t('dashboard.refresh')}</span>
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <KpiCard
            label={t('dashboard.kpi.todayRevenue')}
            value="₺0,00"
            icon={<Banknote className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-amber-400 to-orange-500"
            phaseLocked
          />
          <KpiCard
            label={t('dashboard.kpi.totalOrders')}
            value="0"
            icon={<ShoppingBag className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-orange-400 to-amber-500"
            phaseLocked
          />
          <KpiCard
            label={t('dashboard.kpi.averageBill')}
            value="₺0,00"
            icon={<Receipt className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-orange-400 to-rose-400"
            phaseLocked
          />
        </div>

        <SectionCard
          title={t('dashboard.panels.hourlyRevenue')}
          description={t('dashboard.panels.hourlyRevenueRange')}
        >
          <HourlyRevenueSkeleton />
        </SectionCard>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard title={t('dashboard.panels.paymentDistribution')}>
            <PhaseLockedEmpty
              icon={<CreditCard className="h-5 w-5" />}
              message={t('dashboard.empty.noPaymentToday')}
            />
          </SectionCard>
          <SectionCard title={t('dashboard.panels.topSelling')}>
            <PhaseLockedEmpty
              icon={<TrendingUp className="h-5 w-5" />}
              message={t('dashboard.empty.noSalesToday')}
            />
          </SectionCard>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard title={t('dashboard.panels.recentOrders')}>
            <PhaseLockedEmpty
              icon={<Clock className="h-5 w-5" />}
              message={t('dashboard.empty.noOrdersYet')}
            />
          </SectionCard>
          <SectionCard
            title={t('dashboard.panels.closedOrders')}
            rightSlot={
              <Button variant="ghost" size="sm" disabled>
                {t('dashboard.panels.viewAll')}
              </Button>
            }
          >
            <PhaseLockedEmpty
              icon={<CheckCircle2 className="h-5 w-5" />}
              message={t('dashboard.empty.noClosedOrdersToday')}
            />
          </SectionCard>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {t('dashboard.lastUpdated', { time: lastUpdated })}
        </p>
      </div>
    </AppShell>
  );
}
