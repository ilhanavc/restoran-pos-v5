import { useTranslation } from 'react-i18next';
import { ShoppingBag } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface OrderIdentityBadgeProps {
  /** Masa kodu — dine_in'de dolu, takeaway'de null. */
  tableCode: string | null;
  /** Kanonik masa görüntü numarası (ADR-009 Karar A); null → ham kod fallback. */
  tableDisplayNo: number | null;
  /** Paket (takeaway) siparişte müşteri adı; dine_in'de null. */
  customerName: string | null;
  className?: string;
}

/**
 * Sipariş-liste satırı kimlik rozeti — ADR-015 Amendment 11 (Session 119).
 *
 * ClosedOrdersPanel / ClosedOrdersPage / RecentOrdersPanel'in ORTAK kimlik
 * göstergesi (DRY). İki biçim:
 *   - dine_in (tableCode dolu) → yeşil pill, "Masa N" (kanonik display_no;
 *     orphan/null → ham kod). Numara ADR-009 Karar A ile kalıcıdır.
 *   - takeaway (tableCode null) → gök-mavi chip + çanta ikonu + MÜŞTERİ ADI
 *     (takeaway'de customer_id zorunlu → ad hep var; savunmacı fallback
 *     "Paket"). Ekranda maskesiz — KDS emsali, admin+cashier operasyonel görüm.
 */
export function OrderIdentityBadge({
  tableCode,
  tableDisplayNo,
  customerName,
  className,
}: OrderIdentityBadgeProps): JSX.Element {
  const { t } = useTranslation();

  if (tableCode !== null) {
    const label =
      tableDisplayNo !== null
        ? t('tables.tableLabel', { number: tableDisplayNo })
        : tableCode;
    return (
      <span
        className={cn(
          'inline-flex h-9 items-center justify-center rounded-md bg-emerald-100 px-2.5 text-xs font-bold text-emerald-800',
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        // ADR-015 Amd11 (S119 düzeltme) — müşteri adı TAM gösterilir: uzun adlar
        // kısaltılmaz (truncate/max-w kaldırıldı), gerekirse satır kaydırır.
        'inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-md bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800',
        className,
      )}
    >
      <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
      <span className="whitespace-normal break-words text-left">
        {customerName ?? t('dashboard.takeaway')}
      </span>
    </span>
  );
}
