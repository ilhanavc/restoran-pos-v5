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
 * + modern revamp (glassmorphism, warm amber palette, soft shadows).
 *
 * MVP scope: tüm operasyonel widget'lar Phase 3'e bağımlı (sipariş + ödeme).
 * Bu sürümde widget'lar yapısal olarak tam ama içleri "Faz 3'te aktifleşir"
 * placeholder. Phase 3 sonu data binding eklenir, layout değişmez.
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const displayName = user?.fullName ?? user?.email ?? '';

  // Şu an: gerçek veri yok. Phase 3'te canlı feed.
  const lastUpdated = new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  const handleRefresh = (): void => {
    // Phase 3'te `queryClient.invalidateQueries(['dashboard'])` ile selective
    // refetch yapılacak. MVP'de canlı sorgu yok — full-page reload pragmatik
    // çözüm (auth bootstrap session'ı korur, sadece UI tazelenir).
    window.location.reload();
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Page header — v3'teki "Anasayfa + bağlantı + Yenile" satırı */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t('dashboard.title')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('dashboard.welcome', { name: displayName })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"
              aria-live="polite"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {t('dashboard.connection.online')}
            </span>
            <Button
              variant="outline"
              onClick={handleRefresh}
              className="h-11 gap-2"
              aria-label={t('dashboard.refresh')}
            >
              <RefreshCw className="h-4 w-4" />
              {t('dashboard.refresh')}
            </Button>
          </div>
        </header>

        {/* KPI cards — 3 across desktop, 1 stacked mobile */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <KpiCard
            label={t('dashboard.kpi.todayRevenue')}
            value="₺0,00"
            icon={<Banknote className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-amber-500 to-orange-600"
            phaseLocked
          />
          <KpiCard
            label={t('dashboard.kpi.totalOrders')}
            value="0"
            icon={<ShoppingBag className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-orange-500 to-rose-600"
            phaseLocked
          />
          <KpiCard
            label={t('dashboard.kpi.averageBill')}
            value="₺0,00"
            icon={<Receipt className="h-5 w-5" strokeWidth={2.25} />}
            iconGradient="from-rose-500 to-pink-600"
            phaseLocked
          />
        </div>

        {/* Saatlik ciro — geniş chart */}
        <SectionCard
          title={t('dashboard.panels.hourlyRevenue')}
          description={t('dashboard.panels.hourlyRevenueRange')}
        >
          <HourlyRevenueSkeleton />
        </SectionCard>

        {/* Alt grid — 2 sütun: Ödeme Dağılımı + En Çok Satan */}
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

        {/* Alt grid — Son Siparişler + Kapanan Siparişler */}
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

        {/* Footer info — son güncelleme */}
        <p className="text-center text-xs text-muted-foreground">
          {t('dashboard.lastUpdated', { time: lastUpdated })}
        </p>
      </div>
    </AppShell>
  );
}
