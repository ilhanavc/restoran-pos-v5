import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@restoran-pos/shared-domain';
import type { ApiProduct } from '../../admin/menu-products/api';

interface ProductCardProps {
  product: ApiProduct;
  /** Kart gövdesi: **YENİ satır açar** (parti modeli — ADR-013 Amd2 K1). */
  onAdd: (product: ApiProduct) => void;
  /** Şerit "+": o ürünün **en yeni hızlı-ekleme satırını** büyütür (Amd2 K2). */
  onIncrement: (product: ApiProduct) => void;
  /** Şerit "−": en yeni hızlı-ekleme satırından düşer (LIFO); 0 → satır silinir. */
  onDecrement?: (product: ApiProduct) => void;
  /** Bu üründen sepetteki TOPLAM adet (tüm satırların toplamı — Amd2 K6).
   *  > 0 ise kart border mor + sağ kenarda 46px kırmızı stepper şeridi. */
  pendingQty?: number;
  /**
   * Bu üründen ADİSYONA KAYDEDİLMİŞ adet (S104 — mobil #454 paritesi, ürün
   * sahibi: "adisyonda sayısı girilen ürünler kartta da gözüksün"). Sayaç
   * `saved + pending` gösterir; `−` yalnız sepetteki kısmı düşürür (kayıtlı
   * kalem karttan silinemez → cart.decrementProduct zaten no-op, buton solar).
   */
  savedQty?: number;
}

/**
 * Ürün kartı — v3 paritesi (`OrderScreen.jsx` ProductCard, ekran görüntüsü
 * ekran 2/3 referans).
 *
 * Modlar:
 *   - **idle (qty=0):** beyaz kart + ad + fiyat; tıklama → onAdd (yeni satır).
 *   - **pending (qty>0):** kart border mor accent. Sağ kenarda **46px
 *     dikey kırmızı şerit** açılır:
 *       Üst yarı:  +  → onIncrement (en yeni hızlı-ekleme satırını büyüt)
 *       Orta:      toplam qty rakamı
 *       Alt yarı:  −  → onDecrement (LIFO azalt)
 *     Ana içerik (ad+fiyat) sol tarafta GÖRÜNÜR kalır; sağdan padding artar.
 *     Şerit `stopPropagation` ile parent kart tıklamasından izole.
 *
 * **ADR-013 Amendment 2 (2026-07-22) — parti modeli, mobil ADR-026 Amd3 paritesi:**
 * gövde ile `+` ARTIK FARKLI işler yapar. Gövde her dokunuşta yeni satır açar
 * (Adisyo fişindeki "Lahmacun 1 / 3 / 2"), `+` mevcut partiyi büyütür.
 */
export function ProductCard({
  product,
  onAdd,
  onIncrement,
  onDecrement,
  pendingQty,
  savedQty,
}: ProductCardProps) {
  const { t } = useTranslation();
  const pending = pendingQty ?? 0;
  const saved = savedQty ?? 0;
  // S104 — kartta ADİSYONDAKİ + SEPETTEKİ toplam gösterilir (mobil #454).
  const qty = saved + pending;
  const isPending = qty > 0;
  // `−` yalnız sepetteki kısmı düşürür; kayıtlı-only ise soluk + devre dışı.
  const canDecrement = pending > 0;

  return (
    <div
      className="relative h-[124px] overflow-hidden rounded-lg border transition-all duration-[120ms]"
      style={{
        background: 'var(--v3-surface-1, #FFFFFF)',
        borderColor: isPending
          ? 'var(--v3-purple, #7C5CFA)'
          : 'var(--v3-border-subtle)',
        boxShadow: 'var(--v3-shadow-sm, 0 2px 8px rgba(17, 35, 63, 0.06))',
      }}
    >
      {/* Ana içerik — ad + fiyat. Pending iken sağdan 46px (şerit alanı) reserve. */}
      <button
        type="button"
        onClick={() => onAdd(product)}
        className="flex h-full w-full flex-col justify-between p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            'var(--v3-surface-2, #F1F5FB)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
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
          style={{ color: 'var(--v3-purple, #7C5CFA)' }}
        >
          {formatMoney(product.priceCents)}
        </span>
      </button>

      {/* Sağ kenar dikey stepper şeridi — yalnız pending'de.
          Width 46px, full-height, 3 satır grid (+ / qty / −). */}
      {isPending && (
        <div
          className="absolute inset-y-0 right-0 grid w-[46px] grid-rows-[1fr_auto_1fr] bg-[#dc2626] text-white"
          aria-label={t('order.a11y.quantity', { qty })}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onIncrement(product);
            }}
            aria-label={t('order.a11y.increment')}
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
            disabled={!canDecrement}
            onClick={(e) => {
              e.stopPropagation();
              if (canDecrement && onDecrement) onDecrement(product);
            }}
            aria-label={t('order.a11y.decrement')}
            className="flex items-center justify-center transition-colors hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:bg-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Minus className="h-5 w-5" strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}
