import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { useOrderById } from '../../orders/api';
import { OrderIdentityBadge } from '../../dashboard/components/OrderIdentityBadge';
import {
  formatTryFromCents,
  formatDateTimeShort,
} from '../../dashboard/lib/format';
import type { ClosedOrderSummary } from '../../dashboard/api/reports';

interface ClosedOrderDetailModalProps {
  /** Açık satır (kimlik + tarih burada); null → modal kapalı. */
  order: ClosedOrderSummary | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Kapanan adisyon DETAY modalı — ADR-015 Amendment 11 (Session 119).
 *
 * SALT-OKUNUR: kapanan bir sipariş satırına tıklayınca adisyonun KALEMLERİNİ
 * (ne sipariş edilmiş) gösterir. Kimlik + tarih satırdan (prop) gelir; kalemler
 * mevcut `GET /orders/:id` (useOrderById) ile çekilir — yeni endpoint yok,
 * admin+cashier her adisyonu görebilir (ADR-038 K5.1 IDOR guard yalnız waiter).
 * Düzenleme YOK (o OrderScreen'in işi); ödeme dökümü satırda zaten var.
 */
export function ClosedOrderDetailModal({
  order,
  onOpenChange,
}: ClosedOrderDetailModalProps): JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError } = useOrderById(order?.orderId ?? null);

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {order && (
              <OrderIdentityBadge
                tableCode={order.tableCode}
                tableDisplayNo={order.tableDisplayNo}
                customerName={order.customerName}
              />
            )}
            <span>{t('closedOrdersPage.detail.title')}</span>
          </DialogTitle>
          <DialogDescription>
            {order ? formatDateTimeShort(order.paidAt) : ''}
            {order
              ? ` · ${order.paymentTypeMix
                  .map((p) => t(`dashboard.paymentType.${p}`))
                  .join(' + ')}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[120px] overflow-y-auto">
          {isPending ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('closedOrdersPage.detail.loading')}
            </div>
          ) : isError || !data ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('dashboard.errors.loadFailed')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data.items.map((item) => {
                const isCancelled = item.status === 'cancelled';
                return (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span
                        className={cnLine(isCancelled)}
                      >
                        <span className="font-semibold tabular-nums">
                          {item.quantity}×
                        </span>{' '}
                        {item.product_name}
                        {item.variant_name_snapshot
                          ? ` (${item.variant_name_snapshot})`
                          : ''}
                      </span>
                      {item.attributes.length > 0 && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {item.attributes
                            .map((a) => a.option_name_snapshot)
                            .join(', ')}
                        </span>
                      )}
                      {item.note && (
                        <span className="mt-0.5 block text-[11px] italic text-muted-foreground">
                          {item.note}
                        </span>
                      )}
                      {isCancelled && (
                        <span className="mt-0.5 inline-block rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                          {t('closedOrdersPage.detail.cancelled')}
                        </span>
                      )}
                    </span>
                    <span
                      className={
                        isCancelled
                          ? 'shrink-0 text-sm text-muted-foreground line-through tabular-nums'
                          : 'shrink-0 text-sm font-semibold tabular-nums'
                      }
                    >
                      {formatTryFromCents(item.total_cents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {order && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-medium text-muted-foreground">
              {t('closedOrdersPage.detail.total')}
            </span>
            <span className="text-lg font-bold tabular-nums">
              {formatTryFromCents(order.totalCents)}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** İptal kalem satırı üstü çizili + soluk; normal kalem düz. */
function cnLine(cancelled: boolean): string {
  return cancelled
    ? 'block text-sm text-muted-foreground line-through'
    : 'block text-sm text-foreground';
}
