import { ArrowLeft, Printer, Search, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../../../components/ui/input';

interface OrderScreenHeaderProps {
  tableCode: string;
  areaName: string | null;
  /** Persisted order varsa Print butonu görünür (ekran 5 paritesi). */
  hasPersistedOrder: boolean;
  /** Arama input controlled value. PR-2: ProductCatalog filter'ına bağlı. */
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onBack: () => void;
  onCustomer: () => void;
  onPrint: () => void;
  /**
   * Takeaway modunda (ADR-017): tableCode yerine "Paket Sipariş" başlığı
   * gösterilir. Verildiyse `tableCode` ve `areaName` yok sayılır.
   */
  titleOverride?: string;
  /** Takeaway modunda customer name (subtitle). Verilmediyse subtitle gizli. */
  subtitleOverride?: string | null;
}

/**
 * Masa detay header — ADR-013 §4 (3-pane layout, üst pane).
 *
 * Layout (soldan sağa):
 *   ← geri | Masa kodu + bölge chip | 👤 müşteri | arama input (flex-1) | 🖨 yazdır
 *
 * v3 paritesi: shell-level × yok — sağ panel header'ındaki × tek kapatma yolu.
 *
 * Müşteri (PR-8) + Yazdır (PR-10) butonları placeholder — şimdilik no-op.
 */
export function OrderScreenHeader({
  tableCode,
  areaName,
  hasPersistedOrder,
  searchTerm,
  onSearchChange,
  onBack,
  onCustomer,
  onPrint,
  titleOverride,
  subtitleOverride,
}: OrderScreenHeaderProps) {
  const { t } = useTranslation();
  const titleText =
    titleOverride !== undefined
      ? titleOverride
      : t('order.header.tableLabel', { code: tableCode });
  const subtitleText =
    titleOverride !== undefined ? subtitleOverride ?? null : areaName;

  /**
   * v3 paritesi: header'ın sol bölümü (geri ok + başlık + alt etiket)
   * tek bir tıklama hedefi. Person/yazdır butonları onClick alanına dahil
   * değildir (kendi onClick'leri var, event bubble normal akışta).
   */
  return (
    <header className="flex items-center gap-3 border-b bg-white px-4 py-3"
      style={{ borderColor: 'var(--v3-border-subtle)' }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={t('order.header.back')}
        className="inline-flex shrink-0 items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
      >
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground"
          aria-hidden="true"
        >
          <ArrowLeft className="h-5 w-5" />
        </span>
        <span className="flex flex-col leading-tight">
          <span
            className="text-[16px] font-bold"
            style={{ color: 'var(--v3-text-primary)' }}
          >
            {titleText}
          </span>
          {subtitleText !== null && subtitleText !== '' && (
            <span
              className="mt-0.5 inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px]"
              style={{
                background: 'var(--v3-surface-1)',
                color: 'var(--v3-text-muted)',
              }}
            >
              {subtitleText}
            </span>
          )}
        </span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          // Back butonunun bubble'ı engellensin (Person sol tıklama hedefinin
          // dışında — kendi onClick'i çalışsın).
          e.stopPropagation();
          onCustomer();
        }}
        aria-label={t('order.header.customer')}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
        style={{ borderColor: 'var(--v3-border-subtle)' }}
      >
        <User className="h-4 w-4" />
      </button>

      {/* Arama — flex-1 ile orta alanı kapsar (v3 paritesi: header'ın orta-sağı). */}
      <div className="relative flex-1">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--v3-text-muted)' }}
          aria-hidden="true"
        />
        <Input
          type="search"
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('order.header.searchPlaceholder')}
          aria-label={t('order.header.searchPlaceholder')}
          className="h-10 pl-9"
        />
      </div>

      {hasPersistedOrder && (
        <button
          type="button"
          onClick={onPrint}
          aria-label={t('order.header.print')}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          <Printer className="h-4 w-4" />
        </button>
      )}
    </header>
  );
}
