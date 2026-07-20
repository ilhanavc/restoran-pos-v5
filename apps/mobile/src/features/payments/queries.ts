import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { OrderCancelReason } from '@restoran-pos/shared-types';

import {
  cancelOrder,
  createPayment,
  getSplitState,
  printBill,
  type QuickPayInput,
  type SplitState,
} from '../../api/payments';

/**
 * Payment-flow server-state hooks (ADR-027 Faz A + ADR-026 K4).
 *
 * Thin TanStack Query wrappers over the api/payments seam. The split-state read
 * is money, so it is never cached (`staleTime: 0`) — the Quick Pay sheet always
 * fetches the current remaining balance on open. A successful payment closes the
 * order, so it invalidates the tables board + open-order + payments caches (the
 * realtime `orders.statusChanged` also invalidates, so the masa card frees
 * either way). Query keys match the web client (realtime contract parity).
 */

/** The bill's payment state; disabled until an order id is supplied. */
export function useSplitState(
  orderId: string | null,
): UseQueryResult<SplitState> {
  return useQuery({
    queryKey: ['payments', 'split-state', orderId],
    queryFn: () => getSplitState(orderId as string),
    enabled: orderId !== null,
    staleTime: 0,
  });
}

/** Take a full quick payment and close the order. */
export function useQuickPay(): UseMutationResult<string, Error, QuickPayInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickPayInput) => createPayment(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

/** Enqueue an on-demand bill print (does not mutate cached order/table state). */
export function usePrintBill(): UseMutationResult<void, Error, string> {
  return useMutation({
    mutationFn: (orderId: string) => printBill(orderId),
  });
}

/**
 * Adisyon iptali (ADR-027 Amendment 2). Başarıda masa boşalır → çağıran
 * `['tables']` ve aktif-sipariş cache'ini tazelemeli.
 */
export function useCancelOrder(): UseMutationResult<
  void,
  Error,
  { orderId: string; reason: OrderCancelReason }
> {
  return useMutation({
    mutationFn: ({ orderId, reason }) => cancelOrder(orderId, reason),
  });
}
