import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useOpenTakeawayOrders } from '../api';
import { TakeawayOrderCard } from './TakeawayOrderCard';

interface OpenTakeawayOrdersPanelProps {
  /** Polling'i kapatmak için (örn. başka tab açıkken). */
  enabled?: boolean;
}

/**
 * Masalar sağ paneli — açık paket siparişler (ADR-017 §Frontend, ekran 5).
 *
 * - GET /orders?type=takeaway&status=open hook'u (refetchInterval 5sn).
 * - Socket.IO event'i v5.1 backlog: şu an polling 5sn. Sebep: orders namespace
 *   takeaway için event yayını henüz tanımsız; ADR-017 §6 polling'i kabul
 *   eden çözümü açıkça yazıyor.
 * - Dış container (TablesListPage'deki <aside>) layout sorumlusu —
 *   bu panel sadece içeriği üretir.
 */
export function OpenTakeawayOrdersPanel({
  enabled = true,
}: OpenTakeawayOrdersPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const query = useOpenTakeawayOrders(enabled);

  // Karta tıklayınca paket düzenleme ekranına yönlendir (v3 paritesi:
  // App.jsx L167 — `navigate('/order/takeaway', { state: { existingOrderId } })`).
  // v5 URL kontratı: ?type=takeaway&orderId=<uuid>. OrderScreenPage
  // orderId varsa düzenleme moduna geçer (persistedItems yükler, picker'lar
  // kapalı, müşteri+ödeme tipi zaten siparişte kayıtlı).
  const handleOpen = (orderId: string) => {
    navigate(`/orders/new?type=takeaway&orderId=${orderId}`);
  };

  if (query.isPending && enabled) {
    return (
      <div className="flex min-h-[80px] items-center justify-center">
        <Loader2
          className="h-4 w-4 animate-spin"
          style={{ color: 'var(--v3-text-muted)' }}
        />
      </div>
    );
  }

  const orders = query.data ?? [];
  if (orders.length === 0) {
    return (
      <p
        style={{
          fontSize: '12px',
          color: 'var(--v3-text-muted)',
          lineHeight: 1.5,
        }}
      >
        {t('takeaway.panel.empty')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {orders.map((order) => (
        <TakeawayOrderCard key={order.id} order={order} onOpen={handleOpen} />
      ))}
    </div>
  );
}
