import { describe, it, expect } from 'vitest';
import type { MoneyCents } from '@restoran-pos/shared-types';
import {
  canAddItemToPayment,
  calculatePayableCents,
  canCloseOrder,
  validateCashTendered,
} from './payment.js';

const cents = (n: number): MoneyCents => n as MoneyCents;

describe('canAddItemToPayment', () => {
  it('allows non-comped items into a payment', () => {
    expect(canAddItemToPayment({ isComped: false })).toEqual({ ok: true });
  });

  it('blocks comped items from a payment', () => {
    expect(canAddItemToPayment({ isComped: true })).toEqual({
      ok: false,
      reason: 'item_is_comped',
    });
  });

  it('returns the exact reason literal on the blocked branch (typo regression guard)', () => {
    const result = canAddItemToPayment({ isComped: true });
    if (result.ok) {
      throw new Error('expected blocked result');
    }
    expect(result.reason).toBe('item_is_comped');
  });
});

describe('calculatePayableCents', () => {
  it('returns total when nothing is comped', () => {
    expect(calculatePayableCents({ totalCents: cents(1000), compedAmountCents: cents(0) })).toBe(
      1000,
    );
  });

  it('subtracts a partial comp from the gross total', () => {
    expect(
      calculatePayableCents({ totalCents: cents(1000), compedAmountCents: cents(300) }),
    ).toBe(700);
  });

  it('returns 0 when the order is fully comped (defensive: caller usually skips)', () => {
    expect(
      calculatePayableCents({ totalCents: cents(1000), compedAmountCents: cents(1000) }),
    ).toBe(0);
  });

  it('throws RangeError when compedAmountCents exceeds totalCents', () => {
    expect(() =>
      calculatePayableCents({ totalCents: cents(1000), compedAmountCents: cents(1500) }),
    ).toThrow(RangeError);
  });
});

describe('canCloseOrder', () => {
  it('closes a fully-comped order with zero payment rows', () => {
    expect(
      canCloseOrder({
        isFullyComped: true,
        payableCents: cents(0),
        paymentsTotalCents: cents(0),
        paymentsCount: 0,
      }),
    ).toEqual({ ok: true });
  });

  it('blocks a fully-comped order that has any payment rows', () => {
    expect(
      canCloseOrder({
        isFullyComped: true,
        payableCents: cents(0),
        paymentsTotalCents: cents(0),
        paymentsCount: 1,
      }),
    ).toEqual({ ok: false, reason: 'fully_comped_but_payments_exist' });
  });

  it('closes a non-comped order when payments equal payable', () => {
    expect(
      canCloseOrder({
        isFullyComped: false,
        payableCents: cents(1500),
        paymentsTotalCents: cents(1500),
        paymentsCount: 1,
      }),
    ).toEqual({ ok: true });
  });

  it('blocks a non-comped order when payments are below payable (underpaid)', () => {
    expect(
      canCloseOrder({
        isFullyComped: false,
        payableCents: cents(1500),
        paymentsTotalCents: cents(1000),
        paymentsCount: 1,
      }),
    ).toEqual({ ok: false, reason: 'underpaid' });
  });

  it('blocks a non-comped order when payments exceed payable (overpaid)', () => {
    expect(
      canCloseOrder({
        isFullyComped: false,
        payableCents: cents(1500),
        paymentsTotalCents: cents(2000),
        paymentsCount: 1,
      }),
    ).toEqual({ ok: false, reason: 'overpaid' });
  });

  it('closes a zero-payable, non-comped order with zero payments (edge: nothing to pay)', () => {
    expect(
      canCloseOrder({
        isFullyComped: false,
        payableCents: cents(0),
        paymentsTotalCents: cents(0),
        paymentsCount: 0,
      }),
    ).toEqual({ ok: true });
  });

  it('blocks a non-comped order with no payments and a positive payable as underpaid', () => {
    expect(
      canCloseOrder({
        isFullyComped: false,
        payableCents: cents(500),
        paymentsTotalCents: cents(0),
        paymentsCount: 0,
      }),
    ).toEqual({ ok: false, reason: 'underpaid' });
  });

  it('returns exact reason literals on all blocked branches (typo regression guard)', () => {
    const underpaid = canCloseOrder({
      isFullyComped: false,
      payableCents: cents(100),
      paymentsTotalCents: cents(50),
      paymentsCount: 1,
    });
    const overpaid = canCloseOrder({
      isFullyComped: false,
      payableCents: cents(100),
      paymentsTotalCents: cents(200),
      paymentsCount: 1,
    });
    const compedConflict = canCloseOrder({
      isFullyComped: true,
      payableCents: cents(0),
      paymentsTotalCents: cents(0),
      paymentsCount: 2,
    });
    if (underpaid.ok || overpaid.ok || compedConflict.ok) {
      throw new Error('expected all three to be blocked');
    }
    expect(underpaid.reason).toBe('underpaid');
    expect(overpaid.reason).toBe('overpaid');
    expect(compedConflict.reason).toBe('fully_comped_but_payments_exist');
  });
});

describe('validateCashTendered', () => {
  it('returns ok with zero change when tendered equals amount', () => {
    expect(
      validateCashTendered({ amountCents: cents(1500), tenderedCents: cents(1500) }),
    ).toEqual({ ok: true, changeCents: 0 });
  });

  it('returns ok with positive change when tendered exceeds amount', () => {
    expect(
      validateCashTendered({ amountCents: cents(1500), tenderedCents: cents(2000) }),
    ).toEqual({ ok: true, changeCents: 500 });
  });

  it('blocks when tendered is below amount', () => {
    expect(
      validateCashTendered({ amountCents: cents(1500), tenderedCents: cents(1000) }),
    ).toEqual({ ok: false, reason: 'tendered_below_amount' });
  });

  it('returns ok with zero change for zero amount and zero tendered (edge)', () => {
    expect(validateCashTendered({ amountCents: cents(0), tenderedCents: cents(0) })).toEqual({
      ok: true,
      changeCents: 0,
    });
  });

  it('returns full tendered as change when amount is zero (edge)', () => {
    expect(
      validateCashTendered({ amountCents: cents(0), tenderedCents: cents(100) }),
    ).toEqual({ ok: true, changeCents: 100 });
  });
});
