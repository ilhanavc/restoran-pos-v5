import { useTranslation } from 'react-i18next';
import type { ApiTable } from '../api';
import { cn } from '../../../lib/utils';

interface TableCardProps {
  table: ApiTable;
  displayName: string;
  onClick: () => void;
}

/**
 * Masa kartı — v3 TablesScreen.jsx 1:1 verbatim port (light theme).
 *
 * v3 inline-style spec (boş masa varsayılanı):
 *   background: var(--bg-card) = #FFFFFF
 *   border: 1.5px solid var(--border) = #D9E2F0
 *   border-radius: 12px (--radius-md)
 *   padding: 22px
 *   height: 180px
 *   box-shadow: var(--shadow-soft) = 0 10px 30px rgba(17,35,63,.08)
 *   transition: border-color, background, opacity, box-shadow
 *
 * Title:
 *   font-size: 24px, font-weight: 800, letter-spacing: -0.02em
 *   line-height: 1.15, color: var(--text-primary) = #11233F
 *
 * Dot (sağ üst, başlık satırının sağında):
 *   width: 8, height: 8, border-radius: 50%, background: status color
 *
 * Hover (v3 onMouseEnter): opacity 0.85.
 */
const STATUS_DOT: Record<ApiTable['status'], string> = {
  available: 'var(--v3-success)',  // #1F9D68
  occupied: 'var(--v3-warning)',   // #D48806
  reserved: 'var(--v3-purple)',    // #7C5CFA
  cleaning: 'var(--v3-text-muted)',// #6C7A92
};

export function TableCard({ table, displayName, onClick }: TableCardProps) {
  const { t } = useTranslation();
  const dotColor = STATUS_DOT[table.status];

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`table-card-${table.id}`}
      data-table-status={table.status}
      aria-label={`${displayName} — ${t(`tables.status.${table.status}`)}`}
      className={cn(
        'group relative flex h-[180px] w-full flex-col items-stretch overflow-hidden p-[22px] text-left',
        'transition-all duration-150',
        'hover:opacity-85',
        'active:scale-[0.99]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 focus-visible:ring-offset-2',
      )}
      style={{
        background: 'var(--v3-surface-1)',
        border: '1.5px solid var(--v3-border-subtle)',
        borderRadius: 'var(--v3-radius-md)',
        boxShadow: 'var(--v3-shadow-soft)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="min-w-0 truncate"
          style={{
            fontSize: '24px',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            color: 'var(--v3-text-primary)',
          }}
        >
          {displayName}
        </span>
        <span
          aria-hidden="true"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
            marginTop: '8px',
          }}
        />
      </div>
    </button>
  );
}
