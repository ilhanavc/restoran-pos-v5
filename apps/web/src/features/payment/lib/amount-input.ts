/**
 * Prefill / placeholder text for a payment amount field, in Turkish notation
 * ("385,00", not "385.00"). The payment modals parse with `.replace(',', '.')`,
 * so the comma form round-trips to the same cents. No thousands separator on
 * purpose: the parsers replace only the first comma.
 */
export function centsToAmountInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}
