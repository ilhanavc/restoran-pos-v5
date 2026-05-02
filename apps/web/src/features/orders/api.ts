import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * Orders API hooks — PR-4 (Kaydet → POST /orders + items).
 *
 * Backend endpoint'leri (apps/api/src/routes/orders.ts):
 *   POST /orders           — yeni sipariş + opsiyonel items[] atomik insert
 *   POST /orders/:id/items — mevcut siparişe kalem ekleme
 *   GET  /orders/:id       — tek sipariş + items nested
 *   GET  /orders           — list + filter (status, tableId, orderType)
 *
 * ADR-013 §1 (saf local cart) + §2 (snapshot server-side) + §9.1 (status='open' default).
 */

export type OrderStatus =
  | 'open'
  | 'sent_to_kitchen'
  | 'partially_served'
  | 'served'
  | 'billed'
  | 'paid'
  | 'cancelled'
  | 'void';

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

export interface ApiOrder {
  id: string;
  tenant_id: string;
  table_id: string | null;
  customer_id: string | null;
  order_type: OrderType;
  status: OrderStatus;
  order_no: number;
  store_date: string;
  is_fully_comped: boolean;
  total_cents: number;
  note: string | null;
  waiter_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiOrderItem {
  id: string;
  tenant_id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  category_name_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
  is_comped: boolean;
  note: string | null;
  /** ADR-013 §5 actor rozeti — Migration 019. Kullanıcı silinince user_id NULL,
   *  name text snapshot kanıt için kalır. */
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface OrderWithItemsResponse {
  data: { order: ApiOrder; items: ApiOrderItem[] };
}

interface OrdersListResponse {
  data: { orders: ApiOrder[] };
}

const ORDERS_KEY = ['orders'] as const;

/**
 * Belirli bir masa için açık (status='open') siparişi getirir.
 *
 * v3 paritesi: bir masada aynı anda yalnız 1 açık sipariş olabilir
 * (orders unique constraint by table_id + status NOT IN closed). Bu hook
 * 0 veya 1 sipariş döner.
 */
export function useOpenOrderForTable(tableId: string | null) {
  return useQuery({
    queryKey: [...ORDERS_KEY, 'by-table', tableId, 'open'],
    enabled: tableId !== null,
    queryFn: async (): Promise<ApiOrder | null> => {
      const res = await api.get<OrdersListResponse>('/orders', {
        params: { tableId, status: 'open' },
      });
      return res.data.data.orders[0] ?? null;
    },
    staleTime: 10_000,
  });
}

export function useOrderById(orderId: string | null) {
  return useQuery({
    queryKey: [...ORDERS_KEY, orderId],
    enabled: orderId !== null,
    queryFn: async (): Promise<{ order: ApiOrder; items: ApiOrderItem[] }> => {
      const res = await api.get<OrderWithItemsResponse>(`/orders/${orderId}`);
      return res.data.data;
    },
    staleTime: 10_000,
  });
}

export interface OrderItemCreateInput {
  productId: string;
  quantity: number;
  note?: string;
}

export interface CreateOrderInput {
  tableId: string | null;
  orderType: OrderType;
  note?: string;
  customerId?: string;
  items?: OrderItemCreateInput[];
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateOrderInput,
    ): Promise<{ order: ApiOrder; items: ApiOrderItem[] }> => {
      const res = await api.post<OrderWithItemsResponse>('/orders', input);
      return res.data.data;
    },
    onSuccess: (data) => {
      // Mevcut açık sipariş cache + tek sipariş cache invalidate.
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      // Yeni sipariş id'siyle direkt cache prime — refetch beklemeden UI yansır.
      qc.setQueryData([...ORDERS_KEY, data.order.id], {
        order: data.order,
        items: data.items,
      });
    },
  });
}

export interface AddOrderItemsInput {
  orderId: string;
  items: OrderItemCreateInput[];
}

export function useAddOrderItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: AddOrderItemsInput,
    ): Promise<{ order: ApiOrder; items: ApiOrderItem[] }> => {
      const res = await api.post<OrderWithItemsResponse>(
        `/orders/${input.orderId}/items`,
        { items: input.items },
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      qc.setQueryData([...ORDERS_KEY, data.order.id], {
        order: data.order,
        items: data.items,
      });
    },
  });
}
