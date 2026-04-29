import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface PhaseLockedEmptyProps {
  /** İkon override (lucide). Yoksa Construction. */
  icon?: ReactNode;
  /** Empty state için override mesaj (tarih bağımlı: "Bugün ödeme kaydı yok"). */
  message?: string;
  className?: string;
}

/**
 * "Faz 3'te aktifleşir" placeholder. Görsel olarak v3'teki "Bugün ödeme yok"
 * benzeri empty state, ama sebep "Faz 3 modülü tamamlanınca" diye dürüstçe
 * açıklanır.
 */
export function PhaseLockedEmpty({ icon, message, className }: PhaseLockedEmptyProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex min-h-[180px] flex-col items-center justify-center gap-3 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        {icon ?? <Construction className="h-5 w-5" />}
      </div>
      <p className="text-sm font-medium text-foreground">
        {message ?? t('dashboard.empty.phaseLockedTitle')}
      </p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {t('dashboard.empty.phaseLockedBody')}
      </p>
    </div>
  );
}
