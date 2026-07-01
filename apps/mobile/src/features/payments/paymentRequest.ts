import { genIdempotencyKey } from '../../api/uuid';
import type { PaymentMethod, QuickPayInput } from '../../api/payments';

/**
 * Pure Quick Pay request builder (ADR-014 + ADR-027 Faz A).
 *
 * Isolated from React so the money-shaping logic is unit-testable and reviewable
 * in one place: a full-amount, order-closing payment. `paymentScope='full'` +
 * `operation='pay_and_close'` (the backend enforces `*_close ⇒ full scope`);
 * `amountCents` is the authoritative remaining balance (from split-state);
 * cash tender equals the amount (exact, no change, ADR-014 §10.5); card omits
 * `cashReceivedCents`. The idempotency key is injectable so a retried attempt
 * reuses the same key (replay-safe — one charge) while a fresh attempt gets a
 * new one.
 */
export function buildQuickPayRequest(params: {
  orderId: string;
  method: PaymentMethod;
  remainingCents: number;
  /** Reuse across retries of the SAME attempt; omit to mint a fresh key. */
  idempotencyKey?: string;
}): QuickPayInput {
  const { orderId, method, remainingCents } = params;
  return {
    orderId,
    paymentType: method,
    paymentScope: 'full',
    amountCents: remainingCents,
    operation: 'pay_and_close',
    idempotencyKey: params.idempotencyKey ?? genIdempotencyKey(),
    ...(method === 'cash' ? { cashReceivedCents: remainingCents } : {}),
  };
}
