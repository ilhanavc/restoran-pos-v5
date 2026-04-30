import { useTranslation } from 'react-i18next';
import type { ApiProduct } from '../api';

interface ProductCardProps {
  product: ApiProduct;
  categoryName: string | null;
}

const CURRENCY_FORMATTER = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
});

/**
 * Sprint 8c PR #2 — Read-only ürün kartı.
 *
 * Tıklama Faz 3'te (sipariş ekleme). Görsel YOK — v3'te de kategoriye göre
 * kart, görsel kullanılmıyor.
 *
 * Para birimi: priceCents INTEGER kuruş; bölme yalnız final formatlamada
 * `priceCents / 100` (CLAUDE.md "Asla float ile para hesaplamak").
 */
export function ProductCard({ product, categoryName }: ProductCardProps) {
  const { t } = useTranslation();
  const isInactive = product.deletedAt !== null;
  const formattedPrice = CURRENCY_FORMATTER.format(product.priceCents / 100);

  return (
    <div
      className={`relative flex flex-col rounded-lg border bg-white transition-shadow ${
        isInactive ? 'opacity-60' : 'hover:shadow-sm'
      }`}
      style={{
        borderColor: 'var(--v3-border-subtle)',
        padding: '16px',
        minHeight: '120px',
      }}
    >
      {isInactive && (
        <span
          className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: 'var(--v3-surface-2)',
            color: 'var(--v3-text-muted)',
          }}
        >
          {t('menu.product.inactive')}
        </span>
      )}

      <h3
        className="font-bold leading-tight"
        style={{
          color: 'var(--v3-text-primary)',
          fontSize: '16px',
          paddingRight: isInactive ? '52px' : '0',
        }}
      >
        {product.name}
      </h3>

      <div className="mt-auto flex items-end justify-between pt-3">
        <span
          className="truncate"
          style={{
            color: 'var(--v3-text-muted)',
            fontSize: '12px',
            maxWidth: '60%',
          }}
        >
          {categoryName ?? ''}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{
            color: 'var(--v3-text-primary)',
            fontSize: '18px',
          }}
        >
          {formattedPrice}
        </span>
      </div>
    </div>
  );
}
