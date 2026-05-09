import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Package,
  Utensils,
  Clock,
  AlertCircle,
  Flame,
  Check,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import type { KdsOrder, KdsItem } from './api';

interface KdsOrderCardProps {
  order: KdsOrder;
  onItemStatusChange: (
    orderId: string,
    itemId: string,
    next: 'preparing' | 'ready',
  ) => void;
  /** Bekleyen PATCH'ler — per-item disable; HCI feedback: global isPending
   *  tüm butonları aynı anda disable etmesin. */
  pendingItemIds: ReadonlySet<string>;
}

/**
 * KDS sipariş kartı — Sprint 12 PR-3 (ADR-020 K3 + K6).
 *
 * State coloring (K6, dakika eşikleri):
 *   - 0-5: nötr (default border)
 *   - 5-10: warning (turuncu)
 *   - >10:  danger (kırmızı)
 *
 * Buton görünürlüğü (K3 state machine):
 *   - sent       → [Hazırlanıyor] + [Hazır]   (skip preparing izinli)
 *   - preparing  → [Hazır]
 *   - ready      → buton yok (KDS view'da terminal)
 *
 * Erişilebilirlik:
 *   - Buton metni + ikon (renk-bağımsız status okunur)
 *   - h-16 (64px) Fitts compliance
 */
export function KdsOrderCard({
  order,
  onItemStatusChange,
  pendingItemIds,
}: KdsOrderCardProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  // Live mm:ss timer — 1sn granül. Saniye hassasiyet yaş eşik geçişlerini
  // (5dk → warning, 10dk → danger) gecikmeden tetikler. 60 re-render/dk
  // per kart, modern donanımda ihmal edilebilir.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const createdMs = new Date(order.createdAt).getTime();
  const elapsedMs = Math.max(0, now - createdMs);
  const elapsedMin = Math.floor(elapsedMs / 60_000);
  const mm = String(Math.floor(elapsedMs / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((elapsedMs % 60_000) / 1000)).padStart(2, '0');

  type Severity = 'neutral' | 'warning' | 'danger';
  const severity: Severity =
    elapsedMin > 10 ? 'danger' : elapsedMin > 5 ? 'warning' : 'neutral';

  const cardBorder =
    severity === 'danger'
      ? 'border-2 border-[var(--danger)]'
      : severity === 'warning'
        ? 'border-2 border-[var(--warning)]'
        : 'border border-[var(--border)]';

  const headerBg =
    severity === 'danger'
      ? 'bg-[var(--danger-muted)]'
      : severity === 'warning'
        ? 'bg-[var(--warning-muted)]'
        : 'bg-stone-50';

  const timerColor =
    severity === 'danger'
      ? 'text-[var(--danger)]'
      : severity === 'warning'
        ? 'text-[var(--warning)]'
        : 'text-muted-foreground';

  const isTakeaway = order.orderType === 'takeaway';
  const orderTypeLabel = isTakeaway
    ? t('kds.card.takeaway')
    : t('kds.card.tablePrefix', { code: order.tableCodeSnapshot ?? '?' });
  const TypeIcon = isTakeaway ? Package : Utensils;

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg bg-white shadow-sm',
        cardBorder,
      )}
      data-severity={severity}
    >
      {/* Header — order type + #no + timer */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 rounded-t-lg border-b border-border px-4 py-3',
          headerBg,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <TypeIcon className="h-4 w-4 shrink-0" />
          <span className="truncate text-base font-bold">
            {orderTypeLabel}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            #{order.orderNo}
          </span>
        </div>
        <div
          className={cn(
            'flex items-center gap-1 text-xs font-semibold tabular-nums',
            timerColor,
          )}
          aria-label={t('kds.timer.elapsed', { mm, ss })}
        >
          <Clock className="h-3.5 w-3.5" />
          <span>
            {mm}:{ss}
          </span>
          {severity !== 'neutral' && <AlertCircle className="h-3.5 w-3.5" />}
        </div>
      </div>

      {/* Customer name (takeaway only, varsa) */}
      {isTakeaway && order.customerName !== null && (
        <div className="border-b border-border bg-white px-4 py-1.5 text-xs text-muted-foreground">
          {order.customerName}
        </div>
      )}

      {/* Items */}
      <ul className="divide-y divide-border">
        {order.items.map((item) => (
          <KdsItemRow
            key={item.id}
            orderId={order.id}
            item={item}
            onStatusChange={onItemStatusChange}
            isPending={pendingItemIds.has(item.id)}
          />
        ))}
      </ul>
    </div>
  );
}

interface KdsItemRowProps {
  orderId: string;
  item: KdsItem;
  onStatusChange: (
    orderId: string,
    itemId: string,
    next: 'preparing' | 'ready',
  ) => void;
  isPending: boolean;
}

function KdsItemRow({
  orderId,
  item,
  onStatusChange,
  isPending,
}: KdsItemRowProps) {
  const { t } = useTranslation();
  const isReady = item.status === 'ready';
  const showPreparingBtn = item.status === 'sent';
  const showReadyBtn = item.status === 'sent' || item.status === 'preparing';

  // Status badge YOK: buton yokluğu = ready (line-through + opacity).
  // 'sent' vs 'preparing' arasında ayrım buton sayısıyla görünür
  // (sent: 2 buton, preparing: 1 buton). UX feedback (Türkçe agent):
  // "Hazırlanıyor" hem buton hem status etiketi olunca kafa karışıyor.

  return (
    <li
      className={cn('flex flex-col gap-2 p-3', isReady && 'opacity-50')}
      data-status={item.status}
    >
      <div className="flex items-start gap-3">
        <span className="min-w-[2.5rem] text-2xl font-extrabold text-[var(--accent)] tabular-nums">
          {item.quantity}×
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'text-base font-semibold leading-tight',
              isReady && 'line-through',
            )}
          >
            {item.productName}
          </div>
          {item.variantNameSnapshot !== null && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {item.variantNameSnapshot}
            </div>
          )}
          {item.note !== null && item.note.trim() !== '' && (
            <div className="mt-1 flex items-start gap-1 text-xs font-semibold text-[var(--danger)]">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{item.note}</span>
            </div>
          )}
        </div>
      </div>

      {/* Buttons — Fitts h-16 (64px). state machine'e göre görünürlük.
          Per-item isPending: sadece tıklanan item disable, diğerleri aktif. */}
      {!isReady && (
        <div className="flex gap-2">
          {showPreparingBtn && (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onStatusChange(orderId, item.id, 'preparing')}
              className="h-16 flex-1 gap-2 text-base font-semibold"
              aria-label={t('kds.button.preparing')}
            >
              <Flame className="h-5 w-5" />
              <span>{t('kds.button.preparing')}</span>
            </Button>
          )}
          {showReadyBtn && (
            <Button
              type="button"
              disabled={isPending}
              onClick={() => onStatusChange(orderId, item.id, 'ready')}
              className="h-16 flex-1 gap-2 bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700"
              aria-label={t('kds.button.ready')}
            >
              <Check className="h-5 w-5" />
              <span>{t('kds.button.ready')}</span>
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
