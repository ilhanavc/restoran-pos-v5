import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  OrderCancelReason,
  PaymentVoidReason,
} from '@restoran-pos/shared-types';
import { api } from '../../lib/api';

/**
 * Payment API hooks — ADR-014 §1 (Hızlı Öde) + §5 (Detaylı/Split) + §9 (amendment).
 *
 * Backend endpoints (apps/api/src/routes/payments.ts + orders.ts):
 *   POST   /payments               — yeni ödeme (full | partial | item scope)
 *   GET    /payments?orderId=X     — sipariş için tüm ödemeler (Ödenen toplam)
 *   POST   /payments/:paymentId/void — ödeme geri al + koşullu reopen (ADR-033)
 *   POST   /orders/:id/cancel { reason } — sipariş iptali (3-nokta menü).
 *          ADR-027 Amd2 ile kanonik uca geçildi (eskiden
 *          `PATCH /orders/:id { status:'cancelled' }` idi) — mobil ile aynı yol,
 *          aynı sebep listesi, aynı para kapısı.
 */

export type PaymentType = 'cash' | 'card' | 'transfer';
export type PaymentScope = 'full' | 'partial' | 'item';
export type PaymentOperation =
  | 'pay'
  | 'pay_and_close'
  | 'pay_and_print'
  | 'pay_and_print_close';

export interface ApiPayment {
  id: string;
  tenant_id: string;
  order_id: string;
  payment_type: PaymentType;
  payment_scope: PaymentScope;
  amount_cents: number;
  idempotency_key: string;
  created_by_user_id: string | null;
  created_at: string;
  /** ADR-014 §10 — split payer etiketi (yoksa null). */
  payer_no: number | null;
  payer_label: string | null;
  /** ADR-033 K1 soft-void üçlüsü — voided_at null = aktif ödeme. */
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason_code: PaymentVoidReason | null;
}

export interface PaymentItemAllocationInput {
  orderItemId: string;
  quantity: number;
}

export interface CreatePaymentInput {
  orderId: string;
  paymentType: PaymentType;
  paymentScope: PaymentScope;
  amountCents: number;
  idempotencyKey: string;
  operation?: PaymentOperation;
  itemAllocations?: PaymentItemAllocationInput[];
  /** ADR-014 §10 Karar 10.5 — Migration 024 yeni alanlar. */
  cashReceivedCents?: number;
  payerNo?: number;
  payerLabel?: string;
  note?: string;
  /** ADR-014 §11 Karar 11.3 — bahşiş (Migration 025). */
  tipAmountCents?: number;
}

/**
 * GET /payments/orders/:orderId/split-state — ADR-014 §10 Karar 10.2.
 * Tek-call DTO: items + allocations + totals + has_unallocated_payments.
 */
export interface SplitStateItem {
  id: string;
  product_name: string;
  variant_name_snapshot: string | null;
  unit_price_cents: number;
  total_quantity: number;
  remaining_quantity: number;
  is_comped: boolean;
}

export interface SplitStateAllocation {
  payment_id: string;
  payer_no: number | null;
  payer_label: string | null;
  payment_type: PaymentType;
  amount_cents: number;
  items: Array<{ order_item_id: string; quantity: number; line_total_cents: number }>;
}

export interface SplitStateResponse {
  order: { id: string; status: string; table_id: string | null; total_cents: number };
  items: SplitStateItem[];
  allocations: SplitStateAllocation[];
  totals: {
    order_total_cents: number;
    paid_total_cents: number;
    remaining_total_cents: number;
    has_unallocated_payments: boolean;
  };
}

export function useSplitState(orderId: string | null) {
  return useQuery({
    queryKey: [...PAYMENTS_KEY, 'split-state', orderId],
    enabled: orderId !== null,
    queryFn: async (): Promise<SplitStateResponse> => {
      const res = await api.get<{ data: SplitStateResponse }>(
        `/payments/orders/${orderId}/split-state`,
      );
      return res.data.data;
    },
    staleTime: 0,
  });
}

/**
 * PATCH /orders/:id { status: 'paid' } — Mod B "Masayı Kapat".
 * ADR-014 §10 Karar 10.4 — zaten ödenmiş siparişi kapat.
 */
export function useCloseOrderAsPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orderId: string }): Promise<void> => {
      await api.patch(`/orders/${input.orderId}`, { status: 'paid' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}

interface PaymentCreateResponse {
  data: { payment: ApiPayment; replay?: boolean };
}

interface PaymentsListResponse {
  data: { payments: ApiPayment[] };
}

const PAYMENTS_KEY = ['payments'] as const;

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CreatePaymentInput,
    ): Promise<{ payment: ApiPayment; replay: boolean }> => {
      const res = await api.post<PaymentCreateResponse>('/payments', input);
      return {
        payment: res.data.data.payment,
        replay: res.data.data.replay === true,
      };
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: [...PAYMENTS_KEY, vars.orderId] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}

export function usePaymentsForOrder(orderId: string | null) {
  return useQuery({
    queryKey: [...PAYMENTS_KEY, orderId],
    enabled: orderId !== null,
    queryFn: async (): Promise<ApiPayment[]> => {
      const res = await api.get<PaymentsListResponse>('/payments', {
        params: { orderId },
      });
      return res.data.data.payments;
    },
    staleTime: 5_000,
  });
}

/**
 * POST /payments/:paymentId/void — ADR-033 aynı-gün ödeme void + koşullu
 * ATOMİK auto-reopen (K3). RBAC admin+cashier (backend 403 → toast).
 * `reopened=true` → paid order yeniden açıldı, masa tekrar dolu.
 *
 * Invalidation: PAYMENTS_KEY kökü (liste + split-state), orders/tables
 * (reopen tahtayı değiştirir), reports (dashboard ClosedOrdersPanel +
 * ciro SUM'ları voided'ı düşer — ADR-033 fan-out).
 */
export interface VoidPaymentInput {
  /** Yalnız cache invalidation için; endpoint paymentId üzerinden çalışır. */
  orderId: string;
  paymentId: string;
  reasonCode: PaymentVoidReason;
}

interface PaymentVoidResponse {
  data: { payment: ApiPayment; reopened: boolean };
}

export function useVoidPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: VoidPaymentInput,
    ): Promise<{ payment: ApiPayment; reopened: boolean }> => {
      const res = await api.post<PaymentVoidResponse>(
        `/payments/${input.paymentId}/void`,
        { reasonCode: input.reasonCode },
      );
      return {
        payment: res.data.data.payment,
        reopened: res.data.data.reopened,
      };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
      void qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

/**
 * PATCH /orders/:id { status: 'cancelled' } — ADR-014 §9 Karar 9.6.
 * 3-nokta menüden tetiklenir; admin/cashier RBAC. Confirm dialog UI'da.
 */
export interface CancelOrderInput {
  orderId: string;
  /**
   * ADR-027 Amendment 2 K7 — iptal sebebi (ENUM). Mobil ve web AYNI sebep
   * listesini kullanır; denetim kaydına kod olarak yazılır.
   */
  reason: OrderCancelReason;
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CancelOrderInput): Promise<void> => {
      // ADR-027 Amd2 K9 — KANONİK uç. Eskiden `PATCH /orders/:id` +
      // `{status:'cancelled'}` (deprecated dal) kullanılıyordu; mobil kanonik
      // ucu kullandığı için iki istemci ayrışıyordu (sebep yok, hata eşlemesi
      // farklı). Ürün sahibi "web ve mobil aynı işlevi görmeli" dedi → tek yol.
      await api.post(`/orders/${input.orderId}/cancel`, {
        reason: input.reason,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}

/**
 * POST /orders/:id/print-bill — on-demand müşteri adisyonu (kasa fişi) baskısı
 * (ADR-027 Faz A). 202 + `{ enqueued: true }`; Print Agent kasa yazıcısında basar.
 * comp/iptal/ödeme DEĞİL — yalnız baskı; admin/cashier/waiter RBAC (ADR-008 §7e).
 * Sipariş/masa durumunu değiştirmez → cache invalidate GEREKMEZ.
 */
export interface PrintBillInput {
  orderId: string;
}

export function usePrintBill() {
  return useMutation({
    mutationFn: async (input: PrintBillInput): Promise<void> => {
      await api.post(`/orders/${input.orderId}/print-bill`);
    },
  });
}
