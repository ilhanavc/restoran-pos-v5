import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpDown, LayoutGrid, Loader2, Plus, Search, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { AppShell } from '../../components/layout/AppShell';
import { PageHeader } from '../../components/layout/PageHeader';
import { ErrorState } from '../../components/ErrorState';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  useCategoriesAdmin,
  useDeleteCategory,
  type ApiCategory,
} from './menu-categories/api';
import { CategoryListItem } from './menu-categories/components/CategoryListItem';
import { CategoryDrawer } from './menu-categories/components/CategoryDrawer';
import { DeleteCategoryDialog } from './menu-categories/components/DeleteCategoryDialog';
import { CategoryAttributeModal } from './menu-categories/components/CategoryAttributeModal';
import { useProductsAdmin } from './menu-products/api';
import { ProductCard } from './menu-products/components/ProductCard';
import { ReorderProductsModal } from './menu-products/components/ReorderProductsModal';
import { ReorderCategoriesModal } from './menu-categories/components/ReorderCategoriesModal';

/**
 * Menü Tanımları admin sayfası — Sprint 8c PR-D1.
 *
 * V3 paritesi (`MenuSettingsPage.jsx`): 2-pane layout — sol kategori paneli
 * (kategori listesi + sayaç + ekle butonu) + sağ ürün grid (PR-E'de aktif).
 *
 * ADR-011 Amendment 2026-05-01:
 * - Karar 1-3: lucide ikon + 8-renk paleti CategoryListItem'da render edilir.
 * - Karar 4: V3 ölü "0" badge port edilmedi (kullanıcı tıklamasında tepki yok).
 * - Karar 7: Sol kategori paneli boşsa empty state ipucu ("İlk kategoriyi
 *   ekleyin"). Sağ ürün paneli PR-E'ye dek "yapım aşamasında" placeholder.
 *
 * D1 kapsamı: read-only liste + 2-pane iskelet. Drawer (Yeni/Düzenle) +
 * Sil dialog'u D2'de.
 */
export default function MenuDefinitionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const categoriesQuery = useCategoriesAdmin();
  const productsQuery = useProductsAdmin();
  const deleteCategory = useDeleteCategory();

  // Aktif kategori filtresi URL'de (?kategori=) tutulur — ürün ekle/düzenle
  // route'undan dönünce sayfa remount olsa bile kategori korunur. (Yerel useState
  // olsaydı remount'ta null'a = "Tüm Ürünler"e sıfırlanırdı; toplu ürün girişinde
  // her kayıttan sonra kategoriye yeniden gitmek gerekiyordu — bu bug'ın kökü.)
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategoryId = searchParams.get('kategori');
  const setActiveCategoryId = (id: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (id === null) next.delete('kategori');
    else next.set('kategori', id);
    setSearchParams(next, { replace: true });
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiCategory | null>(null);
  const [reorderTarget, setReorderTarget] = useState<ApiCategory | null>(null);
  const [attributeCategory, setAttributeCategory] = useState<ApiCategory | null>(null);
  const [reorderCategoriesOpen, setReorderCategoriesOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const extractError = (err: unknown, fallback: string): string => {
    if (isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string; code?: string } }
        | undefined;
      const code = data?.error?.code;
      if (code === 'MENU_CATEGORY_HAS_PRODUCTS') {
        return t('admin.menuDefinitions.errors.hasProducts');
      }
      return data?.error?.message ?? fallback;
    }
    return fallback;
  };

  const handleNew = () => {
    setEditTarget(null);
    setDrawerOpen(true);
  };

  const handleEdit = (category: ApiCategory) => {
    setEditTarget(category);
    setDrawerOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCategory.mutateAsync(deleteTarget.id);
      toast.success(t('admin.menuDefinitions.deleteSuccess'));
      if (activeCategoryId === deleteTarget.id) {
        setActiveCategoryId(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      toast.error(
        extractError(err, t('admin.menuDefinitions.errors.deleteFailed')),
      );
    }
  };


  const categories = categoriesQuery.data ?? [];
  const products = productsQuery.data ?? [];

  const sortedCategories = useMemo(
    () =>
      [...categories].sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name, 'tr', { sensitivity: 'base' }),
      ),
    [categories],
  );

  const productCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const prod of products) {
      map.set(prod.categoryId, (map.get(prod.categoryId) ?? 0) + 1);
    }
    return map;
  }, [products]);

  const categoryById = useMemo(() => {
    const map = new Map<string, ApiCategory>();
    for (const cat of categories) map.set(cat.id, cat);
    return map;
  }, [categories]);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLocaleLowerCase('tr');
    return products.filter((p) => {
      if (activeCategoryId !== null && p.categoryId !== activeCategoryId) return false;
      if (term && !p.name.toLocaleLowerCase('tr').includes(term)) return false;
      return true;
    });
  }, [products, activeCategoryId, productSearch]);

  const totalCategories = sortedCategories.length;
  const totalProducts = products.length;
  const activeCategoryName = activeCategoryId
    ? categoryById.get(activeCategoryId)?.name ?? '—'
    : t('admin.menuDefinitions.allProducts');
  const visibleCount = filteredProducts.length;

  const handleBack = () => navigate('/dashboard');

  return (
    <AppShell>
      <PageHeader
        title={t('admin.menuDefinitions.title')}
        actions={
          <button
            type="button"
            onClick={handleBack}
            aria-label={t('admin.menuDefinitions.back')}
            className="tables-action-btn inline-flex h-11 items-center gap-2 rounded-xl px-4 transition-all duration-[120ms] hover:[background:var(--v3-surface-2)] hover:[color:var(--v3-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
            style={{
              background: 'var(--v3-surface-1)',
              border: '1px solid var(--v3-border-subtle)',
              color: 'var(--v3-text-secondary)',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            {t('admin.menuDefinitions.back')}
          </button>
        }
      />

      <div className="flex flex-1 min-h-0 gap-4 pl-6 pr-6 pb-6">
        {/* SOL — Kategori paneli (240px sticky-ish, kendi içinde scroll). */}
        <aside
          className="flex w-[260px] shrink-0 flex-col gap-3 rounded-lg p-3"
          style={{
            background: 'var(--v3-surface-1)',
            border: '1px solid var(--v3-border-subtle)',
          }}
        >
          <div className="flex items-center justify-between px-1">
            <span
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--v3-text-muted)' }}
            >
              {t('admin.menuDefinitions.sectionLabel')}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{
                background: 'var(--v3-surface-2)',
                color: 'var(--v3-text-secondary)',
              }}
            >
              {totalCategories}
            </span>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={handleNew}
            className="w-full justify-center gap-1.5"
          >
            <Plus size={16} />
            {t('admin.menuDefinitions.newButton')}
          </Button>

          {sortedCategories.length >= 2 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReorderCategoriesOpen(true)}
              className="w-full justify-center gap-1.5"
            >
              <ArrowUpDown size={15} />
              {t('admin.menuDefinitions.categories.reorder.triggerLabel')}
            </Button>
          )}

          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
            {categoriesQuery.isPending && (
              <div className="flex min-h-[120px] items-center justify-center">
                <Loader2
                  className="h-5 w-5 animate-spin"
                  style={{ color: 'var(--v3-text-muted)' }}
                />
              </div>
            )}

            {categoriesQuery.isError && (
              <ErrorState
                description={t('admin.menuDefinitions.errors.categoriesLoadFailed')}
                onRetry={() => {
                  void categoriesQuery.refetch();
                }}
              />
            )}

            {categoriesQuery.isSuccess && sortedCategories.length === 0 && (
              <div
                className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center"
                style={{
                  borderColor: 'var(--v3-border-subtle)',
                  color: 'var(--v3-text-muted)',
                }}
              >
                <Wrench className="h-6 w-6" strokeWidth={1.5} />
                <p className="text-[12px] leading-snug">
                  {t('admin.menuDefinitions.empty')}
                </p>
              </div>
            )}

            {categoriesQuery.isSuccess &&
              sortedCategories.map((category) => (
                <CategoryListItem
                  key={category.id}
                  category={category}
                  productCount={productCountByCategory.get(category.id) ?? 0}
                  isActive={activeCategoryId === category.id}
                  onClick={() => setActiveCategoryId(category.id)}
                  onEdit={() => handleEdit(category)}
                  onDelete={() => setDeleteTarget(category)}
                  onAddProduct={() =>
                    navigate(`/tanimlamalar/menu-tanimlari/urun/yeni?kategori=${category.id}`)
                  }
                  onReorderProducts={() => setReorderTarget(category)}
                  onAssignAttributes={() => setAttributeCategory(category)}
                />
              ))}
          </div>
        </aside>

        {/* SAĞ — Ürün grid (PR-E aktif). */}
        <section
          className="flex flex-1 flex-col rounded-lg"
          style={{
            background: 'var(--v3-surface-1)',
            border: '1px solid var(--v3-border-subtle)',
          }}
        >
          <header
            className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <div className="flex min-w-0 flex-col">
              <span
                className="truncate text-[15px] font-bold"
                style={{ color: 'var(--v3-text-primary)' }}
              >
                {activeCategoryName}
              </span>
              <span
                className="text-[11px]"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('admin.menuDefinitions.productsCount', {
                  count: activeCategoryId
                    ? productCountByCategory.get(activeCategoryId) ?? 0
                    : totalProducts,
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {activeCategoryId !== null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveCategoryId(null)}
                >
                  {t('admin.menuDefinitions.products.clearFilter')}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  navigate(
                    activeCategoryId
                      ? `/tanimlamalar/menu-tanimlari/urun/yeni?kategori=${activeCategoryId}`
                      : '/tanimlamalar/menu-tanimlari/urun/yeni',
                  )
                }
                disabled={categories.length === 0}
                className="gap-1.5"
              >
                <Plus size={16} />
                {t('admin.menuDefinitions.products.newButton')}
              </Button>
            </div>
          </header>

          <div className="border-b px-5 py-3" style={{ borderColor: 'var(--v3-border-subtle)' }}>
            <div className="relative max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: 'var(--v3-text-muted)' }}
              />
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder={t('admin.menuDefinitions.products.searchPlaceholder')}
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {productsQuery.isPending && (
              <div className="flex min-h-[200px] items-center justify-center">
                <Loader2
                  className="h-6 w-6 animate-spin"
                  style={{ color: 'var(--v3-text-muted)' }}
                />
              </div>
            )}

            {productsQuery.isError && (
              <ErrorState
                description={t('admin.menuDefinitions.errors.productsLoadFailed')}
                onRetry={() => {
                  void productsQuery.refetch();
                }}
              />
            )}

            {productsQuery.isSuccess && filteredProducts.length === 0 && (
              <div className="flex h-full min-h-[300px] items-center justify-center">
                <div className="flex max-w-md flex-col items-center gap-3 text-center">
                  <LayoutGrid
                    className="h-10 w-10"
                    strokeWidth={1.5}
                    style={{ color: 'var(--v3-text-muted)' }}
                  />
                  <p
                    className="text-base font-medium"
                    style={{ color: 'var(--v3-text-primary)' }}
                  >
                    {productSearch.trim() || activeCategoryId !== null
                      ? t('admin.menuDefinitions.products.emptyFiltered')
                      : t('admin.menuDefinitions.products.empty')}
                  </p>
                  {!productSearch.trim() &&
                    activeCategoryId === null &&
                    categories.length > 0 && (
                      <p
                        className="text-sm leading-relaxed"
                        style={{ color: 'var(--v3-text-muted)' }}
                      >
                        {t('admin.menuDefinitions.products.emptyHint')}
                      </p>
                    )}
                  {categories.length === 0 && (
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: 'var(--v3-text-muted)' }}
                    >
                      {t('admin.menuDefinitions.products.needCategoryFirst')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {productsQuery.isSuccess && filteredProducts.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    category={categoryById.get(product.categoryId)}
                    onEdit={() =>
                      navigate(`/tanimlamalar/menu-tanimlari/urun/${product.id}`)
                    }
                  />
                ))}
              </div>
            )}

            {productsQuery.isSuccess && filteredProducts.length > 0 && (
              <p
                className="mt-3 text-[11px]"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('admin.menuDefinitions.products.visibleCount', {
                  visible: visibleCount,
                  total: totalProducts,
                })}
              </p>
            )}
          </div>
        </section>
      </div>

      <CategoryDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        mode={editTarget ? 'edit' : 'create'}
        initialCategory={editTarget ?? undefined}
      />

      <DeleteCategoryDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        categoryName={deleteTarget?.name ?? ''}
        onConfirm={handleDelete}
        isDeleting={deleteCategory.isPending}
      />

      {reorderTarget && (
        <ReorderProductsModal
          open={reorderTarget !== null}
          onOpenChange={(v) => !v && setReorderTarget(null)}
          categoryId={reorderTarget.id}
          categoryName={reorderTarget.name}
          initialProducts={products
            .filter((p) => p.categoryId === reorderTarget.id)
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr'))}
        />
      )}

      <ReorderCategoriesModal
        open={reorderCategoriesOpen}
        onOpenChange={setReorderCategoriesOpen}
        initialCategories={sortedCategories}
      />

      <CategoryAttributeModal
        category={attributeCategory}
        onClose={() => setAttributeCategory(null)}
      />

    </AppShell>
  );
}
