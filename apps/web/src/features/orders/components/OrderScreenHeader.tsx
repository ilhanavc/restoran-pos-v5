import { ArrowLeft, Printer, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface OrderScreenHeaderProps {
  tableCode: string;
  areaName: string | null;
  /** Persisted order varsa Print butonu görünür (ekran 5 paritesi). */
  hasPersistedOrder: boolean;
  onBack: () => void;
  onCustomer: () => void;
  onPrint: () => void;
}

/**
 * Masa detay header — ADR-013 §4 (3-pane layout, üst pane).
 *
 * Sol: ← geri | Masa kodu + bölge chip | 👤 müşteri | 🖨 yazdır (persisted'de)
 *
 * v3 paritesi: shell-level × yok — sağ panel header'ındaki × tek kapatma yolu
 * (geri butonu zaten /tables'a navigate ediyor).
 *
 * Müşteri (PR-8) + Yazdır (PR-10) butonları placeholder — şimdilik no-op.
 */
export function OrderScreenHeader({
  tableCode,
  areaName,
  hasPersistedOrder,
  onBack,
  onCustomer,
  onPrint,
}: OrderScreenHeaderProps) {
  const { t } = useTranslation();

  return (
    <header
      className="grid grid-cols-[auto_auto_1fr] items-center gap-3 border-b bg-white px-4 py-3"
      style={{ borderColor: 'var(--v3-border-subtle)' }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={t('order.header.back')}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      <div className="flex flex-col leading-tight">
        <span
          className="text-[18px] font-extrabold"
          style={{ color: 'var(--v3-text-primary)' }}
        >
          {t('order.header.tableLabel', { code: tableCode })}
        </span>
        {areaName && (
          <span
            className="mt-0.5 inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px]"
            style={{
              background: 'var(--v3-surface-1)',
              color: 'var(--v3-text-muted)',
            }}
          >
            {areaName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 justify-self-start">
        <button
          type="button"
          onClick={onCustomer}
          aria-label={t('order.header.customer')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border bg-white text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
          style={{ borderColor: 'var(--v3-border-subtle)' }}
        >
          <User className="h-4 w-4" />
        </button>
        {hasPersistedOrder && (
          <button
            type="button"
            onClick={onPrint}
            aria-label={t('order.header.print')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border bg-white text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
            style={{ borderColor: 'var(--v3-border-subtle)' }}
          >
            <Printer className="h-4 w-4" />
          </button>
        )}
      </div>

    </header>
  );
}
