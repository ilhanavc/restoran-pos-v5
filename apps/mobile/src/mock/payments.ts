import type { QuickPayInput, SplitState } from '../api/payments';

/**
 * Mock payment + print backend (ADR-027 Faz A + ADR-026 K8 mock-first).
 *
 * Lets the 3-dot Quick Pay / Yazdır flows run on a physical phone with no live
 * API (USE_MOCK = true). Remaining balances mirror the occupied-table order
 * totals in `mock/orders.ts` so the sheet's "Ödenecek Tutar" agrees with the
 * card. Replaced by the real transport in device testing (USE_MOCK = false).
 * Fabricated demo data — no PII, never a backend. Money is integer kuruş.
 */

const MOCK_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Order ids + totals from mock/orders.ts (occupied tables c1/c3/c7).
const REMAINING_BY_ORDER: Record<string, number> = {
  '00000000-0000-4000-8000-0000000000c1': 29_000,
  '00000000-0000-4000-8000-0000000000c3': 8_500,
  '00000000-0000-4000-8000-0000000000c7': 22_500,
};

/** Simulate `GET /payments/orders/:orderId/split-state` (no prior payments). */
export async function mockGetSplitState(orderId: string): Promise<SplitState> {
  await delay(MOCK_DELAY_MS);
  const remaining = REMAINING_BY_ORDER[orderId] ?? 0;
  return {
    orderId,
    status: 'open',
    orderTotalCents: remaining,
    paidTotalCents: 0,
    remainingTotalCents: remaining,
    hasUnallocatedPayments: false,
  };
}

/** Simulate `POST /payments` (accepts and returns a fabricated payment id). */
export async function mockCreatePayment(input: QuickPayInput): Promise<string> {
  await delay(MOCK_DELAY_MS);
  return `mock-payment-${input.orderId}`;
}

/** Simulate `POST /orders/:id/print-bill` (enqueue accepted). */
export async function mockPrintBill(_orderId: string): Promise<void> {
  await delay(MOCK_DELAY_MS);
}
