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

export type OrderItemStatus =
  | 'new'
  | 'sent'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'cancelled';

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

export interface ApiOrderItemAttribute {
  id: string;
  order_item_id: string;
  attribute_group_id: string;
  attribute_option_id: string;
  group_name_snapshot: string;
  option_name_snapshot: string;
  extra_price_cents_snapshot: number;
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
  /** Migration 020 — order_item_status ENUM (default 'new'). 'cancelled' = soft void. */
  status: OrderItemStatus;
  /** ADR-013 §5 actor rozeti — Migration 019. Kullanıcı silinince user_id NULL,
   *  name text snapshot kanıt için kalır. */
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  /** ADR-013 §10 — order_item_attributes nested (PR-6a). */
  attributes: ApiOrderItemAttribute[];
  /** ADR-013 §11 — porsiyon snapshot (Migration 021). */
  variant_id_snapshot: string | null;
  variant_name_snapshot: string | null;
  variant_price_delta_cents_snapshot: number | null;
}

interface OrderWithItemsResponse {
  data: { order: ApiOrder; items: ApiOrderItem[] };
}

interface OrdersListResponse {
  data: { orders: ApiOrder[] };
}

const ORDERS_KEY = ['orders'] as const;

/**
 * Belirli bir masa için aktif (paid/cancelled/void HARİÇ) siparişi getirir.
 *
 * Backend repo TABLE_ALREADY_OCCUPIED kontrolüyle aynı kural:
 *   `status NOT IN ('paid', 'cancelled', 'void')`
 *
 * Yani: open / sent_to_kitchen / partially_served / served / billed hepsi
 * "aktif" sayılır. Bir masada eş zamanlı yalnız 1 aktif sipariş olabilir
 * (DB invariant); hook 0 veya 1 sipariş döner.
 *
 * Implementasyon: GET /orders?tableId=X (status filter SİZ — tüm bugünün
 * siparişleri storeDate filter'ıyla gelir), client-side aktif filtre.
 */
const ACTIVE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'open',
  'sent_to_kitchen',
  'partially_served',
  'served',
  'billed',
]);

export function useOpenOrderForTable(tableId: string | null) {
  return useQuery({
    queryKey: [...ORDERS_KEY, 'by-table', tableId, 'active'],
    enabled: tableId !== null,
    queryFn: async (): Promise<ApiOrder | null> => {
      const res = await api.get<OrdersListResponse>('/orders', {
        params: { tableId },
      });
      return (
        res.data.data.orders.find((o) => ACTIVE_ORDER_STATUSES.has(o.status)) ??
        null
      );
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

export interface SelectedAttributeInput {
  groupId: string;
  optionId: string;
}

export interface OrderItemCreateInput {
  productId: string;
  quantity: number;
  note?: string;
  /** PR-6 (ADR-013 §10) — sunucu resolveItemAttributes ile validate eder. */
  selectedAttributes?: SelectedAttributeInput[];
  /** PR-6 (ADR-013 §11) — porsiyon (variant). Backend product_variants'tan
   *  price_delta_cents okur ve unit_price_cents'e ekler. */
  variantId?: string;
}

/**
 * GET /products/:id/attribute-groups/effective-with-options — PR-6.
 * OrderProductDetailModal'ın tek-call view (groups + nested options).
 * READ_ROLES (admin/cashier/waiter/kitchen).
 */
export interface ApiAttributeOption {
  id: string;
  group_id: string;
  name: string;
  extra_price_cents: number;
  is_default: boolean;
  sort_order: number;
}

export interface ApiEffectiveAttributeGroup {
  id: string;
  tenant_id: string;
  name: string;
  selection_type: 'single' | 'multiple';
  is_required: boolean;
  sort_order: number;
  source: 'product' | 'category';
  options: ApiAttributeOption[];
}

interface EffectiveGroupsResponse {
  data: { groups: ApiEffectiveAttributeGroup[] };
}

export function useEffectiveAttributeGroupsForProduct(productId: string | null) {
  return useQuery({
    queryKey: ['products', productId, 'effective-attribute-groups'],
    enabled: productId !== null,
    queryFn: async (): Promise<ApiEffectiveAttributeGroup[]> => {
      const res = await api.get<EffectiveGroupsResponse>(
        `/products/${productId}/attribute-groups/effective-with-options`,
      );
      return res.data.data.groups;
    },
    staleTime: 60_000,
  });
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

export interface UpdateOrderItemInput {
  orderId: string;
  itemId: string;
  patch: {
    note?: string | null;
    status?: 'cancelled';
    isComped?: boolean;
  };
}

/**
 * Persisted kalem partial update (PR-5).
 * - note: tüm staff
 * - status='cancelled' (void): item.status='new' → tüm staff;
 *   diğer durumda admin/cashier (backend RBAC)
 * - isComped toggle: admin/cashier (backend RBAC, ADR-013 §9.2)
 *
 * Backend yetkisiz işlem 403 AUTH_FORBIDDEN; UI tarafı toast.
 */
export function useUpdateOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: UpdateOrderItemInput,
    ): Promise<{ order: ApiOrder; items: ApiOrderItem[] }> => {
      const res = await api.patch<OrderWithItemsResponse>(
        `/orders/${input.orderId}/items/${input.itemId}`,
        input.patch,
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
