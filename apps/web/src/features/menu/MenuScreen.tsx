import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw } from 'lucide-react';
import { AppShell } from '../../components/layout/AppShell';
import { useCategories, useProducts } from './api';
import { CategoryTabs } from './components/CategoryTabs';
import { ProductCard } from './components/ProductCard';

/**
 * Sprint 8c PR #2 — Menü ekranı (read-only).
 *
 * V3 referansı: client/src/components/orders/OrderScreen.jsx:813 — üst
 * kategori sekmesi + ürün grid. CRUD V5 admin ekranlarında (Sprint 8c PR #5/#6).
 *
 * Layout Tables ekranıyla aynı iskelet: AppShell + page-header + content area.
 * Aside YOK — Paket siparişler aside Tables'a özgü.
 */
export default function MenuScreen() {
  const { t } = useTranslation();

  const categoriesQuery = useCategories();
  const productsQuery = useProducts();

  const [activeCategoryId, setActiveCategoryId] = useState<string | 'all'>('all');

  const categories = categoriesQuery.data ?? [];
  const products = productsQuery.data ?? [];

  // Kategori adlarını ürün kartı için lookup (id → name).
  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  // Tab başlıkları için ürün sayısı (kategori bazında).
  const countsByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      map.set(p.categoryId, (map.get(p.categoryId) ?? 0) + 1);
    }
    return map;
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (activeCategoryId === 'all') return products;
    return products.filter((p) => p.categoryId === activeCategoryId);
  }, [products, activeCategoryId]);

  const handleRefresh = () => {
    void categoriesQuery.refetch();
    void productsQuery.refetch();
  };

  const isPending = categoriesQuery.isPending || productsQuery.isPending;
  const isError = categoriesQuery.isError || productsQuery.isError;

  return (
    <AppShell>
      {/* Page header — Tables ekranı ile aynı dikey ölçüler (pl-[74px], min-h-42, mt-3 mb-[14px]). */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 pl-[74px] pr-6 mt-3 mb-[14px] min-h-[42px]">
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap min-w-0">
          <h1
            className="text-[22px] font-extrabold tracking-tight leading-[1.15]"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {t('menu.title')}
          </h1>
          <div
            className="text-xs tabular-nums"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('menu.summary.totalProducts', { count: products.length })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3.5">
          <button
            type="button"
            onClick={handleRefresh}
            aria-label={t('menu.actions.refresh')}
            className="tables-action-btn inline-flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-[120ms] hover:[background:var(--v3-surface-2)] hover:[color:var(--v3-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
            style={{
              background: 'var(--v3-surface-1)',
              border: '1px solid var(--v3-border-subtle)',
              color: 'var(--v3-text-secondary)',
            }}
          >
            <RefreshCw className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Content area — pt-4 pb-6 px-6 (Tables paritesi, aside yok). */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto pt-4 pb-6 pl-6 pr-6">
          {isPending && (
            <div className="flex min-h-[300px] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-amber-600" />
            </div>
          )}

          {isError && !isPending && (
            <div className="rounded-lg border border-dashed border-red-300 bg-red-50/50 p-12 text-center">
              <p className="text-base font-medium text-red-800">
                {t('common.errorTitle')}
              </p>
              <p className="mt-1 text-sm text-red-700">{t('common.errorBody')}</p>
            </div>
          )}

          {!isPending && !isError && categories.length === 0 && (
            <div className="rounded-lg border border-dashed border-stone-300 bg-white/50 p-12 text-center">
              <p className="text-base font-medium text-foreground">
                {t('menu.empty.noCategories')}
              </p>
            </div>
          )}

          {!isPending && !isError && categories.length > 0 && (
            <>
              <CategoryTabs
                categories={categories}
                activeCategoryId={activeCategoryId}
                onChange={setActiveCategoryId}
                countsByCategory={countsByCategory}
                totalCount={products.length}
              />

              {filteredProducts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-stone-300 bg-white/50 p-12 text-center">
                  <p className="text-base font-medium text-foreground">
                    {t('menu.empty.noProducts')}
                  </p>
                </div>
              ) : (
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                  style={{ gap: '18px' }}
                >
                  {filteredProducts.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      categoryName={categoryNameById.get(product.categoryId) ?? null}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
