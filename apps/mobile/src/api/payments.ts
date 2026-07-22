import { z } from 'zod';
import type { OrderCancelReason } from '@restoran-pos/shared-types';

import { USE_MOCK } from '../config';
import {
  mockCreatePayment,
  mockGetSplitState,
  mockPrintBill,
} from '../mock/payments';
import { apiRequest } from './http';

/**
 * Payment + on-demand bill-print client (ADR-014 + ADR-027 Faz A).
 *
 * The waiter's 3-dot operational sheet consumes three waiter-accessible cloud
 * endpoints (RBAC opened in #217/#218): the split-state read (the authoritative
 * remaining balance), the quick-pay create (full amount + close + receipt,
 * ADR-014 `pay_and_print_close`), and the on-demand bill print. Money is
 * integer kuruş.
 *
 * Only the fields the mobile MVP needs are modelled — `paymentScope='full'` +
 * `operation='pay_and_print_close'` (Quick Pay); the split/partial/tip surface stays
 * on web (ADR-027 Split = v5.1). zod strips extra wire columns (no `.strict()`).
 */

export type PaymentMethod = 'cash' | 'card';

// ── GET /payments/orders/:orderId/split-state ─────────────────────────────────
const SplitStateResponseSchema = z.object({
  data: z.object({
    order: z.object({
      id: z.string(),
      status: z.string(),
      table_id: z.string().nullable(),
      total_cents: z.number(),
    }),
    totals: z.object({
      order_total_cents: z.number(),
      paid_total_cents: z.number(),
      remaining_total_cents: z.number(),
      has_unallocated_payments: z.boolean(),
    }),
  }),
});

/** The bill's payment state — `remainingTotalCents` is the Quick Pay amount authority. */
export interface SplitState {
  orderId: string;
  status: string;
  orderTotalCents: number;
  paidTotalCents: number;
  remainingTotalCents: number;
  /** True if a non-item (full/partial) payment already exists (ADR-014 §9). */
  hasUnallocatedPayments: boolean;
}

export async function getSplitState(orderId: string): Promise<SplitState> {
  if (USE_MOCK) {
    return mockGetSplitState(orderId);
  }
  const json = await apiRequest(
    `/payments/orders/${encodeURIComponent(orderId)}/split-state`,
  );
  const p = SplitStateResponseSchema.parse(json).data;
  return {
    orderId: p.order.id,
    status: p.order.status,
    orderTotalCents: p.totals.order_total_cents,
    paidTotalCents: p.totals.paid_total_cents,
    remainingTotalCents: p.totals.remaining_total_cents,
    hasUnallocatedPayments: p.totals.has_unallocated_payments,
  };
}

// ── POST /payments (Quick Pay: full amount + close + kasa fişi) ───────────────
/**
 * Quick Pay request body (ADR-014 Karar 1). `paymentScope='full'` +
 * `operation='pay_and_print_close'` settles the whole bill, frees the table AND
 * queues the kasa (adisyon) receipt; the backend enforces `*_close ⇒ full scope`.
 * `idempotencyKey` is UUID v4 (replay safety). `cashReceivedCents` (cash only)
 * equals the amount — exact tender, no change (ADR-014 §10.5). Built by
 * {@link buildQuickPayRequest}.
 *
 * **ADR-014 Amendment 2 (2026-07-22):** the operation used to be `pay_and_close`,
 * which prints NOTHING (K7 made the receipt opt-in). On mobile that left the
 * waiter with no way to hand the guest a receipt: closing the bill frees the
 * table, and the action sheet — the only route to `printBill` — is reachable
 * only while the table is occupied. Mobile therefore always opts in.
 */
export interface QuickPayInput {
  orderId: string;
  paymentType: PaymentMethod;
  paymentScope: 'full';
  amountCents: number;
  operation: 'pay_and_print_close';
  idempotencyKey: string;
  cashReceivedCents?: number;
}

const PaymentResponseSchema = z.object({
  data: z.object({
    payment: z.object({ id: z.string() }),
    replay: z.boolean().optional(),
  }),
});

/** Take a full quick payment and close the order. Returns the payment id. */
export async function createPayment(input: QuickPayInput): Promise<string> {
  if (USE_MOCK) {
    return mockCreatePayment(input);
  }
  const json = await apiRequest('/payments', { method: 'POST', body: input });
  return PaymentResponseSchema.parse(json).data.payment.id;
}

// ── POST /orders/:id/print-bill (on-demand adisyon) ───────────────────────────
/** Enqueue an on-demand bill print job (202 Accepted). Does not close the order. */
export async function printBill(orderId: string): Promise<void> {
  if (USE_MOCK) {
    await mockPrintBill(orderId);
    return;
  }
  await apiRequest(`/orders/${encodeURIComponent(orderId)}/print-bill`, {
    method: 'POST',
  });
}

// ── POST /orders/:id/cancel (adisyon iptali) ─────────────────────────────────
/**
 * Adisyonu iptal eder (ADR-027 Amendment 2).
 *
 * Sunucu, aktif ödemesi olan adisyonu ADMIN DAHİL kimse için iptal etmez →
 * `409 ORDER_HAS_PAYMENTS`. Terminal (ödenmiş/iptal/birleştirilmiş) adisyon →
 * `409 ORDER_CANCEL_NOT_ALLOWED`. Çağıran bu iki kodu ayırt edip kullanıcıya
 * anlamlı mesaj göstermeli — genel "işlem yapılamadı" yetersiz.
 *
 * `reason` API'de opsiyonel ama mobilde ZORUNLU (sebep seçilmeden buton pasif).
 */
export async function cancelOrder(
  orderId: string,
  reason: OrderCancelReason,
): Promise<void> {
  await apiRequest(`/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    body: { reason },
  });
}
