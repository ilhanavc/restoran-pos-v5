import { ClipboardList, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomActionBar } from './BottomActionBar';

interface AdisyonPanelProps {
  /** Persisted (kayıtlı) ürün sayısı — header alt-başlığı + Taşı butonu görünürlüğü. */
  persistedItemCount: number;
  /** Sipariş ara toplam (cent). */
  subtotalCents: number;
  /** Toplam (indirim sonrası, vergi dahil) (cent). */
  totalCents: number;
  /** State-based action slot (Kaydet / Ödeme+Hızlı Öde). PR-4+ doldurur. */
  actionsSlot?: React.ReactNode;
  /** Bilgilendirme satırı (örn. "Yeni ürünleri kaydettikten sonra ödeme açılır."). */
  hint?: string | null;
  onTransferTable: () => void;
  onClose: () => void;
}

/**
 * Sağ panel — ADR-013 §5 (persisted üstte, pending altta, empty state) +
 * v3 paritesi: bottom totals + actions sağ panel'in altına gömülü (full-width
 * footer YOK; mor accent border-bottom tüm ekranın altında page-level).
 *
 * PR-1 (shell): yalnız boş state. Persisted/pending listesi PR-3/PR-5'te;
 * actionsSlot Kaydet (PR-4) + Ödeme/Hızlı Öde (PR-7) tarafından doldurulur.
 *
 * Layout:
 *   1. Header: "Adisyon" + alt başlık ("X kayıtlı ürün") + Taşı + ×
 *   2. Content: MEVCUT ÜRÜNLER + YENİ ÜRÜNLER veya empty state
 *   3. Bottom: Ara toplam + Toplam + (hint?) + actionsSlot
 */
export function AdisyonPanel({
  persistedItemCount,
  subtotalCents,
  totalCents,
  actionsSlot,
  hint,
  onTransferTable,
  onClose,
}: AdisyonPanelProps) {
  const { t } = useTranslation();

  const hasPersisted = persistedItemCount > 0;

  return (
    <aside
      className="flex h-full flex-col border-l bg-white"
      style={{ borderColor: 'var(--v3-border-subtle)' }}
    >
      {/* Header — v3 paritesi: border-b yok, sade beyaz başlık. */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex flex-col leading-tight">
          <span
            className="text-[15px] font-bold"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {t('order.adisyon.title')}
          </span>
          {hasPersisted && (
            <span
              className="text-[12px]"
              style={{ color: 'var(--v3-text-muted)' }}
            >
              {t('order.adisyon.itemCount', { count: persistedItemCount })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasPersisted && (
            <button
              type="button"
              onClick={onTransferTable}
              aria-label={t('order.adisyon.transfer')}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border bg-white px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
              style={{ borderColor: 'var(--v3-border-subtle)' }}
            >
              {t('order.adisyon.transfer')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('order.adisyon.close')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content (PR-1: empty state only) */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <ClipboardList
            className="h-12 w-12"
            strokeWidth={1.5}
            style={{ color: 'var(--v3-text-muted)' }}
          />
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--v3-text-muted)' }}
          >
            {t('order.adisyon.empty')}
          </p>
        </div>
      </div>

      {/* Bottom — totals + actions, sağ panel'e gömülü (v3 paritesi). */}
      <BottomActionBar
        subtotalCents={subtotalCents}
        totalCents={totalCents}
        actionsSlot={actionsSlot}
        hint={hint ?? null}
      />
    </aside>
  );
}
