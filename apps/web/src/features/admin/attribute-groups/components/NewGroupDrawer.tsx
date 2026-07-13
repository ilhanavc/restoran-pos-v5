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
  useUpdateAttributeGroup,
  useUpdateAttributeOption,
  useDeleteAttributeOption,
  type ApiAttributeGroup,
  type ApiAttributeOption,
} from '../api';

interface DraftOption {
  tempId: string;
  /** Var olan option'ın id'si (edit mode'da). undefined → yeni eklenmiş. */
  existingId?: string;
  name: string;
  /** Free-form input; parsed at submit (TL → kuruş). */
  extraPriceText: string;
  /** Edit mode için orijinal kuruş değeri (diff için). */
  originalCents?: number;
  isDefault: boolean;
  /** Edit mode için orijinal isDefault (diff için). */
  originalIsDefault?: boolean;
  /** Edit mode için orijinal name (diff için). */
  originalName?: string;
}

interface NewGroupDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: 'create' | 'edit';
  initialGroup?: ApiAttributeGroup;
  initialOptions?: ApiAttributeOption[];
  /** "Yeni özellik ekle" linkinden açıldıysa true → drawer açılırken boş satır eklenir. */
  startWithEmptyOptionRow?: boolean;
}

function makeTempId(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function centsToText(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * "Yeni Grup Tanımla" / "Grubu Düzenle" drawer — Sprint 8c PR-F2b + F2c.
 *
 * Mode:
 *   - create (default): boş form, POST /attribute-groups + POST options
 *   - edit: initialGroup/initialOptions ile prefill, PATCH group + diff
 *     options (POST yeni, PATCH değişen, DELETE silinmiş).
 *
 * Save flow (transaction yok — v5.1 borç):
 *   1) Group create/update
 *   2) Option diff sequential (yeni > değişmiş > silinmiş)
 *   3) Bir option fail → toast, devam et
 */
export function NewGroupDrawer({
  open,
  onOpenChange,
  mode = 'create',
  initialGroup,
  initialOptions,
  startWithEmptyOptionRow,
}: NewGroupDrawerProps) {
  const { t } = useTranslation();

  const createGroup = useCreateAttributeGroup();
  const createOption = useCreateAttributeOption();
  const updateGroup = useUpdateAttributeGroup();
  const updateOption = useUpdateAttributeOption();
  const deleteOption = useDeleteAttributeOption();

  const [name, setName] = useState('');
  const [selectionType, setSelectionType] = useState<'single' | 'multiple'>(
    'single',
  );
  const [isRequired, setIsRequired] = useState(false);
  const [options, setOptions] = useState<DraftOption[]>([]);
  /** Edit mode'da silinen var olan option'lar (id listesi). */
  const [deletedOptionIds, setDeletedOptionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state every time the drawer opens.
  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && initialGroup) {
      setName(initialGroup.name);
      setSelectionType(initialGroup.selection_type);
      setIsRequired(initialGroup.is_required);
      const drafts: DraftOption[] = (initialOptions ?? []).map((opt) => ({
        tempId: makeTempId(),
        existingId: opt.id,
        name: opt.name,
        extraPriceText: centsToText(opt.extra_price_cents),
        originalCents: opt.extra_price_cents,
        isDefault: opt.is_default,
        originalIsDefault: opt.is_default,
        originalName: opt.name,
      }));
      if (startWithEmptyOptionRow) {
        drafts.push({
          tempId: makeTempId(),
          name: '',
          extraPriceText: '0',
          isDefault: false,
        });
      }
      setOptions(drafts);
    } else {
      setName('');
      setSelectionType('single');
      setIsRequired(false);
      setOptions([]);
    }
    setDeletedOptionIds([]);
    setError(null);
    setIsSubmitting(false);
  }, [open, mode, initialGroup, initialOptions, startWithEmptyOptionRow]);

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

  const isBusy =
    isSubmitting ||
    createGroup.isPending ||
    createOption.isPending ||
    updateGroup.isPending ||
    updateOption.isPending ||
    deleteOption.isPending;

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
    setOptions((prev) => {
      const target = prev.find((o) => o.tempId === tempId);
      if (target?.existingId) {
        setDeletedOptionIds((ids) => [...ids, target.existingId!]);
      }
      return prev.filter((o) => o.tempId !== tempId);
    });
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
          return { ...o, isDefault: o.tempId === tempId ? checked : false };
        }
        return o.tempId === tempId ? { ...o, isDefault: checked } : o;
      }),
    );
  };

  const handleClose = () => {
    if (!isBusy) onOpenChange(false);
  };

  const submitCreate = async (trimmedName: string) => {
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
    onOpenChange(false);
    void optionFailures;
  };

  const submitEdit = async (trimmedName: string) => {
    if (!initialGroup) return;

    // Group diff
    const groupPatch: Parameters<typeof updateGroup.mutateAsync>[0] = {
      id: initialGroup.id,
    };
    let groupChanged = false;
    if (trimmedName !== initialGroup.name) {
      groupPatch.name = trimmedName;
      groupChanged = true;
    }
    if (selectionType !== initialGroup.selection_type) {
      groupPatch.selectionType = selectionType;
      groupChanged = true;
    }
    if (isRequired !== initialGroup.is_required) {
      groupPatch.isRequired = isRequired;
      groupChanged = true;
    }

    if (groupChanged) {
      try {
        await updateGroup.mutateAsync(groupPatch);
      } catch {
        toast.error(t('admin.attributeGroups.errors.updateFailed'));
        return;
      }
    }

    // Options diff
    let sortIndex = 0;
    for (const opt of options) {
      const cents = Math.round(Number(opt.extraPriceText.replace(',', '.')) * 100);
      const safeCents = Number.isFinite(cents) && cents >= 0 ? cents : 0;
      const trimmedOptName = opt.name.trim();

      if (!opt.existingId) {
        // Yeni option
        try {
          await createOption.mutateAsync({
            groupId: initialGroup.id,
            name: trimmedOptName,
            extraPriceCents: safeCents,
            isDefault: opt.isDefault,
            sortOrder: sortIndex,
          });
        } catch {
          toast.error(
            t('admin.attributeGroups.newGroupDrawer.errors.optionCreateFailed', {
              name: trimmedOptName,
            }),
          );
        }
      } else {
        // Var olan option — diff
        const patch: Parameters<typeof updateOption.mutateAsync>[0] = {
          groupId: initialGroup.id,
          optionId: opt.existingId,
        };
        let changed = false;
        if (trimmedOptName !== (opt.originalName ?? '')) {
          patch.name = trimmedOptName;
          changed = true;
        }
        if (safeCents !== (opt.originalCents ?? 0)) {
          patch.extraPriceCents = safeCents;
          changed = true;
        }
        if (opt.isDefault !== (opt.originalIsDefault ?? false)) {
          patch.isDefault = opt.isDefault;
          changed = true;
        }
        if (changed) {
          try {
            await updateOption.mutateAsync(patch);
          } catch {
            toast.error(t('admin.attributeGroups.errors.optionUpdateFailed'));
          }
        }
      }
      sortIndex += 1;
    }

    // Silinmiş option'lar
    for (const id of deletedOptionIds) {
      try {
        await deleteOption.mutateAsync({ groupId: initialGroup.id, optionId: id });
      } catch {
        toast.error(t('admin.attributeGroups.errors.optionDeleteFailed'));
      }
    }

    toast.success(t('admin.attributeGroups.editSuccess'));
    onOpenChange(false);
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
      if (mode === 'edit') {
        await submitEdit(trimmedName);
      } else {
        await submitCreate(trimmedName);
      }
    } catch {
      setError(
        mode === 'edit'
          ? t('admin.attributeGroups.errors.updateFailed')
          : t('admin.attributeGroups.newGroupDrawer.errors.createFailed'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const titleText =
    mode === 'edit'
      ? t('admin.attributeGroups.editDrawer.title')
      : t('admin.attributeGroups.newGroupDrawer.title');

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
                        {t('common.currencySymbol')}
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
