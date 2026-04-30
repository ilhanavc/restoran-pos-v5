import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2 } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  useCreateAttributeGroup,
  useCreateAttributeOption,
} from '../api';

interface DraftOption {
  tempId: string;
  name: string;
  extraPriceText: string; // Free-form input; parsed at submit (TL → kuruş).
  isDefault: boolean;
}

interface NewGroupDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function makeTempId(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * "Yeni Grup Tanımla" drawer — Sprint 8c PR-F2b.
 *
 * V3 paritesi: sağdan kayan yarım ekran panel. Form alanları:
 *   - Özellik grup ismi (zorunlu)
 *   - Seçim tipi (Tekli/Çoklu, default Tekli)
 *   - Özellik seçimi zorunlu olsun (toggle)
 *   - Option tablosu: Adı / Ekstra Tutar / Varsayılan / Sil
 *
 * Save flow (transaction yok — F2c'de iyileştirilecek):
 *   1) POST /attribute-groups
 *   2) Her option için POST /attribute-groups/:id/options (sequential)
 *   3) Bir option fail ederse toast + diğerlerine devam (group oluştu kabul)
 *   4) Tümü success → drawer kapanır, success toast.
 *
 * V3'teki "Aktif" toggle backend'de yok — UI'da yer almıyor (v5.1 borç).
 */
export function NewGroupDrawer({ open, onOpenChange }: NewGroupDrawerProps) {
  const { t } = useTranslation();

  const createGroup = useCreateAttributeGroup();
  const createOption = useCreateAttributeOption();

  const [name, setName] = useState('');
  const [selectionType, setSelectionType] = useState<'single' | 'multiple'>(
    'single',
  );
  const [isRequired, setIsRequired] = useState(false);
  const [options, setOptions] = useState<DraftOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state every time the drawer opens.
  useEffect(() => {
    if (open) {
      setName('');
      setSelectionType('single');
      setIsRequired(false);
      setOptions([]);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  // Single mode → en fazla 1 default. Switch yapıldığında kuralı uygula.
  useEffect(() => {
    if (selectionType === 'single') {
      setOptions((prev) => {
        let firstDefaultSeen = false;
        return prev.map((opt) => {
          if (opt.isDefault && !firstDefaultSeen) {
            firstDefaultSeen = true;
            return opt;
          }
          return { ...opt, isDefault: false };
        });
      });
    }
  }, [selectionType]);

  const isBusy = isSubmitting || createGroup.isPending || createOption.isPending;

  const handleAddOption = () => {
    setOptions((prev) => [
      ...prev,
      {
        tempId: makeTempId(),
        name: '',
        extraPriceText: '0',
        isDefault: false,
      },
    ]);
  };

  const handleRemoveOption = (tempId: string) => {
    setOptions((prev) => prev.filter((o) => o.tempId !== tempId));
  };

  const handleOptionNameChange = (tempId: string, value: string) => {
    setOptions((prev) =>
      prev.map((o) => (o.tempId === tempId ? { ...o, name: value } : o)),
    );
  };

  const handleOptionPriceChange = (tempId: string, value: string) => {
    setOptions((prev) =>
      prev.map((o) =>
        o.tempId === tempId ? { ...o, extraPriceText: value } : o,
      ),
    );
  };

  const handleOptionDefaultChange = (tempId: string, checked: boolean) => {
    setOptions((prev) =>
      prev.map((o) => {
        if (selectionType === 'single') {
          // Radio: sadece bir tanesi default olabilir.
          return { ...o, isDefault: o.tempId === tempId ? checked : false };
        }
        // Multiple: bağımsız checkbox.
        return o.tempId === tempId ? { ...o, isDefault: checked } : o;
      }),
    );
  };

  const handleClose = () => {
    if (!isBusy) onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('admin.attributeGroups.newGroupDrawer.errors.nameRequired'));
      return;
    }
    for (const opt of options) {
      if (!opt.name.trim()) {
        setError(
          t('admin.attributeGroups.newGroupDrawer.errors.optionNameRequired'),
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const group = await createGroup.mutateAsync({
        name: trimmedName,
        selectionType,
        isRequired,
      });

      let optionFailures = 0;
      let sortIndex = 0;
      for (const opt of options) {
        const cents = Math.round(Number(opt.extraPriceText.replace(',', '.')) * 100);
        const safeCents = Number.isFinite(cents) && cents >= 0 ? cents : 0;
        try {
          await createOption.mutateAsync({
            groupId: group.id,
            name: opt.name.trim(),
            extraPriceCents: safeCents,
            isDefault: opt.isDefault,
            sortOrder: sortIndex,
          });
        } catch {
          optionFailures += 1;
          toast.error(
            t('admin.attributeGroups.newGroupDrawer.errors.optionCreateFailed', {
              name: opt.name.trim(),
            }),
          );
        }
        sortIndex += 1;
      }

      toast.success(t('admin.attributeGroups.createSuccess'));
      if (optionFailures === 0) {
        onOpenChange(false);
      } else {
        // Grup oluştu, bazı option'lar başarısız → drawer kapatma; F2c'de
        // edit drawer'da fix edilecek. Şu an sadece kapat.
        onOpenChange(false);
      }
    } catch {
      setError(t('admin.attributeGroups.newGroupDrawer.errors.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitLabel = useMemo(
    () =>
      isBusy
        ? t('admin.attributeGroups.newGroupDrawer.saving')
        : t('admin.attributeGroups.newGroupDrawer.saveButton'),
    [isBusy, t],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !isBusy && onOpenChange(v)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-[640px] flex-col bg-white shadow-xl"
          aria-describedby={undefined}
        >
          <form onSubmit={submit} className="flex h-full flex-col">
            {/* Header */}
            <div
              className="flex items-center justify-between border-b px-5 py-4"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              <DialogPrimitive.Title
                className="text-[16px] font-bold"
                style={{ color: 'var(--v3-text-primary)' }}
              >
                {t('admin.attributeGroups.newGroupDrawer.title')}
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

            {/* Body (scrollable) */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {/* Grup adı */}
              <div className="mb-4">
                <Label htmlFor="newGroup-name" className="mb-1.5 block">
                  {t('admin.attributeGroups.newGroupDrawer.groupNameLabel')}
                  <span style={{ color: 'var(--v3-danger, #dc2626)' }}>*</span>
                </Label>
                <Input
                  id="newGroup-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t(
                    'admin.attributeGroups.newGroupDrawer.groupNamePlaceholder',
                  )}
                  autoFocus
                  disabled={isBusy}
                />
              </div>

              {/* Seçim tipi */}
              <div className="mb-4">
                <Label htmlFor="newGroup-selectionType" className="mb-1.5 block">
                  {t('admin.attributeGroups.newGroupDrawer.selectionTypeLabel')}
                </Label>
                <select
                  id="newGroup-selectionType"
                  value={selectionType}
                  onChange={(e) =>
                    setSelectionType(e.target.value as 'single' | 'multiple')
                  }
                  disabled={isBusy}
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                >
                  <option value="single">
                    {t('admin.attributeGroups.selectionType.single')}
                  </option>
                  <option value="multiple">
                    {t('admin.attributeGroups.selectionType.multiple')}
                  </option>
                </select>
              </div>

              {/* Zorunlu toggle */}
              <div className="mb-5 flex items-center gap-3">
                <input
                  id="newGroup-required"
                  type="checkbox"
                  checked={isRequired}
                  onChange={(e) => setIsRequired(e.target.checked)}
                  disabled={isBusy}
                  className="h-4 w-4"
                />
                <Label htmlFor="newGroup-required" className="cursor-pointer">
                  {t('admin.attributeGroups.newGroupDrawer.isRequiredLabel')}
                </Label>
              </div>

              {/* Options table */}
              <div
                className="overflow-hidden rounded-md border"
                style={{ borderColor: 'var(--v3-border-subtle)' }}
              >
                <div
                  className="grid grid-cols-[2fr_1fr_auto_auto] items-center gap-2 border-b px-3 py-2 text-[11px] font-bold uppercase tracking-wider"
                  style={{
                    background: 'var(--v3-surface-1)',
                    borderColor: 'var(--v3-border-subtle)',
                    color: 'var(--v3-text-muted)',
                  }}
                >
                  <div>
                    {t('admin.attributeGroups.newGroupDrawer.optionNameLabel')}
                  </div>
                  <div>
                    {t('admin.attributeGroups.newGroupDrawer.optionExtraPriceLabel')}
                  </div>
                  <div className="w-20 text-center">
                    {t('admin.attributeGroups.newGroupDrawer.optionDefaultLabel')}
                  </div>
                  <div className="w-9" />
                </div>

                {options.length === 0 && (
                  <div
                    className="px-3 py-4 text-center text-xs"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    —
                  </div>
                )}

                {options.map((opt) => (
                  <div
                    key={opt.tempId}
                    className="grid grid-cols-[2fr_1fr_auto_auto] items-center gap-2 border-b px-3 py-2 last:border-b-0"
                    style={{ borderColor: 'var(--v3-border-subtle)' }}
                  >
                    <Input
                      value={opt.name}
                      onChange={(e) =>
                        handleOptionNameChange(opt.tempId, e.target.value)
                      }
                      placeholder={t(
                        'admin.attributeGroups.newGroupDrawer.optionNameLabel',
                      )}
                      disabled={isBusy}
                      className="h-9"
                    />
                    <div className="relative">
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={opt.extraPriceText}
                        onChange={(e) =>
                          handleOptionPriceChange(opt.tempId, e.target.value)
                        }
                        disabled={isBusy}
                        className="h-9 pr-7"
                      />
                      <span
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                        style={{ color: 'var(--v3-text-muted)' }}
                      >
                        ₺
                      </span>
                    </div>
                    <div className="w-20 text-center">
                      <input
                        type={selectionType === 'single' ? 'radio' : 'checkbox'}
                        name="newGroup-default"
                        checked={opt.isDefault}
                        onChange={(e) =>
                          handleOptionDefaultChange(opt.tempId, e.target.checked)
                        }
                        disabled={isBusy}
                        className="h-4 w-4"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(opt.tempId)}
                      disabled={isBusy}
                      aria-label={t('admin.attributeGroups.deleteButton')}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-red-50 disabled:opacity-50"
                      style={{ color: 'var(--v3-danger, #dc2626)' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleAddOption}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold disabled:opacity-50"
                  style={{ color: 'var(--v3-purple, #7c3aed)' }}
                >
                  <Plus size={14} />
                  {t('admin.attributeGroups.newGroupDrawer.optionAddButton')}
                </button>
              </div>

              {error && (
                <p
                  className="mt-4 text-sm"
                  style={{ color: 'var(--v3-danger, #dc2626)' }}
                >
                  {error}
                </p>
              )}
            </div>

            {/* Footer */}
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
                {t('admin.attributeGroups.newGroupDrawer.cancelButton')}
              </Button>
              <Button
                type="submit"
                disabled={isBusy}
                style={{
                  backgroundColor: 'var(--v3-purple, #7c3aed)',
                  color: '#fff',
                }}
              >
                {submitLabel}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
