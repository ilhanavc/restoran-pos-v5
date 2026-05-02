import { formatMoney } from '@restoran-pos/shared-domain';
import type { ApiProduct } from '../../admin/menu-products/api';

interface ProductCardProps {
  product: ApiProduct;
  /** PR-3 (useCart) tıklamada qty stepper overlay açar; PR-1+2 no-op. */
  onSelect: (product: ApiProduct) => void;
  /** PR-3'te quantity > 0 ise mor accent + qty stepper overlay göster. */
  pendingQty?: number;
}

/**
 * Ürün kartı — v3 paritesi (OrderScreen.jsx ProductCard):
 * - Beyaz arkaplan, ince border, köşe yuvarlak
 * - Üstte ad (uppercase, bold), altta fiyat (mor, bold)
 * - Hover hafif elevation
 * - Tıklama PR-3'te qty stepper overlay açar (kırmızı + / qty / − üst üste).
 */
export function ProductCard({ product, onSelect, pendingQty }: ProductCardProps) {
  const isPending = (pendingQty ?? 0) > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      className="relative flex h-[124px] flex-col justify-between rounded-lg border bg-white p-4 text-left shadow-sm transition-all duration-[120ms] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
      style={{
        borderColor: isPending
          ? 'var(--v3-purple, #7c3aed)'
          : 'var(--v3-border-subtle)',
      }}
    >
      <span
        className="line-clamp-2 text-[14px] font-bold uppercase tracking-tight"
        style={{ color: 'var(--v3-text-primary)' }}
      >
        {product.name}
      </span>
      <span
        className="text-[15px] font-extrabold tabular-nums"
        style={{ color: 'var(--v3-purple, #7c3aed)' }}
      >
        {formatMoney(product.priceCents)}
      </span>
    </button>
  );
}
