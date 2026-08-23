import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { CustomerOrderSummary } from '@restoran-pos/shared-types';
import { Button } from '../../../components/ui/button';
import { useOrderById } from '../../orders/api';
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

/**
 * ADR-038 K3 / K7.3 — satır açıldığında kalem detayı.
 *
 * **YENİ bir detay okuma modeli veya detay EKRANI yazılmaz** (K3 yasağı):
 * veri mevcut `GET /orders/:id` ucundan, mevcut `useOrderById` hook'uyla gelir.
 * Detay ayrı bir modal/route DEĞİL, satırın **yerinde açılımı**dır; böylece
 * paket sipariş drawer'ının içinde ikinci bir katman (dialog-üstü-dialog)
 * açılmaz ve `OrderScreenPage` unmount olmaz (sepet korunur, S112 dersi).
 *
 * **Salt-okunur:** yeniden bas / düzenle / tekrarla / iptal aksiyonu YOKTUR
 * (K10.1/K10.7). Buraya aksiyon eklemek ADR değişikliği gerektirir.
 *
 * Garson erişimi ADR-038 K5.1 ile güvence altındadır (`customer_id IS NOT NULL`
 * koşulu); yine de savunma amaçlı hata yolu satır-içi mesaj basar — geçmiş bir
 * kolaylıktır, hiçbir koşulda akışı bloke etmez (K7.5).
 */
function CustomerOrderHistoryDetail({
  orderId,
  currencySymbol,
}: {
  orderId: string;
  currencySymbol: string;
}): JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError } = useOrderById(orderId);

  if (isPending) {
    return (
      <div
        className="flex items-center gap-2 py-2 text-xs"
        style={{ color: 'var(--v3-text-muted)' }}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span>{t('customers.orderHistory.detailLoading')}</span>
      </div>
    );
  }

  if (isError || data === undefined) {
    return (
      <p className="py-2 text-xs" style={{ color: 'var(--v3-danger, #b91c1c)' }}>
        {t('customers.orderHistory.detailFailed')}
      </p>
    );
  }

  if (data.items.length === 0) {
    return (
      <p className="py-2 text-xs" style={{ color: 'var(--v3-text-muted)' }}>
        {t('customers.orderHistory.detailEmpty')}
      </p>
    );
  }

  return (
    <div className="py-1" data-testid="customer-order-history-detail">
      <ul className="space-y-1">
        {data.items.map((item) => {
          const itemCancelled = item.status === 'cancelled';
          return (
            <li
              key={item.id}
              className={`flex items-baseline justify-between gap-2 text-xs ${
                itemCancelled ? 'opacity-60' : ''
              }`}
            >
              <span className="min-w-0 truncate">
                <span className="tabular-nums">{item.quantity}×</span>{' '}
                {item.product_name}
                {item.variant_name_snapshot !== null && (
                  <span style={{ color: 'var(--v3-text-muted)' }}>
                    {' '}
                    ({item.variant_name_snapshot})
                  </span>
                )}
                {item.is_comped && (
                  <span className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                    {t('customers.orderHistory.detailComped')}
                  </span>
                )}
                {itemCancelled && (
                  <span className="ml-1 rounded bg-red-50 px-1 py-0.5 text-[10px] font-medium text-red-700">
                    {t('customers.orderHistory.detailCancelledItem')}
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 tabular-nums ${
                  itemCancelled ? 'line-through' : ''
                }`}
              >
                {formatCents(item.total_cents, currencySymbol)}
              </span>
            </li>
          );
        })}
      </ul>
      {/* Salt-okunur olduğunu AÇIKÇA söyle: kullanıcı "buradan basarım /
          düzenlerim" beklentisine girmesin (aksiyonun yokluğu sessiz kalmasın). */}
      <p className="mt-1.5 text-[11px]" style={{ color: 'var(--v3-text-muted)' }}>
        {t('customers.orderHistory.detailReadOnly')}
      </p>
    </div>
  );
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

  /**
   * Açık satır (K7.3 "satıra dokun → kalem detayı"). Tek satır açık tutulur:
   * dar drawer'da birden çok açık detay listeyi okunmaz hale getirir.
   * `null` = hepsi kapalı; detay sorgusu ancak satır açılınca atılır.
   */
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

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
          const expanded = expandedOrderId === order.id;
          return (
            <li
              key={order.id}
              className={cancelled ? 'opacity-60' : ''}
              data-testid="customer-order-history-row"
            >
              {/*
                Satırın TAMAMI tek bir buton (K7.3 "satıra dokun"). Affordance
                açıkça verilir — hci-reviewer'ın "tıklanabilirlik ipucu yok"
                notu: `cursor-pointer` + hover zemini + chevron ikonu + 48px
                minimum yükseklik (ADR-011 §8, Fitts) + `aria-expanded`.
                `type="button"` zorunlu: bileşen sipariş ekranındaki bir form
                bağlamında yaşayabilir, submit tetiklemesi yasak.
              */}
              <button
                type="button"
                aria-expanded={expanded}
                title={t('customers.orderHistory.expandHint')}
                onClick={() => {
                  setExpandedOrderId(expanded ? null : order.id);
                }}
                className="flex w-full min-h-[48px] items-start gap-2 rounded px-1 py-2.5 text-left transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                data-testid="customer-order-history-row-button"
              >
                {expanded ? (
                  <ChevronDown
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: 'var(--v3-text-muted)' }}
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: 'var(--v3-text-muted)' }}
                    aria-hidden="true"
                  />
                )}
                {/*
                  Buton içi yalnız PHRASING content taşır (`div`/`p` geçersiz
                  HTML üretir ve jsdom/tarayıcı yerleşimini bozar) — bu yüzden
                  satır anatomisi `span` + `block/flex` sınıflarıyla kurulur.
                  Görsel çıktı K7.3 ile birebir aynıdır.
                */}
                <span className="block min-w-0 flex-1">
              {/* 1. satır: tarih + tip rozeti + tutar (K7.3) */}
              <span className="flex items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-2 min-w-0">
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
                </span>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    cancelled ? 'line-through' : ''
                  }`}
                >
                  {formatCents(order.totalCents, currencySymbol)}
                </span>
              </span>

              {/* 2. satır: kalem önizlemesi — tek satır, taşma "…" */}
              <span
                className="mt-0.5 block truncate text-xs"
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
              </span>
                </span>
              </button>

              {/* Kalem detayı — YERİNDE açılır (yeni ekran/modal YOK, K3).
                  Sorgu ancak satır açılınca atılır. */}
              {expanded && (
                <div className="pb-2 pl-7 pr-1">
                  <CustomerOrderHistoryDetail
                    orderId={order.id}
                    currencySymbol={currencySymbol}
                  />
                </div>
              )}
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
