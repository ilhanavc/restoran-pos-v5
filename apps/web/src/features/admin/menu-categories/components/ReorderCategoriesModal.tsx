import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ArrowUp, ArrowDown } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { type CategoryIcon } from '@restoran-pos/shared-types';
import { CATEGORY_ICON_MAP } from './categoryIconMap';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button } from '../../../../components/ui/button';
import { useReorderCategories, type ApiCategory } from '../api';

interface ReorderCategoriesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Modal açılışta sort_order sırasıyla kategoriler. */
  initialCategories: ApiCategory[];
}

/**
 * Kategorileri sırala modal — Session 85 (ürün `ReorderProductsModal` paritesi).
 *
 * Sol menü "Kategorileri Sırala" → centered modal; ↑/↓ butonlarıyla sıra
 * değişir (literal sürükle-bırak DEĞİL — app geneli tutarlılık + dokunmatik).
 * Kaydet'te POST /menu/categories/reorder bulk update tetikler. Liste lokal
 * copy üzerinde mutate edilir (optimistic UX); Kaydet sonrası ['categories']
 * invalidate olur.
 */
export function ReorderCategoriesModal({
  open,
  onOpenChange,
  initialCategories,
}: ReorderCategoriesModalProps) {
  const { t } = useTranslation();
  const reorderMutation = useReorderCategories();

  const [items, setItems] = useState<ApiCategory[]>(initialCategories);

  // Modal her açıldığında lokal kopya'yı yenile.
  useEffect(() => {
    if (open) setItems(initialCategories);
  }, [open, initialCategories]);

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
      await reorderMutation.mutateAsync(items.map((c) => c.id));
      toast.success(t('admin.menuDefinitions.categories.reorder.saveSuccess'));
      onOpenChange(false);
    } catch (err) {
      const fallback = t('admin.menuDefinitions.categories.reorder.saveFailed');
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
              {t('admin.menuDefinitions.categories.reorder.title')}
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
              {t('admin.menuDefinitions.categories.reorder.hint')}
            </p>

            {items.length === 0 ? (
              <div
                className="rounded-md border border-dashed p-6 text-center text-[13px]"
                style={{
                  borderColor: 'var(--v3-border-subtle)',
                  color: 'var(--v3-text-muted)',
                }}
              >
                {t('admin.menuDefinitions.categories.reorder.empty')}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((c, idx) => (
                  <li
                    key={c.id}
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
                    <CategoryIcon icon={c.icon} color={c.color} />
                    <span
                      className="min-w-0 flex-1 truncate text-[13px] font-bold uppercase"
                      style={{ color: 'var(--v3-text-primary)' }}
                    >
                      {c.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => move(idx, -1)}
                      disabled={isBusy || idx === 0}
                      aria-label={t('admin.menuDefinitions.categories.reorder.moveUp')}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-30"
                      style={{ color: 'var(--v3-text-secondary)' }}
                    >
                      <ArrowUp className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(idx, 1)}
                      disabled={isBusy || idx === items.length - 1}
                      aria-label={t('admin.menuDefinitions.categories.reorder.moveDown')}
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
              disabled={isBusy || items.length < 2}
            >
              {isBusy
                ? t('admin.menuDefinitions.categories.reorder.saving')
                : t('admin.menuDefinitions.categories.reorder.saveButton')}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Kategori rengi/ikonu (Lucide adı → component; bilinmeyen/boş → ikon yok). */
function CategoryIcon({ icon, color }: { icon?: string; color?: string }) {
  const IconCmp =
    icon && Object.prototype.hasOwnProperty.call(CATEGORY_ICON_MAP, icon)
      ? CATEGORY_ICON_MAP[icon as CategoryIcon]
      : null;
  if (!IconCmp) return null;
  return (
    <IconCmp
      aria-hidden="true"
      size={18}
      strokeWidth={2}
      className="shrink-0"
      style={color ? { color } : undefined}
    />
  );
}
