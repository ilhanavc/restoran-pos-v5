import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Clock, MoreVertical } from 'lucide-react';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { ApiTable } from '../api';
import { cn } from '../../../lib/utils';

interface TableCardProps {
  table: ApiTable;
  displayName: string;
  onClick: () => void;
  /** ADR-014 §3 + §9 Karar 9.6 — dolu masa kart sağ üst 3-nokta menüsü.
   *  Verilmezse 3-nokta render edilmez (boş masa). */
  onActionsClick?: () => void;
  /** ADR-009 Amendment 2026-06-30 Karar C — bölgesiz (orphan) masa. true ise
   *  kart kesikli kenarlık + "Bölgesiz" rozeti ile işaretlenir; tıklanınca
   *  adisyon ekranı yerine reassign/sil modali açılır (davranış farkı görünür). */
  isOrphan?: boolean;
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

export function TableCard({ table, displayName, onClick, onActionsClick, isOrphan = false }: TableCardProps) {
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
  const elapsedLabel = elapsedMs !== null ? formatElapsed(elapsedMs, t) : null;
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
          ? 'var(--v3-danger-soft, rgba(214, 69, 69, 0.14))'
          : isOccupied
            ? 'var(--v3-warning-soft, rgba(212, 136, 6, 0.14))'
            : 'var(--v3-surface-1)',
        // Orphan (bölgesiz): kesikli uyarı kenarlığı — davranış farkını (reassign
        // modali) görsel olarak ayrıştırır; durum kenarlıklarını ezer.
        border: isOrphan
          ? '1.5px dashed var(--v3-warning, #D48806)'
          : isLongOccupied
            ? '1.5px solid var(--v3-danger, #D64545)'
            : isOccupied
              ? '1.5px solid var(--v3-warning, #D48806)'
              : '1.5px solid var(--v3-border-subtle)',
        borderRadius: 'var(--v3-radius-md)',
        boxShadow: 'var(--v3-shadow-soft)',
      }}
    >
      {/* Orphan rozeti — sol alt köşe, kesikli kenarlıkla birlikte bölgesiz
          masayı ayrıştırır (ADR-009 Amendment Karar C). */}
      {isOrphan && (
        <span
          className="absolute bottom-3 left-3 inline-flex items-center rounded-full px-2 py-0.5"
          style={{
            background: 'var(--v3-warning-soft, rgba(212, 136, 6, 0.14))',
            color: 'var(--v3-warning, #D48806)',
            fontSize: '11px',
            fontWeight: 700,
          }}
        >
          {t('tables.group.unassigned')}
        </span>
      )}

      {/* Başlık + sağ üst dot + (dolu) 3-nokta */}
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
        <div className="flex items-center gap-2 shrink-0">
          <span
            aria-hidden="true"
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isLongOccupied ? '#dc2626' : dotColor,
              marginTop: '8px',
            }}
          />
          {/* 3-nokta menü buraya DEĞİL, kartın sağ altına konumlanır — S104:
              44px'lik dokunma hedefi başlık satırından 60px çalıyordu ve DOLU
              masalarda iki haneli her ad kırpılıyordu ("Masa 20" → "Masa ...").
              Ürün sahibi canlıda bildirdi; ölçüm: ada kalan 85px, "Masa 20"
              98px ister. Masa adı kartın birincil kimliğidir, kırpılamaz. */}
          {onActionsClick !== undefined && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('tables.actions.openMenu')}
              data-testid={`table-card-actions-${table.id}`}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onActionsClick();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  onActionsClick();
                }
              }}
              className="absolute bottom-2 right-2 z-10 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
              style={{
                background: 'rgba(255, 255, 255, 0.7)',
                color: 'var(--v3-text-secondary)',
              }}
            >
              <MoreVertical size={16} />
            </span>
          )}
        </div>
      </div>

      {/* Dolu masa detayı (occupied only) — v3 ekran 4 paritesi */}
      {isOccupied && (
        // pr-12: sağ alttaki 3-nokta butonunun (44px) altına metin girmesin —
        // uzun tutarlarda ("₺1.250,00") üst üste binerdi (S104).
        <div className="mt-auto flex flex-col gap-1 pt-2 pr-12">
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
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
              }}
            >
              {formatMoney(table.active_order_total_cents)}
              {/* v3 paritesi (TablesScreen.jsx:819-825): order_paid_total > 0
                   ise yeşil slash + ödenen tutar inline */}
              {table.active_order_paid_total_cents !== null &&
                table.active_order_paid_total_cents > 0 && (
                  <span
                    style={{
                      color: 'var(--v3-success, #1F9D68)',
                      fontSize: '18px',
                      fontWeight: 800,
                    }}
                  >
                    /{formatMoney(table.active_order_paid_total_cents)}
                  </span>
                )}
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
function formatElapsed(ms: number, t: TFunction): string {
  if (ms < 0) return t('common.duration.zero');
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const totalHour = Math.floor(totalMin / 60);
  const hour = totalHour % 24;
  const day = Math.floor(totalHour / 24);

  if (day > 0) return t('common.duration.days', { d: day, h: hour, m: min, s: sec });
  if (totalHour > 0) return t('common.duration.hours', { h: totalHour, m: min, s: sec });
  return t('common.duration.minutes', { m: totalMin, s: sec });
}
