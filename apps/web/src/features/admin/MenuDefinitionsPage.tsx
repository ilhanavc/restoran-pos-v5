import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LayoutGrid, Loader2, Plus, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/button';
import {
  useCategoriesAdmin,
  useDeleteCategory,
  useProductsForCategoryCount,
  type ApiCategory,
} from './menu-categories/api';
import { CategoryListItem } from './menu-categories/components/CategoryListItem';
import { CategoryDrawer } from './menu-categories/components/CategoryDrawer';
import { DeleteCategoryDialog } from './menu-categories/components/DeleteCategoryDialog';

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
  const productsQuery = useProductsForCategoryCount();
  const deleteCategory = useDeleteCategory();

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ApiCategory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiCategory | null>(null);

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
      map.set(prod.category_id, (map.get(prod.category_id) ?? 0) + 1);
    }
    return map;
  }, [products]);

  const totalCategories = sortedCategories.length;
  const totalProducts = products.length;

  const handleBack = () => navigate('/dashboard');

  return (
    <AppShell>
      {/* Header — Tables/Areas sayfasıyla aynı offsetler (V3 paritesi). */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <h1
          className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('admin.menuDefinitions.title')}
        </h1>
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
      </div>

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

          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
            {categoriesQuery.isPending && (
              <div className="flex min-h-[120px] items-center justify-center">
                <Loader2
                  className="h-5 w-5 animate-spin"
                  style={{ color: 'var(--v3-text-muted)' }}
                />
              </div>
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
                />
              ))}
          </div>
        </aside>

        {/* SAĞ — Ürün grid placeholder (PR-E'de aktif olacak). */}
        <section
          className="flex flex-1 flex-col rounded-lg"
          style={{
            background: 'var(--v3-surface-1)',
            border: '1px solid var(--v3-border-subtle)',
          }}
        >
          <header className="flex items-center justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--v3-border-subtle)' }}>
            <div className="flex min-w-0 flex-col">
              <span
                className="truncate text-[15px] font-bold"
                style={{ color: 'var(--v3-text-primary)' }}
              >
                {activeCategoryId
                  ? sortedCategories.find((c) => c.id === activeCategoryId)?.name ?? '—'
                  : t('admin.menuDefinitions.allProducts')}
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
          </header>

          <div className="flex flex-1 items-center justify-center p-10">
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
                {t('admin.menuDefinitions.rightPanelTitle')}
              </p>
              <p
                className="text-sm leading-relaxed"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {t('admin.menuDefinitions.rightPanelBody')}
              </p>
            </div>
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
    </AppShell>
  );
}
