/**
 * Payment domain policy.
 *
 * # Why this scope? (4 functions only)
 *
 * Phase 1.5 forensic verdict (audit Katman 1): charter Phase 1
 * "Menu/Payment/User entity ve policy'leri" maddesi yazılmadı (atlama).
 * Phase 1.5'te eksik 3 entity policy yazıldı.
 *
 * Payment için kapsam ADR-003 §10 + domain-rules.md "Ödeme/İkram"
 * bölümleri ile sınırlı. Çok katmanlı enforcement var:
 *
 *   - DB trigger (savunma): block_comped_item_in_payment (C1),
 *     propagate_full_comp (T1), recompute_comped_amount (T2),
 *     block_fully_comped_rollback (T3) — manuel SQL bypass'a karşı
 *   - Domain layer (authoritative, BU MODÜL): pure helper'lar —
 *     validation + calculation. Side-effect, DB write YOK.
 *   - Service layer (Phase 2 apps/api): OrderCompService transaction
 *     servisi — ADR-003 §10.2.3 "domain layer" terimi muğlak; Phase 2
 *     apps/api/src/services/orderComp.ts'de yazılır (Görev 10 DoD
 *     "shared-domain pure" kuralıyla uyumlu). Drift cleanup pass'inde
 *     ADR-003 §10.2.3 dosya yolu güncellenecek.
 *   - UI blokajı (Phase 2): kasiyer erken uyarı
 *
 * # Bu modülde YAZILMAYAN konular
 *
 *   - calculateEqualSplitAmounts (partial scope hesabı):
 *     ADR-003 §10.1(c) prose drift'li (eski 'equal_split' ismi).
 *     Drift cleanup (Phase 1.5 İş #7) sonrası Phase 2 payment
 *     endpoint'inde eklenir. YAGNI şimdi.
 *   - İskonto fonksiyonları: v5.1 (Sinyal #30, charter onayı).
 *   - Refund fonksiyonları: v5.1 kısmi refund; MVP tam iptal Phase
 *     2/3 endpoint'inde (refunds.amount_cents = SUM(payments)).
 *   - compItem / compFullOrder servis fonksiyonları: Phase 2
 *     apps/api/src/services/orderComp.ts (transactional, DB write).
 *   - payment_scope state machine: DB enum + trigger zaten enforce.
 *   - transfer payment_type için özel kural: zod schema yeter.
 *
 * # Source of truth
 *
 *   - ADR-003 §10.1 (payment_scope davranışları)
 *   - ADR-003 §10.2 (ikram enforcement, total_cents=GROSS)
 *   - ADR-003 §10.4 (invaryant listesi)
 *   - ADR-003 §10.5.2 C1 (block_comped_item_in_payment trigger)
 *   - docs/v3-reference/domain-rules.md "Ödeme" + "İkram" bölümleri
 *
 * # Caller integration (Phase 2)
 *
 * Repository / service layer caller'ları:
 *   - canAddItemToPayment: ödeme satırı oluşturmadan önce her
 *     order_item için pre-check. DB trigger zaten enforce eder ama
 *     domain pre-check UI'ya net hata mesajı verir (DB exception
 *     yerine).
 *   - calculatePayableCents: order detayında payable hesabı; rapor
 *     ekranlarında "ödenmesi gereken" göstergesi.
 *   - canCloseOrder: OrderService.closeOrder (Phase 2) çağırmadan
 *     önce zorunlu invariant kontrolü.
 *   - validateCashTendered: cash payment endpoint'inde tendered
 *     validation + change calc.
 */

import type { MoneyCents } from '@restoran-pos/shared-types';

// ── canAddItemToPayment ─────────────────────────────────────────

export type CanAddItemToPaymentReason = 'item_is_comped';

export type CanAddItemToPaymentResult =
  | { ok: true }
  | { ok: false; reason: CanAddItemToPaymentReason };

/**
 * Decides whether an order_item may be attached to a payment row.
 *
 * Rule (ADR-003 §10.5.2 C1 trigger `block_comped_item_in_payment`):
 * a comped (ikram) item cannot appear in any payment line. The DB
 * trigger enforces the invariant; this domain pre-check exists so
 * the UI surfaces a typed reason instead of a raw DB exception.
 */
export function canAddItemToPayment(input: {
  isComped: boolean;
}): CanAddItemToPaymentResult {
  if (input.isComped) {
    return { ok: false, reason: 'item_is_comped' };
  }
  return { ok: true };
}

// ── calculatePayableCents ───────────────────────────────────────

/**
 * Computes the amount the customer must still pay for an order.
 *
 * Rule (ADR-003 §10.2.2): `total_cents` is GROSS (full menu price).
 * Comped items reduce only the payable amount, not `total_cents`,
 * so reporting can recover full revenue and the comp loss separately.
 *
 * Throws `RangeError` if `compedAmountCents > totalCents`. DB
 * trigger T2 (`recompute_comped_amount`) keeps the invariant in
 * normal flow; this guard catches manual SQL or service bugs.
 */
export function calculatePayableCents(input: {
  totalCents: MoneyCents;
  compedAmountCents: MoneyCents;
}): MoneyCents {
  if (input.compedAmountCents > input.totalCents) {
    throw new RangeError('compedAmountCents cannot exceed totalCents');
  }
  return (input.totalCents - input.compedAmountCents) as MoneyCents;
}

// ── canCloseOrder ───────────────────────────────────────────────

export type CanCloseOrderReason =
  | 'underpaid'
  | 'overpaid'
  | 'fully_comped_but_payments_exist';

export type CanCloseOrderResult =
  | { ok: true }
  | { ok: false; reason: CanCloseOrderReason };

/**
 * Decides whether an order may transition to closed.
 *
 * Invariants (ADR-003 §10.4):
 *   I.  is_fully_comped === true → payments row count must be 0
 *       (zero rows, not zero-amount rows — see §10.2.1).
 *   II. is_fully_comped === false → SUM(payments) === payable.
 *
 * Returns the first violated invariant; callers map it to UI text.
 */
export function canCloseOrder(input: {
  isFullyComped: boolean;
  payableCents: MoneyCents;
  paymentsTotalCents: MoneyCents;
  paymentsCount: number;
}): CanCloseOrderResult {
  if (input.isFullyComped) {
    if (input.paymentsCount !== 0) {
      return { ok: false, reason: 'fully_comped_but_payments_exist' };
    }
    return { ok: true };
  }
  if (input.paymentsTotalCents < input.payableCents) {
    return { ok: false, reason: 'underpaid' };
  }
  if (input.paymentsTotalCents > input.payableCents) {
    return { ok: false, reason: 'overpaid' };
  }
  return { ok: true };
}

// ── validateCashTendered ────────────────────────────────────────

export type ValidateCashTenderedReason = 'tendered_below_amount';

export type ValidateCashTenderedResult =
  | { ok: true; changeCents: MoneyCents }
  | { ok: false; reason: ValidateCashTenderedReason };

/**
 * Validates the tendered cash for a cash payment and computes change.
 *
 * Rule (domain-rules.md "Ödeme"): for `payment_type='cash'`,
 * `tendered_cents` is required and must be `>= amount_cents`.
 * Caller is responsible for routing only cash payments here; the
 * function assumes cash semantics (no payment_type discriminator
 * to avoid YAGNI).
 */
export function validateCashTendered(input: {
  amountCents: MoneyCents;
  tenderedCents: MoneyCents;
}): ValidateCashTenderedResult {
  if (input.tenderedCents < input.amountCents) {
    return { ok: false, reason: 'tendered_below_amount' };
  }
  return {
    ok: true,
    changeCents: (input.tenderedCents - input.amountCents) as MoneyCents,
  };
}
