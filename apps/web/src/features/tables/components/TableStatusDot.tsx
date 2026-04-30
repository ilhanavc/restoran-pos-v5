import { useTranslation } from 'react-i18next';
import type { TableStatus } from '@restoran-pos/shared-types';
import { cn } from '../../../lib/utils';

interface TableStatusDotProps {
  status: TableStatus;
  /** Görsel boyut */
  size?: 'sm' | 'md';
  /** Pulse animation (occupied için dikkat çekici) */
  pulse?: boolean;
}

const STATUS_COLORS: Record<TableStatus, string> = {
  available: 'bg-emerald-500',
  occupied: 'bg-rose-500',
  reserved: 'bg-blue-500',
  cleaning: 'bg-amber-500',
};

export function TableStatusDot({ status, size = 'md', pulse }: TableStatusDotProps) {
  const { t } = useTranslation();
  // v3 paritesi: küçük sade dot (~7px), pulse animasyon opsiyonel.
  const dimension = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  const label = t(`tables.status.${status}`);
  return (
    <span
      className="relative inline-flex shrink-0 items-center"
      role="status"
      aria-label={label}
    >
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-50',
            STATUS_COLORS[status],
          )}
        />
      )}
      <span
        className={cn('relative inline-flex rounded-full', dimension, STATUS_COLORS[status])}
      />
    </span>
  );
}
