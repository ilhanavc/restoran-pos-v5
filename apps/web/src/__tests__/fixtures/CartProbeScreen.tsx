/**
 * `OrderScreenPage` yerine geçen test sondası (probe) — router remount sözleşmesi.
 *
 * Gerçek sipariş ekranı react-query, i18n, auth store, socket ve onlarca API
 * çağrısı ister; router'ın "her navigasyonda TAZE instance" garantisini
 * doğrulamak için bunların hiçbirine ihtiyaç yok. Sondanın tek işi, gerçek
 * sepetin sahip olduğu KRİTİK özelliği taşımak:
 *
 *   `useOrderCart.ts:133` → `useState<CartItem[]>([])`
 *   yani sepet Zustand DEĞİL, component instance'ına bağlı LOCAL state
 *   (ADR-013 §1 "saf local state").
 *
 * Bu yüzden sonda da düz `useState` kullanır. Router instance'ı yeniden
 * yaratmazsa sonda da sepetini korur — tıpkı canlı bug'daki gibi.
 */
import { useEffect, useState } from 'react';

/** Test tarafından okunan mount sayacı (kaç kez TAZE instance yaratıldı). */
export const probeStats = { mountCount: 0 };

export function resetProbeStats(): void {
  probeStats.mountCount = 0;
}

export default function CartProbeScreen(): JSX.Element {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    probeStats.mountCount += 1;
  }, []);

  return (
    <div>
      <span data-testid="cart-count">{items.length}</span>
      <button
        type="button"
        data-testid="add-item"
        onClick={() => setItems((prev) => [...prev, 'Lahmacun'])}
      >
        Ekle
      </button>
    </div>
  );
}
