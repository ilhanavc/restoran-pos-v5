import { useTranslation } from 'react-i18next';
import type { TableRow } from '@restoran-pos/shared-types';
import { TableStatusDot } from './TableStatusDot';
import { cn } from '../../../lib/utils';

interface TableCardProps {
  table: TableRow;
  onClick: () => void;
}

/**
 * Masa kartı — v3 paritesi.
 *
 * v3 layout:
 * - Geniş ferah kart (min-h-[180px])
 * - Sol üstte cesur büyük "Masa N" başlık
 * - Sağ üstte küçük status nokta (yeşil/kırmızı/sarı)
 * - Sade beyaz, ince border, soft shadow
 * - Kapasite/garson bilgisi YOK (v3'te yok)
 *
 * Modern revamp:
 * - Hover: hafif elevation + subtle border highlight
 * - Active (occupied): rose-50 wash + ince rose border
 * - Click animasyonu: subtle scale-[0.99]
 * - 44px+ touch (Fitts: rush-hour kasiyer)
 *
 * NOT: Masa CRUD (yeni/düzenle/sil) bu sayfada DEĞİL — Tanımlamalar
 * sayfasında olacak (gelecek sprint). Sprint 8b'de salt görünüm + click.
 */
export function TableCard({ table, onClick }: TableCardProps) {
  const { t } = useTranslation();
  const occupied = table.status === 'occupied';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${table.label} — ${t(`tables.status.${table.status}`)}`}
      className={cn(
        'group relative flex min-h-[180px] w-full flex-col items-start justify-start rounded-2xl border bg-white p-6 text-left transition-all duration-150',
        'shadow-[0_1px_3px_rgba(0,0,0,0.04)]',
        'hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.12)]',
        'active:translate-y-0 active:scale-[0.99]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 focus-visible:ring-offset-2',
        occupied
          ? 'border-rose-200/80 bg-rose-50/30'
          : 'border-stone-200/80',
      )}
    >
      <span className="absolute right-4 top-4">
        <TableStatusDot status={table.status} pulse={occupied} />
      </span>
      <span className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {table.label}
      </span>
    </button>
  );
}
