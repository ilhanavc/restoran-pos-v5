import { describe, expect, it } from 'vitest';
import { centsToAmountInput } from './amount-input';

// Same parsing the payment modals apply to the field (DetailedPaymentModal / SplitPaymentModal).
const parseLikeModal = (input: string): number => Math.round(Number(input.trim().replace(',', '.')) * 100);

describe('centsToAmountInput', () => {
  it('uses a decimal comma', () => {
    expect(centsToAmountInput(38500)).toBe('385,00');
    expect(centsToAmountInput(1250)).toBe('12,50');
    expect(centsToAmountInput(5)).toBe('0,05');
    expect(centsToAmountInput(123456789)).toBe('1234567,89'); // no thousands separator
  });

  it('round-trips through the modal parser to the same cents', () => {
    for (const cents of [0, 5, 99, 1250, 38500, 100000, 123456789]) {
      expect(parseLikeModal(centsToAmountInput(cents))).toBe(cents);
    }
  });
});
