import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { useOrderById } from '../../orders/api';
import { AdisyonPanel } from '../../orders/components/AdisyonPanel';
import { OrderIdentityBadge } from '../../dashboard/components/OrderIdentityBadge';
import { formatDateTimeShort } from '../../dashboard/lib/format';
import type { ClosedOrderSummary } from '../../dashboard/api/reports';

interface ClosedOrderDetailModalProps {
  /** Açık satır (kimlik + tarih burada); null → modal kapalı. */
  order: ClosedOrderSummary | null;
  onOpenChange: (open: boolean) => void;
}

/** Read-only kullanım — pending yok, aksiyon yok; no-op stepper handler'ları. */
const noop = (): void => {};

/**
 * Kapanan adisyon DETAY modalı — ADR-015 Amendment 11 (Session 119).
 *
 * Ürün sahibi isteği: kapanan bir masaya tıklayınca açılan detay, **normal masa
 * (sipariş) ekranındaki adisyon görünümünün BİREBİR AYNISI** olmalı, yalnız
 * salt-okunur (masa kapanmıştır, değişiklik yapılamaz). Bu yüzden burada gerçek
 * `AdisyonPanel` bileşeni yeniden kullanılır — mutasyon handler'ları (void /
 * düzenle / taşı / aktar / not / kaydet) VERİLMEZ, böylece panel kendiliğinden
 * salt-okunur render eder (çöp butonu yok, satır tıklanamaz, aksiyon çubuğu yok).
 *
 * Kalemler mevcut `GET /orders/:id` (useOrderById) ile çekilir — yeni endpoint
 * yok; admin+cashier her adisyonu görebilir (ADR-038 K5.1 IDOR guard yalnız
 * waiter). Cancelled kalemleri AdisyonPanel kendisi gizler.
 */
export function ClosedOrderDetailModal({
  order,
  onOpenChange,
}: ClosedOrderDetailModalProps): JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError } = useOrderById(order?.orderId ?? null);

  // Ara toplam = iptal edilmemiş kalemlerin satır toplamı; toplam = adisyon
  // total_cents (indirim sonrası). AdisyonPanel ikisini de gösterir.
  const visibleItems = (data?.items ?? []).filter(
    (it) => it.status !== 'cancelled',
  );
  const subtotalCents = visibleItems.reduce((s, it) => s + it.total_cents, 0);
  const totalCents = data?.order.total_cents ?? order?.totalCents ?? 0;

  const close = (): void => onOpenChange(false);

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[85vh] max-h-[85vh] w-[95vw] max-w-md flex-col overflow-hidden p-0"
      >
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {order && (
              <OrderIdentityBadge
                tableCode={order.tableCode}
                tableDisplayNo={order.tableDisplayNo}
                customerName={order.customerName}
              />
            )}
            <span className="text-sm font-normal text-muted-foreground">
              {order ? formatDateTimeShort(order.paidAt) : ''}
              {order
                ? ` · ${order.paymentTypeMix
                    .map((p) => t(`dashboard.paymentType.${p}`))
                    .join(' + ')}`
                : ''}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1">
          {isPending ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('closedOrdersPage.detail.loading')}
            </div>
          ) : isError || !data ? (
            <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {t('dashboard.errors.loadFailed')}
            </p>
          ) : (
            // Mutasyon handler'ları YOK → AdisyonPanel salt-okunur render eder.
            <AdisyonPanel
              persistedItems={data.items}
              pendingItems={[]}
              subtotalCents={subtotalCents}
              totalCents={totalCents}
              onPendingIncrement={noop}
              onPendingDecrement={noop}
              onPendingRemove={noop}
              onClose={close}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
