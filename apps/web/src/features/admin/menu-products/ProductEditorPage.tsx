import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Layers, Loader2, Plus, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { AttributeGroupAssignment } from './components/AttributeGroupAssignment';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { AppShell } from '../../../components/layout/AppShell';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { useCategoriesAdmin } from '../menu-categories/api';
import {
  useCreateProduct,
  useDeleteProduct,
  useProductsAdmin,
  useUpdateProduct,
  type ApiProduct,
} from './api';

interface ProductEditorPageProps {
  mode: 'create' | 'edit';
}

/**
 * Porsiyon (variant) draft state — backend ProductVariantWriteSchema paritesi.
 * UI'da kullanıcı **tam fiyat** girer; submit sırasında default variant'in
 * fiyatı = ana priceCents kabul edilir, diğerlerinin priceDeltaCents
 * `thisPriceCents - defaultPriceCents` olarak hesaplanır.
 */
interface DraftVariant {
  tempId: string;
  existingId?: string;
  name: string;
  /** Tam fiyat string (TL, virgüllü). */
  priceText: string;
  isDefault: boolean;
}

function makeTempId(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseCents(text: string): number {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

function centsToText(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Ürün detay sayfası — Sprint 8c PR-E2.
 *
 * V3 paritesi `MenuProductEditorPage.jsx` + ADR-011 Amendment 2026-05-01:
 * - Karar 5: Yazıcı dropdown disabled (Phase 3)
 * - Karar 6: Modal/drawer YERİNE route (form-rich CRUD; drawer 480px yetmiyor)
 * - Karar 7: Empty/coming-soon state (porsiyon + özellik grupları)
 *
 * 3 bölüm (V3 paritesi):
 *   1) Genel bilgiler — ad, kategori, açıklama, barkod, menüde aktif, yazıcı
 *   2) Fiyat (basit) — variants PR-E3'e ertelendi
 *   3) Özellik grupları — PR-F3a/E4'e ertelendi
 *
 * Kapsam dışı (kullanıcı talebi): combo menü, ürün görseli.
 */
export default function ProductEditorPage({ mode }: ProductEditorPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const defaultCategoryId = searchParams.get('kategori');

  const productsQuery = useProductsAdmin();
  const categoriesQuery = useCategoriesAdmin();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [barcode, setBarcode] = useState('');
  const [isActive, setIsActive] = useState(true);
  /**
   * Variants her zaman ≥ 1 (V3 paritesi). Yeni ürün create → "Tam" varsayılan
   * otomatik. Edit mode prefill: ürünün variants'ı boşsa "Tam" auto-ekle.
   */
  const [variants, setVariants] = useState<DraftVariant[]>(() => [
    { tempId: makeTempId(), name: 'Tam', priceText: '0,00', isDefault: true },
  ]);
  const [selectedVariantTempId, setSelectedVariantTempId] = useState<string>(
    () => '',
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sortedCategories = useMemo(
    () =>
      [...(categoriesQuery.data ?? [])].sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' }),
      ),
    [categoriesQuery.data],
  );

  const initialProduct: ApiProduct | undefined = useMemo(() => {
    if (mode !== 'edit' || !id) return undefined;
    return productsQuery.data?.find((p) => p.id === id);
  }, [mode, id, productsQuery.data]);

  // Edit mode'da prefill
  useEffect(() => {
    if (mode === 'edit' && initialProduct) {
      setName(initialProduct.name);
      setCategoryId(initialProduct.categoryId);
      setDescription(initialProduct.description ?? '');
      setBarcode(initialProduct.barcode ?? '');
      setIsActive(initialProduct.isActive);
      // Variants prefill — tam fiyat = ana priceCents + delta.
      // V3 paritesi: variants 0 ise "Tam" auto-ekle (eski ürünler).
      const sorted = [...initialProduct.variants].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      let drafts: DraftVariant[];
      if (sorted.length === 0) {
        drafts = [
          {
            tempId: makeTempId(),
            name: 'Tam',
            priceText: centsToText(initialProduct.priceCents),
            isDefault: true,
          },
        ];
      } else {
        drafts = sorted.map((v) => ({
          tempId: makeTempId(),
          existingId: v.id,
          name: v.name,
          priceText: centsToText(initialProduct.priceCents + v.priceDeltaCents),
          isDefault: v.isDefault,
        }));
      }
      setVariants(drafts);
      setSelectedVariantTempId(drafts.find((d) => d.isDefault)?.tempId ?? drafts[0]!.tempId);
    } else if (mode === 'create' && categoryId === '' && sortedCategories.length > 0) {
      setCategoryId(defaultCategoryId ?? sortedCategories[0]?.id ?? '');
    }
  }, [mode, initialProduct, sortedCategories, categoryId, defaultCategoryId]);

  // Create mode — ilk variant'ı seç (component mount sonrası)
  useEffect(() => {
    if (selectedVariantTempId === '' && variants.length > 0) {
      setSelectedVariantTempId(variants[0]!.tempId);
    }
  }, [selectedVariantTempId, variants]);

  // Error toast — sayfanın altındaki inline mesajı kullanıcı kaçırabiliyor;
  // toast aynı anda üst köşeden görünür uyarı verir.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const isBusy =
    isSubmitting ||
    createProduct.isPending ||
    updateProduct.isPending ||
    deleteProduct.isPending;

  const isLoadingData =
    productsQuery.isPending ||
    categoriesQuery.isPending ||
    (mode === 'edit' && productsQuery.isSuccess && initialProduct === undefined);

  const handleBack = () => navigate('/tanimlamalar/menu-tanimlari');

  const handleAddVariant = () => {
    const newVariant: DraftVariant = {
      tempId: makeTempId(),
      name: '',
      priceText: '0,00',
      isDefault: variants.length === 0,
    };
    setVariants((prev) => [...prev, newVariant]);
    setSelectedVariantTempId(newVariant.tempId);
  };

  const handleVariantNameChange = (tempId: string, value: string) => {
    setVariants((prev) =>
      prev.map((v) => (v.tempId === tempId ? { ...v, name: value } : v)),
    );
  };

  const handleVariantPriceChange = (tempId: string, value: string) => {
    setVariants((prev) =>
      prev.map((v) => (v.tempId === tempId ? { ...v, priceText: value } : v)),
    );
  };

  const handleVariantDefaultChange = (tempId: string) => {
    setVariants((prev) =>
      prev.map((v) => ({ ...v, isDefault: v.tempId === tempId })),
    );
  };

  const handleRemoveVariant = (tempId: string) => {
    if (variants.length <= 1) {
      toast.error(t('admin.menuDefinitions.products.errors.variantMinOne'));
      return;
    }
    setVariants((prev) => {
      const next = prev.filter((v) => v.tempId !== tempId);
      if (next.length > 0 && !next.some((v) => v.isDefault)) {
        next[0]!.isDefault = true;
      }
      return next;
    });
    if (selectedVariantTempId === tempId) {
      const remaining = variants.filter((v) => v.tempId !== tempId);
      if (remaining[0]) setSelectedVariantTempId(remaining[0].tempId);
    }
  };

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string; code?: string } }
        | undefined;
      const code = data?.error?.code;
      if (code === 'MENU_PRODUCT_NOT_FOUND') {
        return t('admin.menuDefinitions.products.errors.productNotFound');
      }
      if (code === 'MENU_CATEGORY_NOT_FOUND') {
        return t('admin.menuDefinitions.products.errors.categoryNotFound');
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
      setError(t('admin.menuDefinitions.products.errors.nameRequired'));
      return;
    }
    if (trimmedName.length > 128) {
      setError(t('admin.menuDefinitions.products.errors.nameTooLong'));
      return;
    }
    if (!categoryId) {
      setError(t('admin.menuDefinitions.products.errors.categoryRequired'));
      return;
    }
    // V3 paritesi: variants her zaman ≥ 1. Tam 1 default zorunlu.
    if (variants.length === 0) {
      setError(t('admin.menuDefinitions.products.errors.variantMinOne'));
      return;
    }
    const defaults = variants.filter((v) => v.isDefault);
    if (defaults.length !== 1) {
      setError(t('admin.menuDefinitions.products.errors.variantDefaultRequired'));
      return;
    }
    for (const v of variants) {
      if (!v.name.trim()) {
        setError(t('admin.menuDefinitions.products.errors.variantNameRequired'));
        return;
      }
      const cents = parseCents(v.priceText);
      if (!Number.isFinite(cents) || cents < 0) {
        setError(
          t('admin.menuDefinitions.products.errors.variantInvalidPrice', {
            name: v.name.trim(),
          }),
        );
        return;
      }
    }
    const defaultVariant = defaults[0]!;
    const defaultCents = parseCents(defaultVariant.priceText);
    const resolvedPriceCents = defaultCents;
    const resolvedVariants: Array<{
      id?: string;
      name: string;
      priceDeltaCents: number;
      isDefault: boolean;
      sortOrder: number;
    }> = variants.map((v, sortIdx) => {
      const cents = parseCents(v.priceText);
      const item: {
        id?: string;
        name: string;
        priceDeltaCents: number;
        isDefault: boolean;
        sortOrder: number;
      } = {
        name: v.name.trim(),
        priceDeltaCents: cents - defaultCents,
        isDefault: v.isDefault,
        sortOrder: sortIdx,
      };
      if (v.existingId !== undefined) item.id = v.existingId;
      return item;
    });

    const trimmedBarcode = barcode.trim();
    if (trimmedBarcode.length > 64) {
      setError(t('admin.menuDefinitions.products.errors.barcodeTooLong'));
      return;
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription.length > 1000) {
      setError(t('admin.menuDefinitions.products.errors.descriptionTooLong'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'edit' && initialProduct) {
        await updateProduct.mutateAsync({
          id: initialProduct.id,
          name: trimmedName,
          categoryId,
          priceCents: resolvedPriceCents,
          description: trimmedDescription || null,
          barcode: trimmedBarcode || null,
          isActive,
          variants: resolvedVariants,
        });
        toast.success(t('admin.menuDefinitions.products.editSuccess'));
      } else {
        await createProduct.mutateAsync({
          name: trimmedName,
          categoryId,
          priceCents: resolvedPriceCents,
          description: trimmedDescription || null,
          barcode: trimmedBarcode || null,
          isActive,
          variants: resolvedVariants,
        });
        toast.success(t('admin.menuDefinitions.products.createSuccess'));
      }
      navigate('/tanimlamalar/menu-tanimlari');
    } catch (err) {
      setError(
        extractError(
          err,
          mode === 'edit'
            ? t('admin.menuDefinitions.products.errors.updateFailed')
            : t('admin.menuDefinitions.products.errors.createFailed'),
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!initialProduct) return;
    if (!window.confirm(t('admin.menuDefinitions.products.deleteConfirm', {
      name: initialProduct.name,
    }))) return;
    try {
      await deleteProduct.mutateAsync(initialProduct.id);
      toast.success(t('admin.menuDefinitions.products.deleteSuccess'));
      navigate('/tanimlamalar/menu-tanimlari');
    } catch (err) {
      toast.error(
        extractError(err, t('admin.menuDefinitions.products.errors.deleteFailed')),
      );
    }
  };

  if (isLoadingData) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center">
          <Loader2
            className="h-6 w-6 animate-spin"
            style={{ color: 'var(--v3-text-muted)' }}
          />
        </div>
      </AppShell>
    );
  }

  if (mode === 'edit' && !initialProduct) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center p-10 text-center">
          <div>
            <p
              className="mb-3 text-base font-medium"
              style={{ color: 'var(--v3-text-primary)' }}
            >
              {t('admin.menuDefinitions.products.errors.productNotFound')}
            </p>
            <Button type="button" variant="outline" onClick={handleBack}>
              {t('admin.menuDefinitions.back')}
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const titleText =
    mode === 'edit'
      ? t('admin.menuDefinitions.products.editorTitleEdit')
      : t('admin.menuDefinitions.products.editorTitleCreate');

  return (
    <AppShell>
      <form onSubmit={submit} className="flex h-full flex-col">
        <PageHeader
          title={titleText}
          actions={
            <>
              {mode === 'edit' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDelete}
                  disabled={isBusy}
                  style={{ color: 'var(--v3-danger, #dc2626)' }}
                >
                  {t('admin.menuDefinitions.products.deleteButton')}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isBusy}
                className="gap-2"
              >
                <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} />
                {t('admin.menuDefinitions.back')}
              </Button>
              <Button type="submit" disabled={isBusy} className="gap-2">
                <Save className="h-[18px] w-[18px]" strokeWidth={2} />
                {isBusy
                  ? t('admin.menuDefinitions.products.editor.saving')
                  : t('admin.menuDefinitions.products.editor.saveButton')}
              </Button>
            </>
          }
        />

        {/* Body — 3 card */}
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {/* Genel bilgiler */}
            <section
              className="rounded-lg p-6"
              style={{
                background: 'var(--v3-surface-1)',
                border: '1px solid var(--v3-border-subtle)',
              }}
            >
              <header className="mb-5">
                <h2
                  className="text-[15px] font-bold"
                  style={{ color: 'var(--v3-text-primary)' }}
                >
                  {t('admin.menuDefinitions.products.editor.generalSection')}
                </h2>
                <p
                  className="mt-0.5 text-[12px]"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('admin.menuDefinitions.products.editor.generalHint')}
                </p>
              </header>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-1">
                  <Label htmlFor="product-name" className="mb-1.5 block">
                    {t('admin.menuDefinitions.products.drawer.nameLabel')}
                    <span style={{ color: 'var(--v3-danger, #dc2626)' }}>*</span>
                  </Label>
                  <Input
                    id="product-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('admin.menuDefinitions.products.drawer.namePlaceholder')}
                    autoFocus
                    disabled={isBusy}
                    maxLength={128}
                  />
                </div>

                <div className="sm:col-span-1">
                  <Label htmlFor="product-category" className="mb-1.5 block">
                    {t('admin.menuDefinitions.products.drawer.categoryLabel')}
                    <span style={{ color: 'var(--v3-danger, #dc2626)' }}>*</span>
                  </Label>
                  <select
                    id="product-category"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    disabled={isBusy || sortedCategories.length === 0}
                    className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                    style={{ borderColor: 'var(--v3-border-subtle)' }}
                  >
                    {sortedCategories.length === 0 && (
                      <option value="">
                        {t('admin.menuDefinitions.products.drawer.noCategories')}
                      </option>
                    )}
                    {sortedCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <Label htmlFor="product-description" className="mb-1.5 block">
                    {t('admin.menuDefinitions.products.editor.descriptionLabel')}
                  </Label>
                  <textarea
                    id="product-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('admin.menuDefinitions.products.editor.descriptionPlaceholder')}
                    disabled={isBusy}
                    maxLength={1000}
                    rows={3}
                    className="w-full rounded-md border bg-white px-3 py-2 text-sm resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                    style={{ borderColor: 'var(--v3-border-subtle)' }}
                  />
                </div>

                <div className="sm:col-span-1">
                  <Label htmlFor="product-barcode" className="mb-1.5 block">
                    {t('admin.menuDefinitions.products.editor.barcodeLabel')}
                  </Label>
                  <Input
                    id="product-barcode"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder={t('admin.menuDefinitions.products.editor.barcodePlaceholder')}
                    disabled={isBusy}
                    maxLength={64}
                  />
                </div>

                <div className="sm:col-span-1">
                  <Label className="mb-1.5 block">
                    {t('admin.menuDefinitions.products.editor.printerLabel')}
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

                <div className="sm:col-span-2 flex items-center gap-3 pt-2">
                  <input
                    id="product-isActive"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    disabled={isBusy}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="product-isActive" className="cursor-pointer">
                    {t('admin.menuDefinitions.products.editor.isActiveLabel')}
                  </Label>
                </div>
              </div>
            </section>

            {/* Porsiyon bilgileri — variants editor (V3 paritesi tab pattern) */}
            <section
              className="rounded-lg p-6"
              style={{
                background: 'var(--v3-surface-1)',
                border: '1px solid var(--v3-border-subtle)',
              }}
            >
              <header className="mb-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal
                    className="h-5 w-5"
                    strokeWidth={2}
                    style={{ color: 'var(--v3-text-muted)' }}
                  />
                  <div>
                    <h2
                      className="text-[15px] font-bold"
                      style={{ color: 'var(--v3-text-primary)' }}
                    >
                      {t('admin.menuDefinitions.products.editor.portionSection')}
                    </h2>
                    <p
                      className="mt-0.5 text-[12px]"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t('admin.menuDefinitions.products.editor.portionHint')}
                    </p>
                  </div>
                </div>
              </header>

              {/* Tab list — variant pill'leri + "+ Porsiyon ekle" */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {variants.map((v) => {
                  const isSelected = selectedVariantTempId === v.tempId;
                  const label = v.name.trim() || t('admin.menuDefinitions.products.editor.portionUnnamed');
                  return (
                    <button
                      key={v.tempId}
                      type="button"
                      onClick={() => setSelectedVariantTempId(v.tempId)}
                      disabled={isBusy}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                      style={{
                        background: isSelected ? '#ea580c14' : 'var(--v3-surface-1)',
                        borderColor: isSelected ? '#ea580c' : 'var(--v3-border-subtle)',
                        color: isSelected ? '#ea580c' : 'var(--v3-text-primary)',
                      }}
                    >
                      {label}
                      {v.isDefault && (
                        <span
                          aria-hidden
                          className="text-[10px] uppercase tracking-wide"
                          style={{ color: 'var(--v3-text-muted)' }}
                        >
                          ★
                        </span>
                      )}
                    </button>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddVariant}
                  disabled={isBusy}
                  className="gap-1.5"
                >
                  <Plus size={14} />
                  {t('admin.menuDefinitions.products.editor.portionAdd')}
                </Button>
              </div>

              {/* Seçili variant detay alanı */}
              {(() => {
                const selected =
                  variants.find((v) => v.tempId === selectedVariantTempId) ?? variants[0];
                if (!selected) return null;
                return (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr_auto]">
                    <div>
                      <Label
                        htmlFor={`variant-name-${selected.tempId}`}
                        className="mb-1.5 block"
                      >
                        {t('admin.menuDefinitions.products.editor.portionNameColumn')}
                      </Label>
                      <Input
                        id={`variant-name-${selected.tempId}`}
                        value={selected.name}
                        onChange={(e) =>
                          handleVariantNameChange(selected.tempId, e.target.value)
                        }
                        placeholder={t(
                          'admin.menuDefinitions.products.editor.portionNamePlaceholder',
                        )}
                        disabled={isBusy}
                        maxLength={64}
                      />
                    </div>
                    <div>
                      <Label
                        htmlFor={`variant-price-${selected.tempId}`}
                        className="mb-1.5 block"
                      >
                        {t('admin.menuDefinitions.products.editor.portionPriceColumn')}
                      </Label>
                      <div className="relative">
                        <Input
                          id={`variant-price-${selected.tempId}`}
                          type="text"
                          inputMode="decimal"
                          value={selected.priceText}
                          onChange={(e) =>
                            handleVariantPriceChange(selected.tempId, e.target.value)
                          }
                          disabled={isBusy}
                          className="pr-7"
                        />
                        <span
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                          style={{ color: 'var(--v3-text-muted)' }}
                        >
                          ₺
                        </span>
                      </div>
                    </div>
                    <div className="flex items-end gap-2 sm:col-span-1">
                      <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-[13px]" style={{ borderColor: 'var(--v3-border-subtle)' }}>
                        <input
                          type="radio"
                          name="variant-default-selected"
                          checked={selected.isDefault}
                          onChange={() => handleVariantDefaultChange(selected.tempId)}
                          disabled={isBusy}
                          className="h-4 w-4"
                        />
                        <span style={{ color: 'var(--v3-text-primary)' }}>
                          {t('admin.menuDefinitions.products.editor.portionDefaultLabel')}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRemoveVariant(selected.tempId)}
                        disabled={isBusy || variants.length <= 1}
                        aria-label={t('admin.menuDefinitions.products.editor.portionRemove')}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ color: 'var(--v3-danger, #dc2626)' }}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                );
              })()}
            </section>

            {/* Özellik grupları — placeholder */}
            <section
              className="rounded-lg p-6"
              style={{
                background: 'var(--v3-surface-1)',
                border: '1px solid var(--v3-border-subtle)',
              }}
            >
              <header className="mb-4 flex items-center gap-2">
                <Layers
                  className="h-5 w-5"
                  strokeWidth={2}
                  style={{ color: 'var(--v3-text-muted)' }}
                />
                <div>
                  <h2
                    className="text-[15px] font-bold"
                    style={{ color: 'var(--v3-text-primary)' }}
                  >
                    {t('admin.menuDefinitions.products.editor.attributesSection')}
                  </h2>
                  <p
                    className="mt-0.5 text-[12px]"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {t('admin.menuDefinitions.products.editor.attributesHint')}
                  </p>
                </div>
              </header>
              {mode === 'edit' && initialProduct ? (
                <AttributeGroupAssignment productId={initialProduct.id} />
              ) : (
                <div
                  className="rounded-md border border-dashed p-4 text-center"
                  style={{ borderColor: 'var(--v3-border-subtle)' }}
                >
                  <p
                    className="text-[13px]"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    {t('admin.menuDefinitions.products.editor.attributesAfterCreate')}
                  </p>
                </div>
              )}
            </section>

            {error && (
              <div
                className="rounded-md p-3 text-sm"
                style={{
                  background: '#fef2f2',
                  color: 'var(--v3-danger, #dc2626)',
                }}
                role="alert"
              >
                {error}
              </div>
            )}
          </div>
        </div>
      </form>
    </AppShell>
  );
}
