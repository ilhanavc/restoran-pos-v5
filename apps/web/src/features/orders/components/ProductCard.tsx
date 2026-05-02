import { Minus, Plus } from 'lucide-react';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { ApiProduct } from '../../admin/menu-products/api';

interface ProductCardProps {
  product: ApiProduct;
  /** Karta tıklama / + overlay tıklamada çağrılır (qty++ veya qty=1 ile ekle). */
  onSelect: (product: ApiProduct) => void;
  /** Overlay − butonuna tıklamada çağrılır (qty--; 0'a inerse useCart filter'la siler). */
  onDecrement?: (product: ApiProduct) => void;
  /** quantity > 0 ise kart üzerine kırmızı stepper overlay açılır (v3 paritesi). */
  pendingQty?: number;
}

/**
 * Ürün kartı — v3 paritesi (OrderScreen.jsx ProductCard).
 *
 * Modlar:
 *   - **idle (qty=0):** beyaz kart + ad + fiyat; tıklama → onSelect (ekle)
 *   - **pending (qty>0):** kart üzerine kırmızı tam-boy overlay
 *       - Üst yarı: + (large) → onSelect (qty++)
 *       - Orta: qty rakamı
 *       - Alt yarı: − (large) → onDecrement
 *     Kart border'ı mor accent.
 */
export function ProductCard({
  product,
  onSelect,
  onDecrement,
  pendingQty,
}: ProductCardProps) {
  const qty = pendingQty ?? 0;
  const isPending = qty > 0;

  return (
    <div
      className="relative h-[124px] overflow-hidden rounded-lg border bg-white shadow-sm transition-all duration-[120ms]"
      style={{
        borderColor: isPending
          ? 'var(--v3-purple, #7c3aed)'
          : 'var(--v3-border-subtle)',
      }}
    >
      {/* Idle layer (her zaman render — overlay üstüne çıkar) */}
      <button
        type="button"
        onClick={() => onSelect(product)}
        className="flex h-full w-full flex-col justify-between p-4 text-left hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
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

      {/* Stepper overlay (qty>0): kırmızı, kartı tamamen kaplar.
          v3 ekran 2: üst yarı +, orta qty, alt yarı −. */}
      {isPending && (
        <div className="absolute inset-0 grid grid-rows-[1fr_auto_1fr] bg-[#dc2626] text-white">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(product);
            }}
            aria-label="Artır"
            className="flex items-center justify-center text-xl font-extrabold transition-colors hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:bg-[#b91c1c]"
          >
            <Plus className="h-6 w-6" strokeWidth={3} />
          </button>
          <div
            aria-live="polite"
            className="flex items-center justify-center text-2xl font-extrabold tabular-nums"
          >
            {qty}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onDecrement) onDecrement(product);
            }}
            aria-label="Azalt"
            className="flex items-center justify-center text-xl font-extrabold transition-colors hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:bg-[#b91c1c]"
          >
            <Minus className="h-6 w-6" strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}
