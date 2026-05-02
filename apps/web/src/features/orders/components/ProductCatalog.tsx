import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useCategoriesAdmin } from '../../admin/menu-categories/api';
import { useProductsAdmin, type ApiProduct } from '../../admin/menu-products/api';
import { CategoryTabs } from './CategoryTabs';
import { ProductCard } from './ProductCard';

interface ProductCatalogProps {
  /** Arama terimi (header input'undan gelir). Boş = filtre yok. */
  searchTerm: string;
  /** null = Tümü. */
  activeCategoryId: string | null;
  onChangeCategory: (categoryId: string | null) => void;
  /** Kart tıklama / + overlay → ekle veya qty++. */
  onSelectProduct: (product: ApiProduct) => void;
  /** PR-3 stepper overlay − butonu → qty-- (0'a inerse useCart filter'la siler). */
  onDecrementProduct?: (product: ApiProduct) => void;
  /** ProductCard pendingQty lookup (qty>0 → kırmızı stepper overlay). */
  pendingQtyByProductId?: Map<string, number>;
}

/**
 * Sol panel — kategori sekmeleri + ürün kartları grid + arama filter.
 * v3 paritesi: OrderScreen.jsx orta sol bölgesi.
 *
 * Filtre stratejisi:
 *   - active=true ürünler (admin pasif yaptıklarını gösterme)
 *   - searchTerm boş değilse name lower-case includes
 *   - activeCategoryId !== null ise category_id eşleşmesi
 *   - sort_order ASC, ad ASC tie-breaker
 *
 * Hooks reuse: admin/menu-categories + admin/menu-products query'leri
 * (aynı queryKey). Ayrı endpoint açmıyor.
 */
export function ProductCatalog({
  searchTerm,
  activeCategoryId,
  onChangeCategory,
  onSelectProduct,
  onDecrementProduct,
  pendingQtyByProductId,
}: ProductCatalogProps) {
  const { t } = useTranslation();

  const categoriesQuery = useCategoriesAdmin();
  const productsQuery = useProductsAdmin();

  const products = productsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLocaleLowerCase('tr');
    return products
      .filter((p) => p.isActive)
      .filter((p) =>
        activeCategoryId === null ? true : p.categoryId === activeCategoryId,
      )
      .filter((p) =>
        q === '' ? true : p.name.toLocaleLowerCase('tr').includes(q),
      )
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr'),
      );
  }, [products, activeCategoryId, searchTerm]);

  const isPending = categoriesQuery.isPending || productsQuery.isPending;
  const isError = categoriesQuery.isError || productsQuery.isError;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CategoryTabs
        categories={categories}
        activeCategoryId={activeCategoryId}
        onChange={onChangeCategory}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {isPending && (
          <div className="flex min-h-[200px] items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin"
              style={{ color: 'var(--v3-text-muted)' }}
            />
          </div>
        )}

        {isError && (
          <div
            className="rounded-md border border-dashed p-8 text-center text-sm"
            style={{
              borderColor: 'var(--v3-danger, #dc2626)',
              color: 'var(--v3-danger, #dc2626)',
            }}
          >
            {t('order.catalog.loadFailed')}
          </div>
        )}

        {!isPending && !isError && filteredProducts.length === 0 && (
          <div
            className="rounded-md border border-dashed p-12 text-center text-sm"
            style={{
              borderColor: 'var(--v3-border-subtle)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {searchTerm.trim() !== ''
              ? t('order.catalog.noSearchResults')
              : t('order.catalog.empty')}
          </div>
        )}

        {!isPending && !isError && filteredProducts.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((product) => {
              const qty = pendingQtyByProductId?.get(product.id);
              return (
                <ProductCard
                  key={product.id}
                  product={product}
                  onSelect={onSelectProduct}
                  {...(onDecrementProduct ? { onDecrement: onDecrementProduct } : {})}
                  {...(qty !== undefined ? { pendingQty: qty } : {})}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
