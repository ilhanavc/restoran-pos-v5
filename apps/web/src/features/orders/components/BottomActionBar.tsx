import { useTranslation } from 'react-i18next';
import { formatMoney } from '@restoran-pos/shared-domain';

interface BottomActionBarProps {
  /** Sipariş ara toplamı (cent). PR-1'de 0; pending+persisted toplamı PR-3+'da. */
  subtotalCents: number;
  /** Toplam (indirim sonrası, vergi dahil). PR-1'de 0. */
  totalCents: number;
  /**
   * State-based render slot — PR-1'de boş.
   *   pending → Kaydet butonu (PR-4)
   *   persisted → Ödeme + Hızlı Öde (PR-7)
   *   empty → null
   */
  actionsSlot?: React.ReactNode;
  /**
   * Bilgilendirme mesajı (örn. "Yeni ürünleri kaydettikten sonra ödeme açılır").
   * Boş bırakılırsa render edilmez.
   */
  hint?: string | null;
}

/**
 * Sticky bottom action bar — ADR-013 §4 (3-pane bottom).
 *
 * Her zaman: Ara toplam + Toplam.
 * State-based: actionsSlot (Kaydet / Ödeme+Hızlı Öde / boş).
 */
export function BottomActionBar({
  subtotalCents,
  totalCents,
  actionsSlot,
  hint,
}: BottomActionBarProps) {
  const { t } = useTranslation();

  return (
    <footer
      className="bg-white px-6 pt-4 pb-4"
      style={{ boxShadow: '0 -8px 24px rgba(15, 23, 42, 0.06)' }}
    >
      <div className="mb-1 flex items-center justify-between text-[13px]">
        <span style={{ color: 'var(--v3-text-muted)' }}>
          {t('order.bottomBar.subtotal')}
        </span>
        <span
          className="tabular-nums"
          style={{ color: 'var(--v3-text-muted)' }}
        >
          {formatMoney(subtotalCents)}
        </span>
      </div>
      <div className="mb-3 flex items-center justify-between">
        <span
          className="text-lg font-bold"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('order.bottomBar.total')}
        </span>
        <span
          className="text-2xl font-extrabold tabular-nums"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {formatMoney(totalCents)}
        </span>
      </div>

      {hint && (
        <p
          className="mb-2 text-[12px]"
          style={{ color: 'var(--v3-text-muted)' }}
        >
          {hint}
        </p>
      )}

      {actionsSlot}
    </footer>
  );
}
