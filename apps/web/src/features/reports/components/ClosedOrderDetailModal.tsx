import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { formatMoney } from '@restoran-pos/shared-domain';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../../components/ui/dialog';
import { useOrderById, type ApiOrderItem } from '../../orders/api';
import { OrderIdentityBadge } from '../../dashboard/components/OrderIdentityBadge';
import { formatDateTimeShort } from '../../dashboard/lib/format';
import type { ClosedOrderSummary } from '../../dashboard/api/reports';

interface ClosedOrderDetailModalProps {
  /** Açık satır (kimlik + tarih burada); null → modal kapalı. */
  order: ClosedOrderSummary | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Kapanan adisyon DETAY modalı — ADR-015 Amendment 11 (Session 119).
 *
 * SALT-OKUNUR ama **adisyon ekranı görünümünde** (ürün sahibi isteği): sağ-panel
 * `AdisyonPanel`/`PersistedRow` düzenini yansıtır (Nx prefix, ad + aktör rozeti,
 * varyant/özellik/not, "birim × adet = toplam") — ancak DÜZENLEME kontrolü YOK
 * (çöp/stepper/tıklama yok). AdisyonPanel'in kendisi kritik canlı bileşen
 * olduğundan burada YENİDEN KULLANILMAZ; yalnız görsel dili birebir kopyalanır.
 *
 * Kalemler mevcut `GET /orders/:id` (useOrderById) ile çekilir — yeni endpoint
 * yok, admin+cashier her adisyonu görebilir (ADR-038 K5.1 IDOR guard yalnız
 * waiter). İptal (cancelled) kalemler GİZLENİR (AdisyonPanel paritesi).
 */
export function ClosedOrderDetailModal({
  order,
  onOpenChange,
}: ClosedOrderDetailModalProps): JSX.Element {
  const { t } = useTranslation();
  const { data, isPending, isError } = useOrderById(order?.orderId ?? null);

  // İptal edilen kalemleri gösterme — v3/AdisyonPanel paritesi.
  const visibleItems = (data?.items ?? []).filter(
    (it) => it.status !== 'cancelled',
  );

  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex flex-wrap items-center gap-2">
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

        <div className="min-h-[120px] flex-1 overflow-y-auto">
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
            <div className="flex flex-col">
              {visibleItems.map((item) => (
                <DetailRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className="text-sm font-medium text-muted-foreground">
            {t('closedOrdersPage.detail.total')}
          </span>
          <span className="text-lg font-bold tabular-nums">
            {formatMoney(data?.order.total_cents ?? order?.totalCents ?? 0)}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Salt-okunur adisyon kalem satırı — AdisyonPanel `PersistedRow` görsel dilini
 * yansıtır (Nx / ad + aktör / varyant / özellik / not / birim×adet=toplam) ama
 * aksiyon (çöp/tıklama) YOK. İkram satırı 0.5 opaklık + "İkram" rozeti.
 */
function DetailRow({ item }: { item: ApiOrderItem }): JSX.Element {
  const isComped = item.is_comped;
  // Aktör rozeti yalnız ad + GEÇERLİ zaman damgası varsa (savunmacı: created_at
  // beklenmedik biçimde boş/bozuk gelirse rozet düşürülür, satır patlamaz).
  const createdDate = item.created_at ? new Date(item.created_at) : null;
  const time =
    item.created_by_name && createdDate && !Number.isNaN(createdDate.getTime())
      ? new Intl.DateTimeFormat('tr-TR', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(createdDate)
      : null;

  return (
    <div
      className="flex"
      style={{
        padding: '15px 18px',
        gap: 12,
        alignItems: 'flex-start',
        fontSize: 17,
        borderBottom: '1px solid var(--v3-border-subtle)',
        opacity: isComped ? 0.5 : 1,
      }}
    >
      {/* Nx prefix */}
      <span
        className="shrink-0 tabular-nums text-center"
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--v3-text-muted)',
          width: 38,
          paddingTop: 2,
        }}
      >
        {item.quantity}×
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
          <span
            style={{ fontWeight: 600, color: 'var(--v3-text-primary)' }}
          >
            {item.product_name}
          </span>
          {item.created_by_name !== null && time !== null && (
            <span
              className="inline-flex items-center uppercase"
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '3px 7px',
                borderRadius: 4,
                background: 'rgba(224, 102, 26, 0.22)',
                color: '#2C5FC7',
                letterSpacing: '0.03em',
              }}
            >
              {item.created_by_name.toLocaleUpperCase('tr-TR')} · {time}
            </span>
          )}
          {isComped && (
            <span
              className="inline-flex items-center uppercase"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--warning-muted, rgba(212, 136, 6, 0.14))',
                color: 'var(--warning, #D48806)',
              }}
            >
              İkram
            </span>
          )}
        </div>
        {/* Varyant satırı */}
        <div
          style={{ fontSize: 12, color: 'var(--v3-text-muted)', marginTop: 2 }}
        >
          {item.variant_name_snapshot ?? 'Tam'}
        </div>
        {/* Özellik satırı */}
        {item.attributes.length > 0 && (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--v3-purple, #7C5CFA)',
              marginTop: 2,
            }}
          >
            {item.attributes
              .map((a) => a.option_name_snapshot)
              .join(', ')
              .toLocaleUpperCase('tr-TR')}
          </div>
        )}
        {/* Not satırı */}
        {item.note !== null && item.note !== '' && (
          <div
            className="italic"
            style={{
              fontSize: 12,
              color: 'var(--warning, #D48806)',
              marginTop: 2,
            }}
          >
            {item.note}
          </div>
        )}
        {/* birim × adet = toplam */}
        <div
          className="tabular-nums"
          style={{ fontSize: 13, color: 'var(--v3-text-muted)', marginTop: 4 }}
        >
          {formatMoney(item.unit_price_cents)} × {item.quantity} ={' '}
          <span
            style={{ fontWeight: 600, color: 'var(--v3-text-secondary)' }}
          >
            {formatMoney(item.total_cents)}
          </span>
        </div>
      </div>
    </div>
  );
}
