import { ClipboardList, Minus, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@restoran-pos/shared-domain';
import { BottomActionBar } from './BottomActionBar';
import type { CartItem } from '../useCart';
import type { ApiOrderItem } from '../api';

interface AdisyonPanelProps {
  /** Persisted (kayıtlı) kalemler — backend'den gelen ApiOrderItem[].
   *  Cancelled satırlar burada FİLTRE EDİLMEZ; AdisyonPanel kendisi gizler. */
  persistedItems: ApiOrderItem[];
  /** Pending (kaydedilmemiş) cart kalemleri (ADR-013 §1). */
  pendingItems: CartItem[];
  /** Sipariş ara toplam (cent) — pending + persisted toplamı. */
  subtotalCents: number;
  /** Toplam (indirim sonrası, vergi dahil) (cent). */
  totalCents: number;
  /** State-based action slot (Kaydet / Ödeme+Hızlı Öde). */
  actionsSlot?: React.ReactNode;
  /** Bilgilendirme satırı (örn. "Yeni ürünleri kaydettikten sonra ödeme açılır."). */
  hint?: string | null;
  onPendingIncrement: (rowId: string) => void;
  onPendingDecrement: (rowId: string) => void;
  onPendingRemove: (rowId: string) => void;
  /** Persisted satır void (soft cancel) — ADR-013 §6. Handler confirm dialog
   *  açar; backend RBAC + status FSM kuralı. */
  onPersistedVoid: (item: ApiOrderItem) => void;
  onTransferTable: () => void;
  onClose: () => void;
}

/**
 * Sağ panel — ADR-013 §5 (persisted üstte, pending altta, empty state).
 *
 * PR-5: persisted kalem listesi + actor rozeti + void aksiyonu eklendi.
 *
 * Layout:
 *   1. Header: "Adisyon" + "X kayıtlı ürün" + Taşı + ×
 *   2. MEVCUT ÜRÜNLER (persisted, !cancelled) — actor rozeti, line total, void
 *   3. YENİ ÜRÜNLER (pending, mor accent) — qty stepper, line total, sil
 *   4. Empty state (her ikisi de yoksa)
 *   5. Bottom: totals + hint + actionsSlot
 */
export function AdisyonPanel({
  persistedItems,
  pendingItems,
  subtotalCents,
  totalCents,
  actionsSlot,
  hint,
  onPendingIncrement,
  onPendingDecrement,
  onPendingRemove,
  onPersistedVoid,
  onTransferTable,
  onClose,
}: AdisyonPanelProps) {
  const { t } = useTranslation();

  // Cancelled satırları gösterme — v3 paritesi (`filter(status !== 'cancelled')`).
  const visiblePersisted = persistedItems.filter(
    (it) => it.status !== 'cancelled',
  );

  const hasPersisted = visiblePersisted.length > 0;
  const hasPending = pendingItems.length > 0;
  const showEmpty = !hasPersisted && !hasPending;

  return (
    <aside
      className="flex h-full flex-col border-l bg-white"
      style={{ borderColor: 'var(--v3-border-subtle)' }}
    >
      {/* Header — v3 paritesi 18px horizontal padding */}
      <div className="flex items-center justify-between px-[18px] py-3">
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
              {t('order.adisyon.itemCount', { count: visiblePersisted.length })}
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

        {hasPersisted && (
          <div className="flex flex-col">
            <SectionHeader label={t('order.adisyon.persistedTitle')} />
            {visiblePersisted.map((item) => (
              <PersistedRow
                key={item.id}
                item={item}
                onVoid={() => onPersistedVoid(item)}
              />
            ))}
          </div>
        )}

        {hasPending && (
          <div className="flex flex-col">
            {hasPersisted && (
              <SectionHeader
                label={t('order.adisyon.pendingTitle')}
                accent
                badgeLabel={t('order.adisyon.pendingBadge')}
              />
            )}
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

      {/* Bottom */}
      <BottomActionBar
        subtotalCents={subtotalCents}
        totalCents={totalCents}
        actionsSlot={actionsSlot}
        hint={hint ?? null}
      />
    </aside>
  );
}

/**
 * Section başlığı — "MEVCUT ÜRÜNLER" / "YENİ EKLENEN" (v3 paritesi).
 * v3 stiller: 11px, 600, uppercase, letter-spacing 0.05em.
 *
 * Accent=true: mor renk + yanında "KAYDEDİLMEDİ" chip (v3 ekran 2 paritesi).
 */
function SectionHeader({
  label,
  accent,
  badgeLabel,
}: {
  label: string;
  accent?: boolean;
  badgeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-[18px] pb-1.5 pt-3">
      <span
        className="text-[11px] font-semibold uppercase"
        style={{
          color: accent
            ? 'var(--v3-purple, #7c3aed)'
            : 'var(--v3-text-muted)',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </span>
      {badgeLabel !== undefined && (
        <span
          className="inline-flex items-center rounded-[4px] px-1.5 py-px text-[9px] font-bold uppercase leading-tight tracking-wider"
          style={{
            background: 'rgba(124, 58, 237, 0.14)',
            color: 'var(--v3-purple, #7c3aed)',
          }}
        >
          {badgeLabel}
        </span>
      )}
    </div>
  );
}

interface PersistedRowProps {
  item: ApiOrderItem;
  onVoid: () => void;
}

/**
 * Persisted kalem satırı — v3 ekran 5/3 paritesi.
 *
 * Layout (v3):
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 4×  KAŞARLI PİDE  [İLHAN AVCI · 13:03]                  🗑  │
 *   │     Tam                                                      │
 *   │     ₺350,00 × 4 = ₺1.400,00                                  │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * - 4× prefix sol başta, küçük muted
 * - Ad uppercase + turuncu chip (actor + saat)
 * - Varyant satırı altında ("Tam") — PR-6 öncesi placeholder, PR-6'da
 *   variant_name_snapshot dinamik
 * - Detay satırı: "unit × qty = total" muted gri
 * - 🗑 sağ üst köşede
 * - is_comped → opacity 0.5 + "İkram" rozeti
 */
function PersistedRow({ item, onVoid }: PersistedRowProps) {
  const isComped = item.is_comped;

  const time = new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(item.created_at));

  return (
    <div
      className="flex gap-2 border-b px-[18px] py-3"
      style={{
        borderColor: 'var(--v3-border-subtle)',
        opacity: isComped ? 0.5 : 1,
      }}
    >
      {/* Sol: küçük "4×" prefix — v3 paritesi 14px, medium */}
      <span
        className="shrink-0 pt-0.5 text-[14px] font-medium tabular-nums"
        style={{ color: 'var(--v3-text-muted)' }}
      >
        {item.quantity}×
      </span>

      {/* Orta: ad + actor chip + varyant + detay */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-[14px] font-bold uppercase tracking-tight"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {item.product_name}
          </span>
          {/* Actor turuncu chip — v3 paritesi (ekran "İLHAN AVCİ · 13:03").
              Kullanıcı adı tr-TR upper case (Türkçe-i kuralı: 'i' → 'İ'). */}
          {item.created_by_name !== null && (
            <span
              className="inline-flex items-center rounded-[4px] px-1.5 py-px text-[9px] font-bold uppercase leading-tight tracking-wider"
              style={{
                background: 'rgba(245, 158, 11, 0.20)',
                color: '#92400e',
              }}
            >
              {item.created_by_name.toLocaleUpperCase('tr-TR')} · {time}
            </span>
          )}
          {isComped && (
            <span
              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{
                background: 'rgba(228, 167, 41, 0.18)',
                color: '#92400e',
              }}
            >
              İkram
            </span>
          )}
        </div>
        {/* Varyant satırı — PR-6 öncesi default 'Tam' (ürün varyantsızsa
            default 1 porsiyon zaten 'Tam' anlamına gelir). PR-6'da
            item.variant_name_snapshot. */}
        <div
          className="mt-0.5 text-[12px]"
          style={{ color: 'var(--v3-text-secondary)' }}
        >
          Tam
        </div>
        {/* Detay satırı: unit × qty = total */}
        <div
          className="mt-0.5 text-[12px] tabular-nums"
          style={{ color: 'var(--v3-text-muted)' }}
        >
          {formatMoney(item.unit_price_cents)} × {item.quantity} ={' '}
          <span style={{ color: 'var(--v3-text-primary)', fontWeight: 600 }}>
            {formatMoney(item.total_cents)}
          </span>
        </div>
      </div>

      {/* Sağ üst: void */}
      {!isComped && (
        <button
          type="button"
          onClick={onVoid}
          aria-label="Kaldır"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-md text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
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
 * Layout: [− qty +]  ad  ₺line_total  🗑
 * Mor accent: sol border-l 3px.
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
      className="flex items-center gap-3 px-[18px] py-3"
      style={{
        borderLeft: '3px solid var(--v3-purple, #7c3aed)',
        background: 'var(--v3-purple-bg, #f5f3ff)',
      }}
    >
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

      <div
        className="min-w-0 flex-1 truncate text-[14px] font-bold uppercase tracking-tight"
        style={{ color: 'var(--v3-text-primary)' }}
      >
        {item.productName}
      </div>

      <span
        className="shrink-0 text-[15px] font-extrabold tabular-nums"
        style={{ color: 'var(--v3-text-primary)' }}
      >
        {formatMoney(lineTotalCents)}
      </span>

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
