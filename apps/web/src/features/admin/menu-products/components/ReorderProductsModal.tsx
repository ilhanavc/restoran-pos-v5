import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button } from '../../../../components/ui/button';
import { useReorderProducts, type ApiProduct } from '../api';

interface ReorderProductsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  categoryName: string;
  /** Modal açılışta kategori için filtrelenmiş ürünler (sort_order sırasıyla). */
  initialProducts: ApiProduct[];
}

/**
 * Ürünleri sırala modal — Sprint 8c PR-E4.
 *
 * V3 paritesi: kategori 3-nokta menü "Ürünleri sırala" → modal centered
 * (drawer değil, kısa form/lista). Kullanıcı ↑/↓ btn'leri ile sırayı değiştirir,
 * Kaydet'te POST /menu/categories/:id/products/reorder bulk update tetikler.
 *
 * Liste lokal copy üzerinde mutate edilir (optimistic UX); Kaydet sonrası
 * `useProductsAdmin` invalidate olur.
 */
export function ReorderProductsModal({
  open,
  onOpenChange,
  categoryId,
  categoryName,
  initialProducts,
}: ReorderProductsModalProps) {
  const { t } = useTranslation();
  const reorderMutation = useReorderProducts();

  const [items, setItems] = useState<ApiProduct[]>(initialProducts);

  // Modal her açıldığında lokal kopya'yı yenile
  useEffect(() => {
    if (open) setItems(initialProducts);
  }, [open, initialProducts]);

  const isBusy = reorderMutation.isPending;

  const move = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      next.splice(target, 0, removed!);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      await reorderMutation.mutateAsync({
        categoryId,
        productIds: items.map((p) => p.id),
      });
      toast.success(t('admin.menuDefinitions.products.reorder.saveSuccess'));
      onOpenChange(false);
    } catch (err) {
      const fallback = t('admin.menuDefinitions.products.reorder.saveFailed');
      if (isAxiosError(err)) {
        const data = err.response?.data as
          | { error?: { message?: string } }
          | undefined;
        toast.error(data?.error?.message ?? fallback);
      } else {
        toast.error(fallback);
      }
    }
  };

  const formatPrice = (cents: number): string =>
    new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 2,
    }).format(cents / 100);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => !isBusy && onOpenChange(v)}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[90vw] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
        >
          <div
            className="flex items-center justify-between border-b px-5 py-4"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <DialogPrimitive.Title
              className="text-[16px] font-bold"
              style={{ color: 'var(--v3-text-primary)' }}
            >
              {t('admin.menuDefinitions.products.reorder.title', {
                category: categoryName,
              })}
            </DialogPrimitive.Title>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
              aria-label={t('common.close')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-neutral-100 disabled:opacity-50"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <p
              className="mb-3 text-[12px] leading-relaxed"
              style={{ color: 'var(--v3-text-muted)' }}
            >
              {t('admin.menuDefinitions.products.reorder.hint')}
            </p>

            {items.length === 0 ? (
              <div
                className="rounded-md border border-dashed p-6 text-center text-[13px]"
                style={{
                  borderColor: 'var(--v3-border-subtle)',
                  color: 'var(--v3-text-muted)',
                }}
              >
                {t('admin.menuDefinitions.products.reorder.empty')}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((p, idx) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5"
                    style={{ borderColor: 'var(--v3-border-subtle)' }}
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                      style={{
                        background: 'var(--v3-surface-2, #f3f4f6)',
                        color: 'var(--v3-text-secondary)',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span
                        className="truncate text-[13px] font-bold uppercase"
                        style={{ color: 'var(--v3-text-primary)' }}
                      >
                        {p.name}
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: 'var(--v3-text-muted)' }}
                      >
                        {formatPrice(p.priceCents)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => move(idx, -1)}
                      disabled={isBusy || idx === 0}
                      aria-label={t('admin.menuDefinitions.products.reorder.moveUp')}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-30"
                      style={{ color: 'var(--v3-text-secondary)' }}
                    >
                      <ArrowUp className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(idx, 1)}
                      disabled={isBusy || idx === items.length - 1}
                      aria-label={t('admin.menuDefinitions.products.reorder.moveDown')}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-30"
                      style={{ color: 'var(--v3-text-secondary)' }}
                    >
                      <ArrowDown className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            className="flex justify-end gap-2 border-t px-5 py-4"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              {t('admin.menuDefinitions.drawer.cancelButton')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={isBusy || items.length === 0}
            >
              {isBusy
                ? t('admin.menuDefinitions.products.reorder.saving')
                : t('admin.menuDefinitions.products.reorder.saveButton')}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
