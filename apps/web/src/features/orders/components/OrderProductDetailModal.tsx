import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Minus, Plus } from 'lucide-react';
import { formatMoney } from '@restoran-pos/shared-domain';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import type { ApiProduct } from '../../admin/menu-products/api';
import type {
  ApiAttributeOption,
  ApiEffectiveAttributeGroup,
} from '../api';
import { useEffectiveAttributeGroupsForProduct } from '../api';
import type { CartAttributeSelection, CartItemEditPayload } from '../useCart';

/**
 * OrderProductDetailModal — ADR-013 §10 Karar 10.2 + 10.3.
 *
 * Tek modal: porsiyon (v5.1 backlog), özellik gruplari (kart-buton grid),
 * not (textarea), adet (stepper). Kart-buton seçili olunca mor border + ✓ daire
 * (v3 AttributePickerModal görsel paritesi). Required grup boş bırakılırsa
 * grup başlığı kırmızı + altında "Bu grupta bir seçim yapın" hatası.
 *
 * Sunucu validasyonu (PR-6a): MISSING_REQUIRED_ATTRIBUTE / INVALID_ATTRIBUTE_SELECTION
 * yine fırlar; modal client-side ön-validasyon yapar (Onayla anında).
 */

interface OrderProductDetailModalProps {
  /** null = kapalı; ApiProduct = açık + bağlam ürünü. */
  product: ApiProduct | null;
  /** Düzenleme modu için mevcut payload (selectedAttributes + note + qty);
   *  null ise yeni ekleme modu. Düzenleme modunda Onayla → editItem; yeni
   *  modda Onayla → addItemDetailed. */
  initial?: {
    selectedAttributes: CartAttributeSelection[];
    note: string | null;
    quantity: number;
  } | null;
  onClose: () => void;
  onConfirm: (payload: CartItemEditPayload) => void;
}

export function OrderProductDetailModal({
  product,
  initial = null,
  onClose,
  onConfirm,
}: OrderProductDetailModalProps) {
  const { t } = useTranslation();
  const isEdit = initial !== null;

  const groupsQuery = useEffectiveAttributeGroupsForProduct(product?.id ?? null);
  const groups = groupsQuery.data ?? [];

  // selections: { groupId → Set<optionId> }
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);

  // Modal her açıldığında / yeni ürün geldiğinde state'i resetle.
  useEffect(() => {
    if (product === null) return;
    if (isEdit && initial !== null) {
      const init: Record<string, Set<string>> = {};
      for (const a of initial.selectedAttributes) {
        if (init[a.groupId] === undefined) init[a.groupId] = new Set();
        init[a.groupId]!.add(a.optionId);
      }
      setSelections(init);
      setNote(initial.note ?? '');
      setQuantity(initial.quantity);
    } else {
      // Yeni ekleme modu: default option'ları ön-seç.
      const init: Record<string, Set<string>> = {};
      for (const g of groups) {
        const set = new Set<string>();
        for (const opt of g.options) {
          if (opt.is_default) {
            if (g.selection_type === 'single') {
              if (set.size === 0) set.add(opt.id);
            } else {
              set.add(opt.id);
            }
          }
        }
        init[g.id] = set;
      }
      setSelections(init);
      setNote('');
      setQuantity(1);
    }
    setErrors({});
  }, [product, isEdit, initial, groups]);

  const toggleOption = (
    group: ApiEffectiveAttributeGroup,
    optionId: string,
  ) => {
    setSelections((prev) => {
      const cur = new Set(prev[group.id] ?? []);
      if (group.selection_type === 'single') {
        if (cur.has(optionId)) {
          cur.clear();
        } else {
          cur.clear();
          cur.add(optionId);
        }
      } else {
        if (cur.has(optionId)) cur.delete(optionId);
        else cur.add(optionId);
      }
      return { ...prev, [group.id]: cur };
    });
    setErrors((prev) => {
      if (!prev[group.id]) return prev;
      const next = { ...prev };
      delete next[group.id];
      return next;
    });
  };

  const totalExtraCents = useMemo(() => {
    let sum = 0;
    for (const g of groups) {
      const sel = selections[g.id];
      if (sel === undefined) continue;
      for (const opt of g.options) {
        if (sel.has(opt.id)) sum += opt.extra_price_cents;
      }
    }
    return sum;
  }, [groups, selections]);

  const lineTotalCents = product
    ? (product.priceCents + totalExtraCents) * quantity
    : 0;

  const handleConfirm = () => {
    if (product === null) return;
    // Client-side required validation (sunucu da yine kontrol eder).
    const newErrors: Record<string, boolean> = {};
    for (const g of groups) {
      if (g.is_required && (selections[g.id]?.size ?? 0) === 0) {
        newErrors[g.id] = true;
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Snapshot derle
    const optById = new Map<string, ApiAttributeOption>();
    for (const g of groups) for (const opt of g.options) optById.set(opt.id, opt);

    const flat: CartAttributeSelection[] = [];
    for (const g of groups) {
      const sel = selections[g.id];
      if (sel === undefined) continue;
      for (const optId of sel) {
        const opt = optById.get(optId);
        if (opt === undefined) continue;
        flat.push({
          groupId: g.id,
          optionId: opt.id,
          groupName: g.name,
          optionName: opt.name,
          extraPriceCents: opt.extra_price_cents,
        });
      }
    }

    onConfirm({
      selectedAttributes: flat,
      note: note.trim() === '' ? null : note.trim(),
      quantity,
    });
  };

  return (
    <Dialog open={product !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('order.attributes.title')}</DialogTitle>
          <DialogDescription>
            {product?.name ?? ''}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {groupsQuery.isPending && (
            <div className="flex items-center justify-center py-8">
              <Loader2
                className="h-5 w-5 animate-spin"
                style={{ color: 'var(--v3-text-muted)' }}
              />
              <span className="ml-2 text-sm" style={{ color: 'var(--v3-text-muted)' }}>
                {t('order.attributes.loading')}
              </span>
            </div>
          )}

          {groupsQuery.isError && (
            <div
              className="rounded-md border border-dashed p-4 text-center text-sm"
              style={{
                borderColor: 'var(--v3-danger, #dc2626)',
                color: 'var(--v3-danger, #dc2626)',
              }}
            >
              {t('order.attributes.loadFailed')}
            </div>
          )}

          {!groupsQuery.isPending && !groupsQuery.isError && groups.length === 0 && (
            <div
              className="rounded-md border border-dashed p-4 text-center text-sm"
              style={{
                borderColor: 'var(--v3-border-subtle)',
                color: 'var(--v3-text-muted)',
              }}
            >
              {t('order.attributes.noGroups')}
            </div>
          )}

          {groups.map((group) => {
            const sel = selections[group.id] ?? new Set<string>();
            const isSingle = group.selection_type === 'single';
            const hasError = errors[group.id] === true;

            return (
              <div key={group.id} className="mb-5">
                <div className="mb-2">
                  <span
                    className="text-[13px] font-extrabold"
                    style={{
                      borderBottom: `2px solid ${hasError ? 'var(--v3-danger, #dc2626)' : 'var(--v3-purple, #7c3aed)'}`,
                      paddingBottom: 2,
                      color: hasError
                        ? 'var(--v3-danger, #dc2626)'
                        : 'var(--v3-text-primary)',
                    }}
                  >
                    {group.name}
                  </span>
                  <span
                    className="ml-2 text-[11px]"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    (
                    {isSingle
                      ? t('order.attributes.selectionSingle')
                      : t('order.attributes.selectionMultiple')}
                    {group.is_required ? ` · ${t('order.attributes.requiredTag')}` : ''}
                    )
                  </span>
                  {hasError && (
                    <div
                      className="mt-1 text-[11px]"
                      style={{ color: 'var(--v3-danger, #dc2626)' }}
                    >
                      {t('order.attributes.requiredError')}
                    </div>
                  )}
                </div>

                <div
                  className="grid gap-2"
                  style={{
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(180px, 1fr))',
                  }}
                >
                  {group.options.map((opt) => {
                    const selected = sel.has(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleOption(group, opt.id)}
                        className="relative rounded-lg border-2 p-3 text-left transition-colors"
                        style={{
                          borderColor: selected
                            ? 'var(--v3-purple, #7c3aed)'
                            : 'var(--v3-border-subtle)',
                          background: selected
                            ? 'var(--v3-purple-bg, #f5f3ff)'
                            : '#fff',
                        }}
                      >
                        {selected && (
                          <span
                            className="absolute right-1.5 top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full"
                            style={{ background: 'var(--v3-purple, #7c3aed)' }}
                          >
                            <Check size={10} color="#fff" />
                          </span>
                        )}
                        <div className="text-[13px] font-semibold">{opt.name}</div>
                        <div
                          className="mt-0.5 text-[12px] font-medium"
                          style={{
                            color:
                              opt.extra_price_cents === 0
                                ? 'var(--v3-success, #10b981)'
                                : 'var(--v3-text-secondary, #475569)',
                          }}
                        >
                          {opt.extra_price_cents === 0
                            ? t('order.attributes.free')
                            : t('order.attributes.extraPrice', {
                                amount: formatMoney(opt.extra_price_cents),
                              })}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Not + adet */}
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <label
                htmlFor="ordpd-note"
                className="mb-1 block text-[12px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('order.attributes.noteLabel')}
              </label>
              <textarea
                id="ordpd-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={280}
                placeholder={t('order.attributes.notePlaceholder')}
                className="w-full rounded-md border p-2 text-sm focus:outline-none focus:ring-2"
                style={{
                  borderColor: 'var(--v3-border-subtle)',
                }}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between">
              <span
                className="text-[12px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('order.attributes.qtyLabel')}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                  aria-label="Azalt"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-[2rem] text-center text-[14px] font-bold tabular-nums">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                  aria-label="Artır"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-3">
          <div className="flex w-full items-center justify-between">
            <span
              className="text-[14px] font-bold"
              style={{ color: 'var(--v3-text-primary)' }}
            >
              {t('order.attributes.totalLabel')}: {formatMoney(lineTotalCents)}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('order.attributes.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                style={{
                  background: 'var(--v3-purple, #7c3aed)',
                  color: '#fff',
                }}
              >
                {isEdit
                  ? t('order.attributes.confirmEdit')
                  : t('order.attributes.confirm')}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
