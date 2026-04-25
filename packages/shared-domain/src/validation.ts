import type { MoneyCents } from '@restoran-pos/shared-types';

export function assertPositiveCents(value: number, label = 'value'): asserts value is MoneyCents {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be integer cents`);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
}

export function assertNonNegativeCents(value: number, label = 'value'): asserts value is MoneyCents {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be integer cents`);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
}

// v3 domain rule: store last 4 digits only (KVKK orantılılık ilkesi)
export function maskPhone(normalizedPhone: string): string {
  if (normalizedPhone.length < 4) throw new RangeError('Phone too short to mask');
  return `****${normalizedPhone.slice(-4)}`;
}

export function isValidNormalizedPhone(phone: string): boolean {
  return /^\+?[0-9]{10,15}$/.test(phone);
}
