import { useTranslation } from 'react-i18next';
import type { TableRow } from '@restoran-pos/shared-types';
import { TableStatusDot } from './TableStatusDot';
import { cn } from '../../../lib/utils';

interface TableCardProps {
  table: TableRow;
  onClick: () => void;
}

/**
 * Masa kartı — v3 paritesi (1:1 tasarım sadakati).
 *
 * v3 layout (görsel 1):
 * - Kompakt kart ~140px
 * - Sol üst "Masa N" — text-2xl bold koyu siyah
 * - Sağ üst köşe küçük status dot (sade, pulse yok)
 * - Pure beyaz arka plan (occupied'da bile)
 * - İnce stone-200 border, rounded-xl
 * - Shadow yok
 *
 * Sade hover: cursor pointer, subtle border darkening (kasiyer feedback).
 * Click feedback: hafif scale, animation override yok.
 */
export function TableCard({ table, onClick }: TableCardProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${table.label} — ${t(`tables.status.${table.status}`)}`}
      className={cn(
        'group relative flex h-[140px] w-full items-start justify-start rounded-xl border border-stone-200 bg-white p-5 text-left transition-colors duration-150',
        'hover:border-stone-300',
        'active:scale-[0.99]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 focus-visible:ring-offset-2',
      )}
    >
      <span className="absolute right-4 top-4">
        <TableStatusDot status={table.status} size="sm" />
      </span>
      <span className="text-2xl font-bold tracking-tight text-foreground">
        {table.label}
      </span>
    </button>
  );
}
