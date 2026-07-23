import { ClipboardList, Minus, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@restoran-pos/shared-domain';
import { BottomActionBar } from './BottomActionBar';
import type { CartItem } from '../useOrderCart';
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
  /** PR-6 (ADR-013 §10 Karar 10.2): pending satır tıklama → OrderProductDetailModal
   *  açar. Verilmezse satır tıklanamaz (PR-3 davranışına geri düşer). */
  onPendingEdit?: (item: CartItem) => void;
  /** Persisted satır void (soft cancel) — ADR-013 §6. Handler confirm dialog
   *  açar; backend RBAC + status FSM kuralı. */
  onPersistedVoid: (item: ApiOrderItem) => void;
  /** "Masayı Taşı" — ADR-028 web parite. Yalnız dine_in'de verilir; verilmezse
   *  (takeaway) buton render EDİLMEZ (paket siparişinin taşınacak masası yok). */
  onTransferTable?: () => void;
  /** "Aktar" — ADR-029 web parite. Yalnız dine_in'de verilir; verilmezse
   *  (takeaway) buton render EDİLMEZ (paket siparişi başka masaya aktarılamaz). */
  onMergeTable?: () => void;
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
  onPendingEdit,
  onPersistedVoid,
  onTransferTable,
  onMergeTable,
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
      {/* Header — v3 paritesi: padding 14px 16px, title 14/700, subtitle 11/muted */}
      <div
        className="flex items-center justify-between gap-2"
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--v3-border-subtle)',
        }}
      >
        <div className="flex flex-col">
          <span
            className="font-bold"
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--v3-text-primary)',
            }}
          >
            {t('order.adisyon.title')}
          </span>
          {hasPersisted && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--v3-text-muted)',
                marginTop: 2,
              }}
            >
              {t('order.adisyon.itemCount', { count: visiblePersisted.length })}
            </span>
          )}
        </div>
        <div className="flex items-center" style={{ gap: 6 }}>
          {hasPersisted && onTransferTable && (
            <button
              type="button"
              onClick={onTransferTable}
              aria-label={t('order.adisyon.transfer')}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-white text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
              style={{
                fontSize: 11,
                fontWeight: 600,
                // task_4d212295: rush-hour dokunma hedefi — kardeş void/stepper
                // kontrolleriyle (minHeight 40) tutarlı, pos-checklist §4 (~44px).
                minHeight: 40,
                padding: '6px 10px',
                borderColor: 'var(--v3-border-subtle)',
              }}
            >
              {t('order.adisyon.transfer')}
            </button>
          )}
          {hasPersisted && onMergeTable && (
            <button
              type="button"
              onClick={onMergeTable}
              aria-label={t('order.adisyon.merge')}
              className="inline-flex items-center gap-1.5 rounded-lg border bg-white text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
              style={{
                fontSize: 11,
                fontWeight: 600,
                // ADR-029 "Aktar" — Taşı ile aynı dokunma hedefi (minHeight 40,
                // pos-checklist §4 ~44px, #244 dersi: 28px'lik buton hci blocker).
                minHeight: 40,
                padding: '6px 10px',
                borderColor: 'var(--v3-border-subtle)',
              }}
            >
              {t('order.adisyon.merge')}
            </button>
          )}
          {/* task_e0431840: kapat (✕) 36px (h-9) POS dokunma tabanının (~44px,
              pos-checklist §4) altındaydı; <md bottom-sheet'te birincil "toparla"
              hedefi olduğundan 44px'e (h-11) çıkarıldı. */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('order.adisyon.close')}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          >
            <X className="h-[18px] w-[18px]" />
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
                {...(onPendingEdit ? { onEdit: () => onPendingEdit(item) } : {})}
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
    <div
      className="flex items-center"
      style={{ padding: '6px 18px', gap: 8 }}
    >
      <span
        className="uppercase"
        style={{
          fontSize: 12,
          fontWeight: 600,
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
          className="inline-flex items-center"
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 6,
            border: '1px solid var(--v3-purple, #7c3aed)',
            background: 'var(--v3-purple-soft, rgba(124, 92, 250, 0.13))',
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
  const { t } = useTranslation();
  const isComped = item.is_comped;

  const time = new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(item.created_at));

  return (
    <div
      className="flex"
      style={{
        // S104: satır yoğunluğu gevşetildi (ferahlık + okunabilirlik talebi).
        padding: '15px 18px',
        gap: 12,
        alignItems: 'flex-start',
        fontSize: 17,
        borderBottom: '1px solid var(--v3-border-subtle)',
        opacity: isComped ? 0.5 : 1,
      }}
    >
      {/* Sol: "Nx" prefix — v3 paritesi 14px / 700 / muted, width 32, paddingTop 2 */}
      <span
        className="shrink-0 tabular-nums text-center"
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--v3-text-muted)',
          width: 38,
          paddingTop: 2,
        }}
      >
        {item.quantity}×
      </span>

      {/* Orta: ad + actor chip + varyant + detay */}
      <div className="min-w-0 flex-1">
        <div
          className="flex flex-wrap items-center"
          style={{ gap: 6 }}
        >
          <span
            style={{
              fontWeight: 600,
              color: 'var(--v3-text-primary)',
            }}
          >
            {item.product_name}
          </span>
          {/* Actor chip — v3 paritesi: 8/800, padding 2px 6px, radius 4,
              warning-muted bg + warning text, letter-spacing 0.03em. */}
          {item.created_by_name !== null && (
            <span
              className="inline-flex items-center uppercase"
              style={{
                // S104: 8px okunmuyordu (kiosk mesafesi) → 10px.
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 7px',
                borderRadius: 4,
                background: 'var(--warning-muted, rgba(212, 136, 6, 0.14))',
                color: 'var(--warning, #D48806)',
                letterSpacing: '0.03em',
              }}
            >
              {item.created_by_name.toLocaleUpperCase('tr-TR')} · {time}
            </span>
          )}
          {isComped && (
            <span
              className="inline-flex items-center uppercase"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--warning-muted, rgba(212, 136, 6, 0.14))',
                color: 'var(--warning, #D48806)',
              }}
            >
              İkram
            </span>
          )}
        </div>
        {/* Varyant satırı — v3: 12px muted, marginTop 2 */}
        <div
          style={{
            fontSize: 12,
            color: 'var(--v3-text-muted)',
            marginTop: 2,
          }}
        >
          {item.variant_name_snapshot ?? 'Tam'}
        </div>
        {/* Özellik satırı — ADR-013 §10 nested attributes (mor accent, v3 paritesi). */}
        {item.attributes && item.attributes.length > 0 && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--v3-purple, #7C5CFA)',
              marginTop: 2,
            }}
          >
            {item.attributes
              .map((a) => a.option_name_snapshot)
              .join(', ')
              .toLocaleUpperCase('tr-TR')}
          </div>
        )}
        {/* Not satırı (varsa) — v3: 12px warning, marginTop 2 */}
        {item.note !== null && item.note !== '' && (
          <div
            className="italic"
            style={{
              fontSize: 12,
              color: 'var(--warning, #D48806)',
              marginTop: 2,
            }}
          >
            {item.note}
          </div>
        )}
        {/* Detay satırı: unit × qty = total — v3: 13px muted, marginTop 4 */}
        <div
          className="tabular-nums"
          style={{
            fontSize: 13,
            color: 'var(--v3-text-muted)',
            marginTop: 4,
          }}
        >
          {formatMoney(item.unit_price_cents)} × {item.quantity} ={' '}
          <span
            style={{
              fontWeight: 600,
              color: 'var(--v3-text-secondary)',
            }}
          >
            {formatMoney(item.total_cents)}
          </span>
        </div>
      </div>

      {/* Sağ üst: void */}
      {!isComped && (
        <button
          type="button"
          onClick={onVoid}
          aria-label={t('order.a11y.remove')}
          className="inline-flex shrink-0 items-center justify-center self-start rounded-md text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          style={{ minWidth: 40, minHeight: 40, padding: 4 }}
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
  /** PR-6 (ADR-013 §10 Karar 10.2): satır gövdesine tıklayınca modal açılır. */
  onEdit?: () => void;
}

/**
 * Pending kalem satırı — v3 ekran 2/3 paritesi.
 * Layout: [− qty +]  ad + (özellikler alt satır)  ₺line_total  🗑
 * Mor accent: sol border-l 3px.
 *
 * PR-6: ad bloğuna tıklama → onEdit (modal). Stepper/sil butonları
 * stopPropagation ile satır tıklamasını yutmaz.
 */
function PendingRow({
  item,
  onIncrement,
  onDecrement,
  onRemove,
  onEdit,
}: PendingRowProps) {
  const { t } = useTranslation();
  const lineTotalCents = item.unitPriceCents * item.quantity;
  const variantLabel = item.variant?.variantName ?? null;
  const attributesSummary =
    item.selectedAttributes.length > 0
      ? item.selectedAttributes.map((a) => a.optionName).join(', ')
      : null;

  return (
    <div
      className="flex items-center"
      style={{
        padding: '10px 18px',
        gap: 10,
        fontSize: 15,
        borderLeft: '3px solid var(--v3-purple, #7c3aed)',
        background: 'var(--v3-purple-bg, #f5f3ff)',
        marginBottom: 1,
      }}
    >
      <div
        className="flex items-center shrink-0"
        style={{ gap: 2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDecrement}
          aria-label={t('order.a11y.decrement')}
          className="inline-flex items-center justify-center rounded-md border bg-white text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{
            minWidth: 40,
            minHeight: 40,
            padding: 6,
            borderColor: 'var(--v3-border-subtle)',
          }}
        >
          <Minus className="h-[14px] w-[14px]" />
        </button>
        <span
          className="text-center tabular-nums"
          style={{
            fontSize: 15,
            fontWeight: 700,
            width: 28,
            color: 'var(--v3-text-primary)',
          }}
        >
          {item.quantity}
        </span>
        <button
          type="button"
          onClick={onIncrement}
          aria-label={t('order.a11y.increment')}
          className="inline-flex items-center justify-center rounded-md border bg-white text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{
            minWidth: 40,
            minHeight: 40,
            padding: 6,
            borderColor: 'var(--v3-border-subtle)',
          }}
        >
          <Plus className="h-[14px] w-[14px]" />
        </button>
      </div>

      <button
        type="button"
        onClick={onEdit}
        disabled={onEdit === undefined}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
        style={{ color: 'var(--v3-text-primary)' }}
      >
        <div
          className="truncate"
          style={{ fontSize: 15, fontWeight: 600 }}
        >
          {item.productName}
        </div>
        {variantLabel !== null && (
          <div
            className="truncate"
            style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}
          >
            {variantLabel}
          </div>
        )}
        {attributesSummary !== null && (
          <div
            className="truncate"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--v3-purple, #7C5CFA)',
            }}
          >
            {attributesSummary.toLocaleUpperCase('tr-TR')}
          </div>
        )}
        {item.note !== null && item.note !== '' && (
          <div
            className="truncate italic"
            style={{
              fontSize: 12,
              color: 'var(--warning, #D48806)',
            }}
          >
            {item.note}
          </div>
        )}
      </button>

      <span
        className="shrink-0 tabular-nums whitespace-nowrap"
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--v3-text-primary)',
        }}
      >
        {formatMoney(lineTotalCents)}
      </span>

      <button
        type="button"
        onClick={onRemove}
        aria-label={t('order.a11y.remove')}
        className="inline-flex shrink-0 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        style={{ minWidth: 40, minHeight: 40, padding: 4 }}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
