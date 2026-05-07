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
      style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--v3-border-subtle)',
        background: 'white',
        boxShadow: '0 -10px 28px rgba(0, 0, 0, 0.08)',
      }}
    >
      <div style={{ marginBottom: 10 }}>
        {/* Ara toplam — v3: fontSize 13, muted, marginBottom 6 */}
        <div
          className="flex items-center justify-between"
          style={{
            fontSize: 13,
            color: 'var(--v3-text-muted)',
            marginBottom: 6,
          }}
        >
          <span>{t('order.bottomBar.subtotal')}</span>
          <span className="tabular-nums">{formatMoney(subtotalCents)}</span>
        </div>
        {/* Toplam — v3: fontSize 20, fontWeight 850, gap 16 */}
        <div
          className="flex items-center justify-between"
          style={{
            fontSize: 20,
            fontWeight: 850,
            gap: 16,
            color: 'var(--v3-text-primary)',
          }}
        >
          <span>{t('order.bottomBar.total')}</span>
          <span className="tabular-nums">{formatMoney(totalCents)}</span>
        </div>
      </div>

      {hint && (
        <p
          style={{
            fontSize: 11,
            color: 'var(--v3-text-muted)',
            marginBottom: 10,
            margin: '0 0 10px 0',
          }}
        >
          {hint}
        </p>
      )}

      {actionsSlot}
    </footer>
  );
}
