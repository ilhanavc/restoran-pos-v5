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

const ORDERS_KEY = ['orders'] as const;

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
  /**
   * ADR-013 Amendment 1 — attempt-sabit idempotency token. Retry (timeout sonrası
   * tekrar Kaydet) aynı key'i gönderir → sunucu tek sipariş garantiler (200 replay).
   */
  idempotencyKey?: string;
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
  /**
   * ADR-013 Amendment 1 — attempt-sabit batch idempotency token. Retry aynı
   * key'i gönderir → kalemler duplike EDİLMEZ (200 replay, güncel sipariş).
   */
  batchKey?: string;
}

export function useAddOrderItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: AddOrderItemsInput,
    ): Promise<{ order: ApiOrder; items: ApiOrderItem[] }> => {
      const res = await api.post<OrderWithItemsResponse>(
        `/orders/${input.orderId}/items`,
        { items: input.items, batchKey: input.batchKey },
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

export interface MoveOrderTableInput {
  orderId: string;
  tableId: string;
}

/**
 * PATCH /orders/:orderId/table — "Masayı Değiştir" (ADR-028 Karar A/H).
 *
 * Aktif dine-in siparişi aynı tenant içinde BAŞKA bir BOŞ masaya taşır.
 * Body `{ tableId }` (hedef masa). 200 + güncellenmiş sipariş projeksiyonu.
 * Permission `orders.move` (admin/cashier/waiter — backend RBAC).
 *
 * Başarıda HEM ['orders'] HEM ['tables'] invalidate: sipariş `table_id`/snapshot
 * ve iki masanın doluluğu değişir. Backend ayrıca 2× `tables.changed` emit eder
 * (kaynak+hedef, ADR-028 Karar D) → realtime board zaten tazelenir; buradaki
 * invalidate belt-and-suspenders (bu terminalin kendi cache'i).
 *
 * NOT: Yanıt gövdesi DÜZ camelCase sipariş DTO'sudur (`{ data: {...} }`,
 * orders.ts `toOrderResponseDto`) — GET /orders/:id'nin `{ order, items }`
 * şekli DEĞİL. Bu yüzden cache prime YAPILMAZ (yanlış şekil yazmak
 * useOrderById tüketicilerini bozar); invalidate refetch'i zaten tetikler.
 * Mobil ikizi ile simetrik (apps/mobile features/tables/queries.ts useMoveTable).
 *
 * Hata kodları (res.body.error.code): 409 TABLE_ALREADY_OCCUPIED /
 * 404 TABLE_NOT_FOUND / 409 TABLE_MOVE_SAME_TABLE / 409 ORDER_NOT_DINE_IN /
 * 409 ORDER_ALREADY_CLOSED / 404 ORDER_NOT_FOUND.
 */
export function useMoveOrderTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MoveOrderTableInput): Promise<void> => {
      await api.patch(`/orders/${input.orderId}/table`, {
        tableId: input.tableId,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}

export interface MergeOrderTableInput {
  sourceOrderId: string;
  targetTableId: string;
}

/**
 * POST /orders/:sourceOrderId/merge — "Adisyon Aktar" (ADR-029 Karar E/H).
 *
 * Kaynak dine-in siparişin kalemlerini HEDEF DOLU masanın siparişine re-parent
 * eder (birleştirir); kaynak sipariş terminal `merged` olur, masası boşalır.
 * Body `{ targetTableId }` (hedef DOLU masa). MoveTableModal ("Masayı Değiştir")
 * ikizi — fark: hedef boş değil dolu, kalemler taşınır (yalnız etiket değil).
 *
 * Başarıda HEM ['orders'] HEM ['tables'] invalidate: iki siparişin durumu +
 * iki masanın doluluğu değişir. Backend ayrıca 2× `tables.changed` emit eder
 * (kaynak boşaldı + hedef büyüdü, ADR-029 Karar E) → realtime board zaten
 * tazelenir; buradaki invalidate belt-and-suspenders (bu terminalin cache'i).
 *
 * NOT: useMoveOrderTable gibi yanıt gövdesi (düz HEDEF sipariş DTO'su)
 * CAST EDİLMEZ — `Promise<void>` + invalidate-only. Yanlış cast onSuccess'te
 * TypeError → mutasyon reject → başarılıyken UI hata basar
 * ([[feedback_mutation_response_shape_mismatch]], ADR-029 Karar G).
 *
 * Hata kodları (res.body.error.code): 409 MERGE_SAME_ORDER /
 * 409 MERGE_TARGET_NOT_OCCUPIED / 409 ORDER_HAS_PAYMENTS /
 * 409 ORDER_NOT_DINE_IN / 409 ORDER_ALREADY_CLOSED / 404 ORDER_NOT_FOUND.
 */
export function useMergeOrderTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MergeOrderTableInput): Promise<void> => {
      await api.post(`/orders/${input.sourceOrderId}/merge`, {
        targetTableId: input.targetTableId,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// ADR-017 — Paket servis (takeaway) hooks
// ─────────────────────────────────────────────────────────────────────────

export type TakeawayStage = 'preparing' | 'out_for_delivery' | 'delivered';
export type PlannedPaymentType = 'cash' | 'card' | 'transfer';

export interface TakeawayOrderItemInput {
  productId: string;
  quantity: number;
  note?: string;
  selectedAttributes?: SelectedAttributeInput[];
  variantId?: string;
}

export interface CreateTakeawayOrderInput {
  customerId: string;
  customerAddressId?: string;
  deliveryNote?: string;
  plannedPaymentType: PlannedPaymentType;
  items: TakeawayOrderItemInput[];
}

export interface TakeawayOrderItemResponse {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  notes: string | null;
}

export interface TakeawayOrderDetail {
  id: string;
  tenantId: string;
  type: OrderType;
  status: OrderStatus;
  takeawayStage: TakeawayStage | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddressSnapshot: string | null;
  deliveryNote: string | null;
  plannedPaymentType: PlannedPaymentType | null;
  items: TakeawayOrderItemResponse[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
}

interface TakeawayDetailEnvelope {
  data: TakeawayOrderDetail;
}

export interface OpenTakeawayOrderRow {
  id: string;
  orderNo: number;
  customerId: string | null;
  customerName: string | null;
  totalCents: number;
  takeawayStage: TakeawayStage;
  plannedPaymentType: PlannedPaymentType | null;
  createdAt: string;
}

interface OpenTakeawayListEnvelope {
  data: OpenTakeawayOrderRow[];
  total: number;
}

const TAKEAWAY_OPEN_KEY = [...ORDERS_KEY, 'takeaway', 'open'] as const;

/**
 * POST /orders — type=takeaway sipariş oluşturma (ADR-017 §3).
 * Backend customerId zorunlu (DB CHECK), plannedPaymentType cash|card.
 */
export function useCreateTakeawayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreateTakeawayOrderInput,
    ): Promise<TakeawayOrderDetail> => {
      const body = { type: 'takeaway' as const, ...input };
      const res = await api.post<TakeawayDetailEnvelope>('/orders', body);
      return res.data.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      void qc.invalidateQueries({ queryKey: TAKEAWAY_OPEN_KEY });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}

/**
 * GET /orders?type=takeaway&status=open — açık paket servis kuyruğu (ADR-017 §4).
 *
 * Canlılık realtime `orders.*` event'lerinden gelir (ADR-010 §11.6); panel
 * {@link useOpenTakeawayRealtimeInvalidate} ile abone olur. ADR-017 §6'nın 5sn
 * polling stopgap'i KALDIRILDI: takeaway lifecycle emit'leri (orders.created /
 * statusChanged / cancelled) PR-5d'de tanımlandı ve #229'da uçtan uca test
 * edildi (masa tahtasıyla aynı desen). `staleTime: 0` → invalidation anında
 * refetch tetikler.
 */
export function useOpenTakeawayOrders(enabled = true) {
  return useQuery({
    queryKey: TAKEAWAY_OPEN_KEY,
    enabled,
    queryFn: async (): Promise<OpenTakeawayOrderRow[]> => {
      const res = await api.get<OpenTakeawayListEnvelope>('/orders', {
        params: { type: 'takeaway', status: 'open' },
      });
      return res.data.data;
    },
    staleTime: 0,
  });
}

/**
 * Açık paket kuyruğunu realtime invalidate (ADR-010 §11.6) — masa tahtası
 * {@link useTableRealtimeInvalidate} muadili. Panel `orders.*` event'lerinde
 * çağırır; disabled query'de (panel gizli) invalidation no-op refetch'tir.
 */
export function useOpenTakeawayRealtimeInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: TAKEAWAY_OPEN_KEY });
  };
}

/**
 * PATCH /orders/:id/takeaway-stage — stage transition (ADR-017 §5).
 * Allowed: preparing→out_for_delivery, out_for_delivery→delivered.
 */
export function useUpdateTakeawayStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      orderId: string;
      stage: 'out_for_delivery' | 'delivered';
    }): Promise<TakeawayOrderDetail> => {
      const res = await api.patch<TakeawayDetailEnvelope>(
        `/orders/${input.orderId}/takeaway-stage`,
        { stage: input.stage },
      );
      return res.data.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      void qc.invalidateQueries({ queryKey: TAKEAWAY_OPEN_KEY });
    },
  });
}

/** POST /orders/:id/cancel — admin only (ADR-017 §5). */
export function useCancelTakeawayOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<void> => {
      await api.post(`/orders/${orderId}/cancel`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      void qc.invalidateQueries({ queryKey: TAKEAWAY_OPEN_KEY });
    },
  });
}

/**
 * PATCH /orders/:id/customer — Session 53 (v3 paritesi).
 *
 * Persisted siparişe müşteri ata / kaldır. `order_type` DEĞİŞMEZ; yalnız
 * `customer_id` UPDATE edilir. Backend constraint'leri:
 *   - 400 TAKEAWAY_CUSTOMER_REQUIRED: takeaway + customerId=null reddi
 *   - 409 ORDER_INVARIANT_VIOLATED: terminal status (paid/cancelled/void)
 *   - 404 ORDER_NOT_FOUND / CUSTOMER_NOT_FOUND
 *   - 409 CUSTOMER_BLACKLISTED
 */
export interface AssignCustomerInput {
  orderId: string;
  customerId: string | null;
}

export function useAssignCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: AssignCustomerInput,
    ): Promise<OrderWithItemsResponse> => {
      const res = await api.patch<OrderWithItemsResponse>(
        `/orders/${input.orderId}/customer`,
        { customerId: input.customerId },
      );
      return res.data;
    },
    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      void qc.invalidateQueries({ queryKey: [...ORDERS_KEY, input.orderId] });
      void qc.invalidateQueries({ queryKey: TAKEAWAY_OPEN_KEY });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}
