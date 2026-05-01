import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import type { ApiProduct } from '../api';
import type { ApiCategory } from '../../menu-categories/api';

interface ProductCardProps {
  product: ApiProduct;
  category: ApiCategory | undefined;
  onEdit?: () => void;
  onDelete?: () => void;
}

/**
 * Ürün grid kartı — Sprint 8c PR-E.
 *
 * V3 paritesi `MenuSettingsPage.jsx` ürün kartı + ADR-011 Amendment 2026-05-01:
 * - Karar 4: V3 ölü "0" badge port edilmedi
 * - Kategori chip kategori rengi ile boyanır (Karar 3 paleti)
 *
 * Layout: başlık + kategori chip + fiyat (sağ alt). Hover'da subtle lift.
 */
export function ProductCard({ product, category, onEdit, onDelete }: ProductCardProps) {
  const { t } = useTranslation();
  const priceFormatted = new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  }).format(product.price_cents / 100);

  const categoryColor = category?.color ?? '#71717a';
  const categoryName = category?.name ?? '—';

  return (
    <div
      className="group relative flex flex-col gap-3 rounded-lg border bg-white p-4 transition-all duration-[120ms] hover:-translate-y-0.5 hover:shadow-sm"
      style={{ borderColor: 'var(--v3-border-subtle)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className="line-clamp-2 flex-1 text-[14px] font-bold uppercase leading-tight"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {product.name}
        </h3>
        {(onEdit || onDelete) && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 focus-within:opacity-100">
            {onEdit && (
              <button
                type="button"
                aria-label={t('admin.menuDefinitions.products.editProduct')}
                onClick={onEdit}
                className="flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-[120ms] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:opacity-100"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                <Pencil className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                aria-label={t('admin.menuDefinitions.products.deleteProduct')}
                onClick={onDelete}
                className="flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-[120ms] hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:opacity-100"
                style={{ color: 'var(--v3-danger, #dc2626)' }}
              >
                <Trash2 className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={{
            background: `${categoryColor}1f`,
            color: categoryColor,
          }}
        >
          {categoryName}
        </span>
        <span
          className="text-[15px] font-bold"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {priceFormatted}
        </span>
      </div>
    </div>
  );
}
