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
 * Masa kartı — v3 1:1 paritesi (TablesScreen.jsx render port).
 *
 * v3 bg/border mantığı (TABLE_STATUS + 5 renkli doluluk skalası):
 * - available (boş): bg-white, border default soft gri, yeşil dot
 * - occupied normal (0-60dk): bg-amber-50, border-amber-500, sarı dot
 * - occupied + ready/paid: bg-emerald-50, border-emerald-500, yeşil dot
 * - occupied + 60+dk uzun süre: bg-red-50, border-red-500, kırmızı dot
 * - reserved: bg-white, border-violet-300/40 alpha, mor dot
 *
 * Phase 3+ (orders + payments hazır olunca):
 * - `order_total`, `waiter_name`, `elapsed time` card içine eklenir
 * - "HESAP ÖDENDİ" / "HAZIR" rozeti title yanına
 *
 * v3 spec sabit: height 180px, padding 22px, 1.5px border, soft shadow,
 * radius-md, hover opacity-85.
 */
const STATUS_STYLE: Record<
  ApiTable['status'],
  { bg: string; border: string; dot: string }
> = {
  // Boş masa — pure beyaz (v3 default --bg-card light tema)
  available: {
    bg: 'bg-white',
    border: 'border-stone-200',
    dot: 'bg-emerald-500',
  },
  // Dolu masa normal — amber-50 wash
  occupied: {
    bg: 'bg-amber-50',
    border: 'border-amber-400',
    dot: 'bg-amber-500',
  },
  // Rezerve — beyaz + soft violet border
  reserved: {
    bg: 'bg-white',
    border: 'border-violet-300',
    dot: 'bg-violet-500',
  },
  // Temizleniyor — beyaz + stone border
  cleaning: {
    bg: 'bg-white',
    border: 'border-stone-300',
    dot: 'bg-stone-400',
  },
};

export function TableCard({ table, displayName, onClick }: TableCardProps) {
  const { t } = useTranslation();
  const style = STATUS_STYLE[table.status];

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
          className={cn(
            'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
            style.dot,
          )}
          aria-hidden="true"
        />
      </div>
    </button>
  );
}
