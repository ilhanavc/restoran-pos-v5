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
