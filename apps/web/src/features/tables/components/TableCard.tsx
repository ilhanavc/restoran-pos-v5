import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import type { TableRow } from '@restoran-pos/shared-types';
import { TableStatusDot } from './TableStatusDot';
import { cn } from '../../../lib/utils';

interface TableCardProps {
  table: TableRow;
  /** Admin görüntüsünde Düzenle/Sil menüsü görünür. */
  isAdmin: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Masa kartı — v3 layout, modern revamp.
 * Tıklayınca onClick (kasiyer için adisyon — Phase 3'te aktif).
 * Admin için sağ üst ⋯ menü → Düzenle / Sil.
 */
export function TableCard({ table, isAdmin, onClick, onEdit, onDelete }: TableCardProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const occupied = table.status === 'occupied';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group relative flex h-32 w-full items-start justify-between rounded-2xl border bg-white p-5 text-left shadow-sm transition-all',
          'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40',
          occupied ? 'border-rose-200/80' : 'border-stone-200/80',
        )}
        aria-label={`${table.label} — ${t(`tables.status.${table.status}`)}`}
      >
        <div className="flex flex-col gap-1.5">
          <span className="text-xl font-bold tracking-tight text-foreground">{table.label}</span>
          {table.capacity !== null && (
            <span className="text-xs text-muted-foreground">
              {table.capacity} kişilik
            </span>
          )}
        </div>
        <TableStatusDot status={table.status} pulse={occupied} />
      </button>

      {/* Admin context menu */}
      {isAdmin && (
        <div ref={menuRef} className="absolute right-2 top-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            aria-label="Menü"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-white shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onEdit();
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent"
              >
                <Pencil className="h-4 w-4" />
                {t('tables.actions.edit')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                {t('tables.actions.delete')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
