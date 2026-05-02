import { Minus, Plus } from 'lucide-react';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { ApiProduct } from '../../admin/menu-products/api';

interface ProductCardProps {
  product: ApiProduct;
  /** Ana karta tıklama → onSelect (qty=0 ise ekle, qty>0 ise +1). */
  onSelect: (product: ApiProduct) => void;
  /** Sağ kenardaki kırmızı şeritten − butonuna tıklamada (qty--; 0 → useCart filter siler). */
  onDecrement?: (product: ApiProduct) => void;
  /** quantity > 0 ise kart border mor + sağ kenarda 46px kırmızı stepper şeridi. */
  pendingQty?: number;
}

/**
 * Ürün kartı — v3 paritesi (`OrderScreen.jsx` ProductCard, ekran görüntüsü
 * ekran 2/3 referans).
 *
 * Modlar:
 *   - **idle (qty=0):** beyaz kart + ad + fiyat; tıklama → onSelect (ekle).
 *   - **pending (qty>0):** kart border mor accent. Sağ kenarda **46px
 *     dikey kırmızı şerit** açılır:
 *       Üst yarı:  +  → onSelect (qty++)
 *       Orta:      qty rakamı
 *       Alt yarı:  −  → onDecrement
 *     Ana içerik (ad+fiyat) sol tarafta GÖRÜNÜR kalır; sağdan padding artar.
 *     Şerit `stopPropagation` ile parent kart tıklamasından izole.
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
      {/* Ana içerik — ad + fiyat. Pending iken sağdan 46px (şerit alanı) reserve. */}
      <button
        type="button"
        onClick={() => onSelect(product)}
        className="flex h-full w-full flex-col justify-between p-4 text-left hover:bg-stone-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
        style={{ paddingRight: isPending ? 58 : undefined }}
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

      {/* Sağ kenar dikey stepper şeridi — yalnız pending'de.
          Width 46px, full-height, 3 satır grid (+ / qty / −). */}
      {isPending && (
        <div
          className="absolute inset-y-0 right-0 grid w-[46px] grid-rows-[1fr_auto_1fr] bg-[#dc2626] text-white"
          aria-label={`Adet: ${qty}`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(product);
            }}
            aria-label="Artır"
            className="flex items-center justify-center transition-colors hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:bg-[#b91c1c]"
          >
            <Plus className="h-5 w-5" strokeWidth={3} />
          </button>
          <div
            aria-live="polite"
            className="flex items-center justify-center px-1 py-0.5 text-[15px] font-extrabold tabular-nums"
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
            className="flex items-center justify-center transition-colors hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:bg-[#b91c1c]"
          >
            <Minus className="h-5 w-5" strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}
