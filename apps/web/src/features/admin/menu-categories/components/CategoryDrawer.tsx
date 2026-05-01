import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import {
  CATEGORY_COLORS,
  type CategoryColor,
  type CategoryIcon,
} from '@restoran-pos/shared-types';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { useCreateCategory, useUpdateCategory, type ApiCategory } from '../api';
import { IconPicker } from './IconPicker';
import { ColorPicker } from './ColorPicker';

interface CategoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  initialCategory?: ApiCategory | undefined;
}

const DEFAULT_ICON: CategoryIcon = 'UtensilsCrossed';
const DEFAULT_COLOR: CategoryColor = '#ea580c';

/**
 * Yeni / Düzenle Kategori drawer — Sprint 8c PR-D2.
 *
 * ADR-011 Amendment 2026-05-01:
 * - Karar 1-3: lucide ikon + 8 renk paleti (IconPicker + ColorPicker)
 * - Karar 5: Yazıcı dropdown disabled + Phase 3 helper text
 * - Karar 6: Drawer pattern (sağdan slide, ESC kapat, focus trap)
 *
 * Form alanları: Ad (zorunlu, 1-64 char) + İkon + Renk + Yazıcı (disabled).
 */
export function CategoryDrawer({
  open,
  onOpenChange,
  mode,
  initialCategory,
}: CategoryDrawerProps) {
  const { t } = useTranslation();

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const [name, setName] = useState('');
  const [icon, setIcon] = useState<CategoryIcon>(DEFAULT_ICON);
  const [color, setColor] = useState<CategoryColor>(DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initialCategory) {
      setName(initialCategory.name);
      setIcon(initialCategory.icon as CategoryIcon);
      // Eğer DB'deki renk palette dışındaysa default'a düş (defansif).
      const isPaletteColor = (CATEGORY_COLORS as readonly string[]).includes(
        initialCategory.color,
      );
      setColor(isPaletteColor ? (initialCategory.color as CategoryColor) : DEFAULT_COLOR);
    } else {
      setName('');
      setIcon(DEFAULT_ICON);
      setColor(DEFAULT_COLOR);
    }
    setError(null);
    setIsSubmitting(false);
  }, [open, mode, initialCategory]);

  const isBusy =
    isSubmitting || createCategory.isPending || updateCategory.isPending;

  const handleClose = () => {
    if (!isBusy) onOpenChange(false);
  };

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string; code?: string } }
        | undefined;
      const code = data?.error?.code;
      // ADR-006 §5.2 mapping → i18n key (drawer-spesifik mesajlar)
      if (code === 'MENU_CATEGORY_ALREADY_EXISTS') {
        return t('admin.menuDefinitions.drawer.errors.duplicateName');
      }
      if (code === 'MENU_CATEGORY_INVALID_ICON') {
        return t('admin.menuDefinitions.drawer.errors.invalidIcon');
      }
      if (code === 'MENU_CATEGORY_INVALID_COLOR') {
        return t('admin.menuDefinitions.drawer.errors.invalidColor');
      }
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('admin.menuDefinitions.drawer.errors.nameRequired'));
      return;
    }
    if (trimmedName.length > 64) {
      setError(t('admin.menuDefinitions.drawer.errors.nameTooLong'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'edit' && initialCategory) {
        await updateCategory.mutateAsync({
          id: initialCategory.id,
          name: trimmedName,
          icon,
          color,
        });
        toast.success(t('admin.menuDefinitions.drawer.editSuccess'));
      } else {
        await createCategory.mutateAsync({
          name: trimmedName,
          icon,
          color,
        });
        toast.success(t('admin.menuDefinitions.drawer.createSuccess'));
      }
      onOpenChange(false);
    } catch (err) {
      setError(
        extractError(
          err,
          mode === 'edit'
            ? t('admin.menuDefinitions.drawer.errors.updateFailed')
            : t('admin.menuDefinitions.drawer.errors.createFailed'),
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const titleText =
    mode === 'edit'
      ? t('admin.menuDefinitions.drawer.editTitle')
      : t('admin.menuDefinitions.drawer.createTitle');

  const submitLabel = useMemo(
    () =>
      isBusy
        ? t('admin.menuDefinitions.drawer.saving')
        : t('admin.menuDefinitions.drawer.saveButton'),
    [isBusy, t],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !isBusy && onOpenChange(v)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-[480px] flex-col bg-white shadow-xl"
          aria-describedby={undefined}
        >
          <form onSubmit={submit} className="flex h-full flex-col">
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <DialogPrimitive.Title
                className="text-[16px] font-bold"
                style={{ color: 'var(--v3-text-primary)' }}
              >
                {titleText}
              </DialogPrimitive.Title>
              <button
                type="button"
                onClick={handleClose}
                disabled={isBusy}
                aria-label={t('common.close')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-neutral-100 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              <div className="mb-5">
                <Label htmlFor="category-name" className="mb-1.5 block">
                  {t('admin.menuDefinitions.drawer.nameLabel')}
                  <span style={{ color: 'var(--v3-danger, #dc2626)' }}>*</span>
                </Label>
                <Input
                  id="category-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('admin.menuDefinitions.drawer.namePlaceholder')}
                  autoFocus
                  disabled={isBusy}
                  maxLength={64}
                />
              </div>

              <div className="mb-5">
                <Label className="mb-1.5 block">
                  {t('admin.menuDefinitions.drawer.printerLabel')}
                </Label>
                <select
                  disabled
                  className="h-10 w-full rounded-md border bg-neutral-50 px-3 text-sm text-neutral-500"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                >
                  <option>{t('admin.menuDefinitions.drawer.printerKitchen')}</option>
                </select>
                <p
                  className="mt-1 text-[11px]"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('admin.menuDefinitions.drawer.printerHint')}
                </p>
              </div>

              <div className="mb-5">
                <Label className="mb-1.5 block">
                  {t('admin.menuDefinitions.drawer.iconLabel')}
                </Label>
                <IconPicker
                  value={icon}
                  onChange={setIcon}
                  accentColor={color}
                  disabled={isBusy}
                />
              </div>

              <div className="mb-5">
                <Label className="mb-1.5 block">
                  {t('admin.menuDefinitions.drawer.colorLabel')}
                </Label>
                <ColorPicker value={color} onChange={setColor} disabled={isBusy} />
              </div>

              {error && (
                <p
                  className="mt-4 text-sm"
                  style={{ color: 'var(--v3-danger, #dc2626)' }}
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>

            <div
              className="flex justify-end gap-2 border-t px-5 py-4"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isBusy}
              >
                {t('admin.menuDefinitions.drawer.cancelButton')}
              </Button>
              <Button type="submit" disabled={isBusy}>
                {submitLabel}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
