import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { ApiTable } from '../api';
import { cn } from '../../../lib/utils';

interface TableCardProps {
  table: ApiTable;
  displayName: string;
  onClick: () => void;
}

/**
 * Masa kartı — v3 `TablesScreen.jsx` paritesi.
 *
 * 2 mod:
 *   - **available (boş):** beyaz bg, sade başlık + sağ üst yeşil dot
 *   - **occupied (dolu):** sarı tonlu bg, başlık + waiter_name +
 *     order_total + süre (created_at → "X dk Y sn") + sağ üst sarı dot
 *
 * Süre frontend hesabı (v3 `formatOrderElapsed` paritesi); 1sn'lik tick
 * useEffect'te interval ile.
 *
 * v3 ekran 4 referansı: "Masa 4 / İlhan Avcı / ₺2.340,00 / 37 dk 17 sn"
 */
const STATUS_DOT: Record<ApiTable['status'], string> = {
  available: 'var(--v3-success, #1F9D68)',
  occupied: 'var(--v3-warning, #D48806)',
  reserved: 'var(--v3-purple, #7C5CFA)',
  cleaning: 'var(--v3-text-muted, #6C7A92)',
};

export function TableCard({ table, displayName, onClick }: TableCardProps) {
  const { t } = useTranslation();
  const isOccupied = table.status === 'occupied';
  const dotColor = STATUS_DOT[table.status];
  // Dot ayrı state — long-occupied'da danger override.
  // (isLongOccupied aşağıda hesaplanıyor; effekt için aşağıda override edilecek.)

  // Dolu masa süre tick'i — saniyede bir güncelle.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isOccupied || table.active_order_started_at === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isOccupied, table.active_order_started_at]);

  const elapsedMs =
    isOccupied && table.active_order_started_at !== null
      ? now - new Date(table.active_order_started_at).getTime()
      : null;
  const elapsedLabel = elapsedMs !== null ? formatElapsed(elapsedMs) : null;
  // V3 paritesi: 60+ dakika açık masa = "uzun süre" → danger (kırmızı) renk.
  const isLongOccupied =
    elapsedMs !== null && elapsedMs > 60 * 60 * 1000;

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
        'hover:opacity-85 active:scale-[0.99]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 focus-visible:ring-offset-2',
      )}
      style={{
        // v3 paritesi (5-durum renk skalası):
        //   long-occupied (>60dk): danger (kırmızı muted bg + border)
        //   occupied: warning (açık krem bg + amber border)
        //   available: surface-1 + ince border
        background: isLongOccupied
          ? 'rgba(220, 38, 38, 0.10)'
          : isOccupied
            ? 'rgba(228, 167, 41, 0.16)'
            : 'var(--v3-surface-1)',
        border: isLongOccupied
          ? '1.5px solid rgba(220, 38, 38, 0.45)'
          : isOccupied
            ? '1.5px solid rgba(228, 167, 41, 0.55)'
            : '1.5px solid var(--v3-border-subtle)',
        borderRadius: 'var(--v3-radius-md)',
        boxShadow: 'var(--v3-shadow-soft)',
      }}
    >
      {/* Başlık + sağ üst dot */}
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
            background: isLongOccupied ? '#dc2626' : dotColor,
            flexShrink: 0,
            marginTop: '8px',
          }}
        />
      </div>

      {/* Dolu masa detayı (occupied only) — v3 ekran 4 paritesi */}
      {isOccupied && (
        <div className="mt-auto flex flex-col gap-1 pt-2">
          {table.active_waiter_name !== null && (
            <span
              className="truncate"
              style={{
                fontSize: '11px',
                color: 'var(--v3-text-muted)',
              }}
            >
              {table.active_waiter_name}
            </span>
          )}
          {table.active_order_total_cents !== null && (
            <span
              className="tabular-nums"
              style={{
                fontSize: '22px',
                fontWeight: 800,
                color: 'var(--v3-text-primary)',
                lineHeight: 1.1,
              }}
            >
              {formatMoney(table.active_order_total_cents)}
            </span>
          )}
          {elapsedLabel !== null && (
            <span
              className="inline-flex items-center gap-1 tabular-nums"
              style={{
                fontSize: '10px',
                color: 'var(--v3-text-muted)',
              }}
            >
              <Clock size={10} strokeWidth={2} />
              {elapsedLabel}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

/**
 * Süre formatı — v3 `formatOrderElapsed` paritesi.
 * < 1 saat   → "X dk Y sn"
 * 1-24 saat  → "X sa Y dk Z sn"
 * 24+ saat   → "X gün Y sa Z dk W sn"
 */
function formatElapsed(ms: number): string {
  if (ms < 0) return '0 dk 0 sn';
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const totalHour = Math.floor(totalMin / 60);
  const hour = totalHour % 24;
  const day = Math.floor(totalHour / 24);

  if (day > 0) return `${day} gün ${hour} sa ${min} dk ${sec} sn`;
  if (totalHour > 0) return `${totalHour} sa ${min} dk ${sec} sn`;
  return `${totalMin} dk ${sec} sn`;
}
