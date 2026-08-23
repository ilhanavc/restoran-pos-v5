import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { CustomerOrderSummary } from '@restoran-pos/shared-types';
import { Button } from '../../../components/ui/button';
import { useCustomerOrderHistory } from '../api/customers';

/**
 * Müşteri sipariş geçmişi listesi — ADR-038 K7.1.
 *
 * **TEK** bileşendir; iki yerden kullanılır (K7.2):
 *   1. `CustomerDetailPage` — "Son Siparişler" bölümü (admin müşteri ekranı)
 *   2. Paket sipariş akışı — `CustomerOrderHistoryDrawer` içinde
 * İkinci bir geçmiş listesi yazmak YASAKTIR (kardeş-artefakt drift'i).
 *
 * Bu bileşen yalnız listeyi render eder; kabı (section / dialog) çağıran
 * belirler. Böylece aynı satır anatomisi her iki yüzeyde birebir aynıdır.
 *
 * Davranış sözleşmesi (K7.5): geçmiş bir **kolaylıktır**, sipariş almayı
 * durdurma yetkisi YOKTUR. Hata satır-içi gösterilir (toast DEĞİL) ve çağıran
 * akış normal devam eder.
 */
interface CustomerOrderHistoryProps {
  customerId: string | null;
  /** `false` iken sorgu HİÇ atılmaz (kapalı drawer boşuna yük üretmesin). */
  enabled?: boolean;
}

/** İptal/void — terminal "gerçekleşmedi" durumları (ADR-038 K4). */
function isCancelledOrder(status: CustomerOrderSummary['status']): boolean {
  return status === 'cancelled' || status === 'void';
}

/**
 * Kuruş → "₺123,45". Para her zaman integer kuruştur; burada yalnız GÖSTERİM
 * için 100'e bölünür (float aritmetiği yapılmaz).
 */
function formatCents(cents: number, currencySymbol: string): string {
  return `${currencySymbol}${(cents / 100).toFixed(2).replace('.', ',')}`;
}

/** ISO → "12.08.2026 19:45" (tr-TR). */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function CustomerOrderHistory({
  customerId,
  enabled = true,
}: CustomerOrderHistoryProps): JSX.Element {
  const { t } = useTranslation();
  const currencySymbol = t('common.currencySymbol');

  const {
    data,
    isPending,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useCustomerOrderHistory(customerId, { enabled });

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  if (enabled && isPending) {
    return (
      <div
        className="flex items-center gap-2 py-6 text-sm"
        style={{ color: 'var(--v3-text-muted)' }}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>{t('customers.orderHistory.loading')}</span>
      </div>
    );
  }

  // Satır-içi hata (K7.5) — toast DEĞİL. Sipariş akışı bloke OLMAZ.
  if (isError) {
    return (
      <div className="py-4">
        <p className="text-sm" style={{ color: 'var(--v3-danger, #b91c1c)' }}>
          {t('customers.orderHistory.loadFailed')}
        </p>
        {/*
          Dokunma hedefi 48px (ADR-011 §8, Fitts): bu bileşen paket sipariş
          drawer'ında da yaşar — sıcak akışta tablete parmakla basılır.
          `size="sm"` (36px) proje tabanının altındadır.
        */}
        <Button
          type="button"
          variant="outline"
          size="default"
          className="mt-2"
          onClick={() => {
            void refetch();
          }}
        >
          {t('customers.orderHistory.retry')}
        </Button>
      </div>
    );
  }

  // Dürüst boş durum (K7.4) — sahte iskelet/placeholder satır YOK.
  if (items.length === 0) {
    return (
      <p className="py-4 text-sm" style={{ color: 'var(--v3-text-muted)' }}>
        {t('customers.orderHistory.empty')}
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y" style={{ borderColor: 'var(--v3-border-subtle)' }}>
        {items.map((order) => {
          const cancelled = isCancelledOrder(order.status);
          const hiddenCount = order.itemCount - order.itemsPreview.length;
          return (
            <li
              key={order.id}
              className={`py-2.5 ${cancelled ? 'opacity-60' : ''}`}
              data-testid="customer-order-history-row"
            >
              {/* 1. satır: tarih + tip rozeti + tutar (K7.3) */}
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-sm font-medium">
                    {formatDateTime(order.createdAt)}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor: 'var(--v3-bg-subtle, #f1f5f9)',
                      color: 'var(--v3-text-muted)',
                    }}
                  >
                    {t(`customers.orderHistory.type.${order.orderType}`)}
                  </span>
                  {cancelled && (
                    <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                      {t('customers.orderHistory.cancelledBadge')}
                    </span>
                  )}
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    cancelled ? 'line-through' : ''
                  }`}
                >
                  {formatCents(order.totalCents, currencySymbol)}
                </span>
              </div>

              {/* 2. satır: kalem önizlemesi — tek satır, taşma "…" */}
              <p
                className="mt-0.5 truncate text-xs"
                style={{ color: 'var(--v3-text-muted)' }}
              >
                {order.itemsPreview.length === 0
                  ? t('customers.orderHistory.noItems')
                  : hiddenCount > 0
                    ? t('customers.orderHistory.itemsPreviewMore', {
                        items: order.itemsPreview.join(', '),
                        count: hiddenCount,
                      })
                    : order.itemsPreview.join(', ')}
              </p>
            </li>
          );
        })}
      </ul>

      {/* S2=(b) "son 10 + daha fazla" — keyset cursor ile sonraki sayfa */}
      {hasNextPage && (
        <div className="pt-3">
          {/* 48px dokunma hedefi (ADR-011 §8) — drawer'da parmakla basılır. */}
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={isFetchingNextPage}
            onClick={() => {
              void fetchNextPage();
            }}
          >
            {isFetchingNextPage && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            {t('customers.orderHistory.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
