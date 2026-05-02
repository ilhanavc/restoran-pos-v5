import { ClipboardList, Minus, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@restoran-pos/shared-domain';
import { BottomActionBar } from './BottomActionBar';
import type { CartItem } from '../useCart';

interface AdisyonPanelProps {
  /** Persisted (kayıtlı) ürün sayısı — header alt-başlığı + Taşı butonu görünürlüğü. */
  persistedItemCount: number;
  /** Pending (kaydedilmemiş) cart kalemleri (ADR-013 §1). */
  pendingItems: CartItem[];
  /** Sipariş ara toplam (cent) — pending + persisted toplamı. */
  subtotalCents: number;
  /** Toplam (indirim sonrası, vergi dahil) (cent). */
  totalCents: number;
  /** State-based action slot (Kaydet / Ödeme+Hızlı Öde). PR-4+ doldurur. */
  actionsSlot?: React.ReactNode;
  /** Bilgilendirme satırı (örn. "Yeni ürünleri kaydettikten sonra ödeme açılır."). */
  hint?: string | null;
  onPendingIncrement: (rowId: string) => void;
  onPendingDecrement: (rowId: string) => void;
  onPendingRemove: (rowId: string) => void;
  onTransferTable: () => void;
  onClose: () => void;
}

/**
 * Sağ panel — ADR-013 §5 (persisted üstte, pending altta, empty state) +
 * v3 paritesi: bottom totals + actions sağ panel'in altına gömülü.
 *
 * PR-3: pending kalemler listesi eklendi (mor border-l accent). Persisted
 * listesi PR-5'te; actionsSlot Kaydet (PR-4) + Ödeme/Hızlı Öde (PR-7).
 *
 * Layout:
 *   1. Header: "Adisyon" + alt başlık ("X kayıtlı ürün") + Taşı + ×
 *   2. Content: MEVCUT ÜRÜNLER (PR-5) + YENİ ÜRÜNLER (pending) | empty state
 *   3. Bottom: Ara toplam + Toplam + (hint?) + actionsSlot
 */
export function AdisyonPanel({
  persistedItemCount,
  pendingItems,
  subtotalCents,
  totalCents,
  actionsSlot,
  hint,
  onPendingIncrement,
  onPendingDecrement,
  onPendingRemove,
  onTransferTable,
  onClose,
}: AdisyonPanelProps) {
  const { t } = useTranslation();

  const hasPersisted = persistedItemCount > 0;
  const hasPending = pendingItems.length > 0;
  const showEmpty = !hasPersisted && !hasPending;

  return (
    <aside
      className="flex h-full flex-col border-l bg-white"
      style={{ borderColor: 'var(--v3-border-subtle)' }}
    >
      {/* Header — v3 paritesi: border-b yok, sade beyaz başlık. */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex flex-col leading-tight">
          <span
            className="text-[15px] font-bold"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {t('order.adisyon.title')}
          </span>
          {hasPersisted && (
            <span
              className="text-[12px]"
              style={{ color: 'var(--v3-text-muted)' }}
            >
              {t('order.adisyon.itemCount', { count: persistedItemCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasPersisted && (
            <button
              type="button"
              onClick={onTransferTable}
              aria-label={t('order.adisyon.transfer')}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-white px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              {t('order.adisyon.transfer')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('order.adisyon.close')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {showEmpty && (
          <div className="flex h-full items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <ClipboardList
                className="h-12 w-12"
                strokeWidth={1.5}
                style={{ color: 'var(--v3-text-muted)' }}
              />
              <p
                className="text-sm font-medium"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('order.adisyon.empty')}
              </p>
            </div>
          </div>
        )}

        {hasPending && (
          <div className="flex flex-col">
            {/* Section başlığı yalnız persisted varsa anlamlı. PR-5'te
                "MEVCUT ÜRÜNLER" başlığı eklenince burası "YENİ ÜRÜNLER" olur. */}
            {pendingItems.map((item) => (
              <PendingRow
                key={item.rowId}
                item={item}
                onIncrement={() => onPendingIncrement(item.rowId)}
                onDecrement={() => onPendingDecrement(item.rowId)}
                onRemove={() => onPendingRemove(item.rowId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom — totals + actions, sağ panel'e gömülü (v3 paritesi). */}
      <BottomActionBar
        subtotalCents={subtotalCents}
        totalCents={totalCents}
        actionsSlot={actionsSlot}
        hint={hint ?? null}
      />
    </aside>
  );
}

interface PendingRowProps {
  item: CartItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}

/**
 * Pending kalem satırı — v3 ekran 2/3 paritesi.
 *
 * Layout: [− qty +]  ad  ₺line_total  🗑
 * Mor accent: sol border-l 3px (v3 ekran 2 üstündeki mor şerit).
 */
function PendingRow({
  item,
  onIncrement,
  onDecrement,
  onRemove,
}: PendingRowProps) {
  const lineTotalCents = item.productPriceCents * item.quantity;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        borderLeft: '3px solid var(--v3-purple, #7c3aed)',
        background: 'var(--v3-purple-bg, #f5f3ff)',
      }}
    >
      {/* Inline qty stepper */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onDecrement}
          aria-label="Azalt"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span
          className="min-w-[1.5rem] text-center text-[14px] font-bold tabular-nums"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {item.quantity}
        </span>
        <button
          type="button"
          onClick={onIncrement}
          aria-label="Artır"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Ad */}
      <div
        className="min-w-0 flex-1 truncate text-[13px] font-bold uppercase tracking-tight"
        style={{ color: 'var(--v3-text-primary)' }}
      >
        {item.productName}
      </div>

      {/* Line total */}
      <span
        className="shrink-0 text-[14px] font-extrabold tabular-nums"
        style={{ color: 'var(--v3-text-primary)' }}
      >
        {formatMoney(lineTotalCents)}
      </span>

      {/* Sil */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Kaldır"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
