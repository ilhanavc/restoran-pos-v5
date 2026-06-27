import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '../../lib/socket';
import { KDS_ORDERS_KEY } from './api';

/**
 * Kitchen realtime — Sprint 12 PR-3 (ADR-010 §5.2 + ADR-020 K12).
 *
 * Socket events:
 *   - `kitchen.orderSent` — yeni sipariş kitchen-routed kalemleri ile (POST hook)
 *   - `kitchen.itemStatusChanged` — kitchen veya admin PATCH ile state geçişi
 *
 * Strateji: handler içinde minimal iş. `useKdsOrders` query'sini invalidate et,
 * React Query yeniden fetch yapsın.
 *
 * Reconnect resync (Session 70 denetimi): Socket.IO bağlantısı koparsa (API
 * restart / WS drop), drop penceresinde kaçan `kitchen.*` event'leri replay
 * EDİLMEZ → mutfak ekranı stale kalır. `connect` event'i hem ilk bağlantıda
 * hem HER reconnect'te tetiklenir; bağlanır bağlanmaz invalidate ederek REST
 * cold-start ile ekranı güncel state'e döndürürüz. (React Query'nin
 * refetchOnReconnect'i tarayıcı `navigator.onLine`'ı dinler, WS transport
 * kopuşunu değil — bu yüzden socket-seviyesi resync şart.)
 */
export function useKitchenRealtime(): void {
  const qc = useQueryClient();

  useSocketEvent('connect', () => {
    void qc.invalidateQueries({ queryKey: KDS_ORDERS_KEY });
  });

  useSocketEvent('kitchen.orderSent', () => {
    void qc.invalidateQueries({ queryKey: KDS_ORDERS_KEY });
  });

  useSocketEvent('kitchen.itemStatusChanged', () => {
    void qc.invalidateQueries({ queryKey: KDS_ORDERS_KEY });
  });
}
