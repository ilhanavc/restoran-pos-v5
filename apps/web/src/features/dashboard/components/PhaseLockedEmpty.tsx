import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface PhaseLockedEmptyProps {
  icon?: ReactNode;
  message?: string;
  className?: string;
}

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
