import { useTranslation } from 'react-i18next';
import { Coffee, ListOrdered, Users, Settings } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { Card, CardContent } from '../../components/ui/card';
import { useAuthStore } from '../../store/auth';

interface NavCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  comingSoonLabel: string;
}

function NavCard({ icon, title, description, comingSoonLabel }: NavCardProps) {
  // Sprint 8a placeholder — gerçek navigation Sprint 8b/c/d'de eklenecek.
  // Klavye akışından çıkar (tabIndex=-1) — disabled placeholder odaklanmamalı.
  return (
    <Card
      className="opacity-60 cursor-not-allowed"
      aria-disabled="true"
      role="group"
      tabIndex={-1}
    >
      <CardContent className="p-6 flex flex-col gap-3">
        <div className="text-primary">{icon}</div>
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <span className="text-xs uppercase tracking-wide text-muted-foreground mt-2">
          {comingSoonLabel}
        </span>
      </CardContent>
    </Card>
  );
}

/**
 * Sprint 8a placeholder dashboard.
 * Real navigation (Tables, Menu, Users, Settings) is wired in Sprints 8b–8d.
 */
export default function DashboardPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const displayName = user?.fullName ?? user?.email ?? '';

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">
            {t('dashboard.welcome', { name: displayName })}
          </h1>
          <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <NavCard
            icon={<Coffee className="h-6 w-6" />}
            title={t('dashboard.navTables')}
            description={t('dashboard.navTablesDesc')}
            comingSoonLabel={t('dashboard.comingSoon')}
          />
          <NavCard
            icon={<ListOrdered className="h-6 w-6" />}
            title={t('dashboard.navMenu')}
            description={t('dashboard.navMenuDesc')}
            comingSoonLabel={t('dashboard.comingSoon')}
          />
          <NavCard
            icon={<Users className="h-6 w-6" />}
            title={t('dashboard.navUsers')}
            description={t('dashboard.navUsersDesc')}
            comingSoonLabel={t('dashboard.comingSoon')}
          />
          <NavCard
            icon={<Settings className="h-6 w-6" />}
            title={t('dashboard.navSettings')}
            description={t('dashboard.navSettingsDesc')}
            comingSoonLabel={t('dashboard.comingSoon')}
          />
        </div>
      </div>
    </AppShell>
  );
}
