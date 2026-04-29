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
  // Tüm kartlar PURE BEYAZ — sadece dot rengi değişir (kullanıcı tercihi:
  // sarımsı/turuncumsu doluluk wash beğenilmedi). v3 5-renkli skala
  // Phase 3 sonu (orders + payments) yeniden değerlendirilir.
  available: {
    bg: 'bg-white',
    border: 'border-stone-200',
    dot: 'bg-emerald-500',
  },
  occupied: {
    bg: 'bg-white',
    border: 'border-stone-200',
    dot: 'bg-amber-500',
  },
  reserved: {
    bg: 'bg-white',
    border: 'border-stone-200',
    dot: 'bg-violet-500',
  },
  cleaning: {
    bg: 'bg-white',
    border: 'border-stone-200',
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
        // v3: height 180, padding 22, border 1.5px, radius-md 12px
        'group relative flex h-[180px] flex-col items-stretch overflow-hidden rounded-xl border-[1.5px] p-[22px] text-left',
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
