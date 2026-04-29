import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';

interface KpiCardProps {
  label: string;
  value: string;
  icon: ReactNode;
  /** Tailwind class — hex/HSL gradient `from-X to-Y` (örn. 'from-amber-500 to-orange-600') */
  iconGradient: string;
  /** "Faz 3'te aktifleşir" rozeti göster */
  phaseLocked?: boolean;
  className?: string;
}

/**
 * Operasyonel KPI kartı (Bugün Ciro / Toplam Sipariş / Ortalama Hesap).
 * v3 layout + modern revamp: glassmorphism, gradient icon, soft shadow.
 * MVP'de veri yok — Phase 3 (orders + payments) sonrası canlanır.
 */
export function KpiCard({ label, value, icon, iconGradient, phaseLocked, className }: KpiCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/60 bg-white/80 p-6 shadow-[0_8px_30px_-12px_rgba(180,83,9,0.15)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-12px_rgba(180,83,9,0.25)]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
        </div>
        <div
          className={cn(
            'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-md',
            iconGradient,
          )}
        >
          <div className="text-white">{icon}</div>
        </div>
      </div>

      {phaseLocked && (
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-100/80 px-2.5 py-1 text-[11px] font-medium text-amber-800">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          {t('dashboard.phase3Badge')}
        </div>
      )}
    </div>
  );
}
