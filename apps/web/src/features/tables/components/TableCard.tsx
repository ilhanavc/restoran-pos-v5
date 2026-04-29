import { useTranslation } from 'react-i18next';
import type { ApiTable } from '../api';
import { cn } from '../../../lib/utils';

interface TableCardProps {
  table: ApiTable;
  /** Görünen ad — `masaLabelInArea` benzeri client-side hesaplanır. */
  displayName: string;
  onClick: () => void;
}

/**
 * Masa kartı — v3 1:1 paritesi (TablesScreen.jsx port).
 *
 * v3 spec:
 * - height 180px sabit, padding 22px
 * - bg + border status'a göre (success-muted/warning-muted/purple-muted)
 * - title fontSize 24 fontWeight 800 letterSpacing -0.02em
 * - sağ üst 8px round status dot
 * - shadow soft, hover'da opacity 0.85
 *
 * Phase 3+ içerik (occupied'da order_total + waiter + elapsed) Phase 3
 * sonu eklenir; şu an sadece title + dot (boş masa görünümü).
 */
const STATUS_STYLE: Record<string, { bg: string; border: string; dot: string }> = {
  available: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
  },
  occupied: {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    dot: 'bg-amber-500',
  },
  reserved: {
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    dot: 'bg-violet-500',
  },
  cleaning: {
    bg: 'bg-stone-50',
    border: 'border-stone-300',
    dot: 'bg-stone-400',
  },
};

export function TableCard({ table, displayName, onClick }: TableCardProps) {
  const { t } = useTranslation();
  const style = STATUS_STYLE[table.status] ?? STATUS_STYLE.available!;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`table-card-${table.id}`}
      data-table-status={table.status}
      aria-label={`${displayName} — ${t(`tables.status.${table.status}`)}`}
      className={cn(
        'group relative flex h-[180px] flex-col items-stretch overflow-hidden rounded-lg border-[1.5px] p-[22px] text-left',
        'shadow-sm transition-[border-color,opacity,box-shadow] duration-150',
        'hover:opacity-85 hover:shadow-md',
        'active:scale-[0.99]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 focus-visible:ring-offset-2',
        style.bg,
        style.border,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-2xl font-extrabold leading-tight tracking-tight text-foreground">
          {displayName}
        </span>
        <span
          className={cn('mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full', style.dot)}
          aria-hidden="true"
        />
      </div>
    </button>
  );
}
