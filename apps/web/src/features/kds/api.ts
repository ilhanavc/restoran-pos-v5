import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * KDS (Mutfak Ekranı) — Sprint 12 PR-3 (ADR-020).
 *
 * Backend `GET /kds/orders` response shape (kds.ts:43-57):
 *   { data: { orders: KdsOrder[] } }
 *
 * Backend `PATCH /orders/:orderId/items/:itemId/status` response:
 *   { data: { item: { id, status } } }
 *
 * State machine (ADR-020 K3): sent → preparing → ready (skip preparing OK).
 */

export type KdsItemStatus = 'sent' | 'preparing' | 'ready';

export interface KdsItem {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  status: KdsItemStatus;
  note: string | null;
  variantNameSnapshot: string | null;
  createdAt: string;
}

export interface KdsOrder {
  id: string;
  orderNo: number;
  tableId: string | null;
  orderType: 'dine_in' | 'takeaway';
  takeawayStage: string | null;
  tableCodeSnapshot: string | null;
  areaNameSnapshot: string | null;
  customerName: string | null;
  createdAt: string;
  items: KdsItem[];
}

interface KdsOrdersResponse {
  data: { orders: KdsOrder[] };
}

interface ItemStatusResponse {
  data: { item: { id: string; status: KdsItemStatus } };
}

export const KDS_ORDERS_KEY = ['kds', 'orders'] as const;

/**
 * GET /kds/orders — kitchen-routed kalemler nested. FIFO (`created_at ASC`).
 * Realtime push (`kitchen.orderSent` / `kitchen.itemStatusChanged`)
 * `useKitchenRealtime` hook'u tarafından invalidate edilir.
 */
export function useKdsOrders() {
  return useQuery({
    queryKey: KDS_ORDERS_KEY,
    queryFn: async (): Promise<KdsOrder[]> => {
      const res = await api.get<KdsOrdersResponse>('/kds/orders');
      return res.data.data.orders;
    },
    // Reconnect REST refetch (ADR-010 §5.2): focus + reconnect aktif.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/**
 * PATCH /orders/:orderId/items/:itemId/status — item state geçişi.
 * Idempotent: aynı status → 200 no-op.
 * Invalid transition → 422 ORDER_ITEM_INVALID_STATUS_TRANSITION.
 */
export function useUpdateItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      orderId: string;
      itemId: string;
      status: 'preparing' | 'ready';
    }): Promise<{ id: string; status: KdsItemStatus }> => {
      const res = await api.patch<ItemStatusResponse>(
        `/orders/${vars.orderId}/items/${vars.itemId}/status`,
        { status: vars.status },
      );
      return res.data.data.item;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KDS_ORDERS_KEY });
    },
  });
}
