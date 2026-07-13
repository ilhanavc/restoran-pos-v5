import { ClipboardList, Loader2, Minus, Plus, Save, Trash2, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { CartItem } from '../useOrderCart';

interface TakeawayCartPanelProps {
  items: CartItem[];
  subtotalCents: number;
  totalCents: number;
  customerName: string | null;
  onPickCustomer: () => void;
  onIncrement: (productId: string, variantId: string | null) => void;
  onDecrement: (rowId: string) => void;
  onRemove: (rowId: string) => void;
  onSave: () => void;
  isSaving: boolean;
}

/**
 * Paket sipariş sağ panel — Adisyon (ADR-017 ekran 2 paritesi).
 *
 * Dine-in AdisyonPanel'den ayrı: persisted/pending split YOK (kaydedilmemiş
 * sepet sadece). Müşteri picker satırı, qty stepper, tek mor "Kaydet" buton.
 */
export function TakeawayCartPanel({
  items,
  subtotalCents,
  totalCents,
  customerName,
  onPickCustomer,
  onIncrement,
  onDecrement,
  onRemove,
  onSave,
  isSaving,
}: TakeawayCartPanelProps) {
  const { t } = useTranslation();

  const isEmpty = items.length === 0;

  return (
    <aside
      className="flex h-full flex-col border-l bg-white"
      style={{ borderColor: 'var(--v3-border-subtle)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-[18px] py-3">
        <span
          className="text-[15px] font-bold"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('takeaway.cart.title')}
        </span>
      </div>

      {/* Müşteri satırı (header altı) */}
      <div className="px-[18px] pb-2">
        <button
          type="button"
          onClick={onPickCustomer}
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-[13px] font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{
            borderColor: customerName === null
              ? 'var(--v3-border-subtle)'
              : 'var(--v3-purple, #7c3aed)',
            color: customerName === null
              ? 'var(--v3-text-muted)'
              : 'var(--v3-text-primary)',
          }}
        >
          <User className="h-4 w-4" />
          {customerName ?? t('takeaway.customer.selectButton')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isEmpty ? (
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
                {t('takeaway.cart.empty')}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {items.map((item) => (
              <div
                key={item.rowId}
                className="flex items-center gap-3 px-[18px] py-3"
                style={{
                  borderLeft: '3px solid var(--v3-purple, #7c3aed)',
                  background: 'var(--v3-purple-bg, #f5f3ff)',
                }}
              >
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onDecrement(item.rowId)}
                    aria-label={t('order.a11y.decrement')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
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
                    onClick={() => onIncrement(item.productId, item.variant?.variantId ?? null)}
                    aria-label={t('order.a11y.increment')}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
                    style={{ borderColor: 'var(--v3-border-subtle)' }}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className="truncate text-[14px] font-bold uppercase tracking-tight"
                    style={{ color: 'var(--v3-text-primary)' }}
                  >
                    {item.productName}
                  </div>
                  {item.variant !== null && (
                    <div
                      className="truncate text-[11px]"
                      style={{ color: 'var(--v3-text-secondary)' }}
                    >
                      {item.variant.variantName}
                    </div>
                  )}
                </div>

                <span
                  className="shrink-0 text-[15px] font-extrabold tabular-nums"
                  style={{ color: 'var(--v3-text-primary)' }}
                >
                  {formatMoney(item.unitPriceCents * item.quantity)}
                </span>

                <button
                  type="button"
                  onClick={() => onRemove(item.rowId)}
                  aria-label={t('order.a11y.remove')}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom totals + Kaydet */}
      <div
        className="border-t px-[18px] py-4"
        style={{ borderColor: 'var(--v3-border-subtle)' }}
      >
        <div className="mb-1 flex items-center justify-between text-[13px]">
          <span style={{ color: 'var(--v3-text-muted)' }}>
            {t('takeaway.cart.subtotal')}
          </span>
          <span
            className="tabular-nums"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {formatMoney(subtotalCents)}
          </span>
        </div>
        <div className="mb-3 flex items-center justify-between text-[16px] font-extrabold">
          <span style={{ color: 'var(--v3-text-primary)' }}>
            {t('takeaway.cart.total')}
          </span>
          <span
            className="tabular-nums"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {formatMoney(totalCents)}
          </span>
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={isEmpty || isSaving}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-[14px] font-bold text-white shadow-sm transition-all duration-[120ms] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: 'var(--v3-purple, #7c3aed)' }}
        >
          {isSaving ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Save className="h-5 w-5" />
          )}
          {t('takeaway.cart.saveButton')}
        </button>
      </div>
    </aside>
  );
}
