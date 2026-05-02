import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

/**
 * Payment API hooks — ADR-014 §1 (Hızlı Öde) + §5 (Detaylı/Split) + §9 (amendment).
 *
 * Backend endpoints (apps/api/src/routes/payments.ts + orders.ts):
 *   POST   /payments               — yeni ödeme (full | partial | item scope)
 *   GET    /payments?orderId=X     — sipariş için tüm ödemeler (Ödenen toplam)
 *   PATCH  /orders/:id { status: 'cancelled' } — sipariş iptali (3-nokta menü)
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
 * PATCH /orders/:id { status: 'cancelled' } — ADR-014 §9 Karar 9.6.
 * 3-nokta menüden tetiklenir; admin/cashier RBAC. Confirm dialog UI'da.
 */
export interface CancelOrderInput {
  orderId: string;
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CancelOrderInput): Promise<void> => {
      await api.patch(`/orders/${input.orderId}`, { status: 'cancelled' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['tables'] });
    },
  });
}
