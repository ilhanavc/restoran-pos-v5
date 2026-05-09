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
 * React Query yeniden fetch yapsın. Bu pattern reconnect davranışı ile uyumlu —
 * disconnect sırasında kaçırılan event'lerden sonra REST cold-start yeterli.
 */
export function useKitchenRealtime(): void {
  const qc = useQueryClient();

  useSocketEvent('kitchen.orderSent', () => {
    void qc.invalidateQueries({ queryKey: KDS_ORDERS_KEY });
  });

  useSocketEvent('kitchen.itemStatusChanged', () => {
    void qc.invalidateQueries({ queryKey: KDS_ORDERS_KEY });
  });
}
