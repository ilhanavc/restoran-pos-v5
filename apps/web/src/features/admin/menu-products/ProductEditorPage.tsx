import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Layers, Loader2, Save, SlidersHorizontal, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { AppShell } from '../../../components/layout/AppShell';
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
  const [priceText, setPriceText] = useState('0,00');
  const [description, setDescription] = useState('');
  const [barcode, setBarcode] = useState('');
  const [isActive, setIsActive] = useState(true);
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
      setPriceText((initialProduct.priceCents / 100).toFixed(2).replace('.', ','));
      setDescription(initialProduct.description ?? '');
      setBarcode(initialProduct.barcode ?? '');
      setIsActive(initialProduct.isActive);
    } else if (mode === 'create' && categoryId === '' && sortedCategories.length > 0) {
      setCategoryId(defaultCategoryId ?? sortedCategories[0]?.id ?? '');
    }
  }, [mode, initialProduct, sortedCategories, categoryId, defaultCategoryId]);

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
    const priceCents = Math.round(Number(priceText.replace(',', '.')) * 100);
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError(t('admin.menuDefinitions.products.errors.invalidPrice'));
      return;
    }
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
          priceCents,
          description: trimmedDescription || null,
          barcode: trimmedBarcode || null,
          isActive,
        });
        toast.success(t('admin.menuDefinitions.products.editSuccess'));
      } else {
        await createProduct.mutateAsync({
          name: trimmedName,
          categoryId,
          priceCents,
          description: trimmedDescription || null,
          barcode: trimmedBarcode || null,
          isActive,
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
        {/* Header */}
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
          <h1
            className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {titleText}
          </h1>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

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

            {/* Fiyat */}
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
                  {t('admin.menuDefinitions.products.editor.priceSection')}
                </h2>
                <p
                  className="mt-0.5 text-[12px]"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('admin.menuDefinitions.products.editor.priceHint')}
                </p>
              </header>

              <div className="max-w-xs">
                <Label htmlFor="product-price" className="mb-1.5 block">
                  {t('admin.menuDefinitions.products.drawer.priceLabel')}
                  <span style={{ color: 'var(--v3-danger, #dc2626)' }}>*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="product-price"
                    type="text"
                    inputMode="decimal"
                    value={priceText}
                    onChange={(e) => setPriceText(e.target.value)}
                    disabled={isBusy}
                    className="pr-8"
                  />
                  <span
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: 'var(--v3-text-muted)' }}
                  >
                    ₺
                  </span>
                </div>
              </div>
            </section>

            {/* Porsiyon — placeholder */}
            <section
              className="rounded-lg p-6"
              style={{
                background: 'var(--v3-surface-1)',
                border: '1px solid var(--v3-border-subtle)',
              }}
            >
              <header className="mb-3 flex items-center gap-2">
                <SlidersHorizontal
                  className="h-5 w-5"
                  strokeWidth={2}
                  style={{ color: 'var(--v3-text-muted)' }}
                />
                <h2
                  className="text-[15px] font-bold"
                  style={{ color: 'var(--v3-text-primary)' }}
                >
                  {t('admin.menuDefinitions.products.editor.portionSection')}
                </h2>
              </header>
              <div className="flex items-center gap-3 rounded-md border border-dashed p-4" style={{ borderColor: 'var(--v3-border-subtle)' }}>
                <Wrench
                  className="h-5 w-5 shrink-0"
                  strokeWidth={1.5}
                  style={{ color: 'var(--v3-text-muted)' }}
                />
                <p
                  className="text-[13px] leading-relaxed"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('admin.menuDefinitions.products.editor.portionComing')}
                </p>
              </div>
            </section>

            {/* Özellik grupları — placeholder */}
            <section
              className="rounded-lg p-6"
              style={{
                background: 'var(--v3-surface-1)',
                border: '1px solid var(--v3-border-subtle)',
              }}
            >
              <header className="mb-3 flex items-center gap-2">
                <Layers
                  className="h-5 w-5"
                  strokeWidth={2}
                  style={{ color: 'var(--v3-text-muted)' }}
                />
                <h2
                  className="text-[15px] font-bold"
                  style={{ color: 'var(--v3-text-primary)' }}
                >
                  {t('admin.menuDefinitions.products.editor.attributesSection')}
                </h2>
              </header>
              <div className="flex items-center gap-3 rounded-md border border-dashed p-4" style={{ borderColor: 'var(--v3-border-subtle)' }}>
                <Wrench
                  className="h-5 w-5 shrink-0"
                  strokeWidth={1.5}
                  style={{ color: 'var(--v3-text-muted)' }}
                />
                <p
                  className="text-[13px] leading-relaxed"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  {t('admin.menuDefinitions.products.editor.attributesComing')}
                </p>
              </div>
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
