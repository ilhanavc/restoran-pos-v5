import type { MoneyCents } from '@restoran-pos/shared-types';

export function addMoney(a: MoneyCents, b: MoneyCents): MoneyCents {
  return (a + b) as MoneyCents;
}

export function subtractMoney(a: MoneyCents, b: MoneyCents): MoneyCents {
  const result = a - b;
  if (result < 0) throw new RangeError('subtractMoney: result cannot be negative');
  return result as MoneyCents;
}

export function multiplyMoney(a: MoneyCents, factor: number): MoneyCents {
  if (factor < 0) throw new RangeError('multiplyMoney: factor cannot be negative');
  return Math.round(a * factor) as MoneyCents;
}

export function formatMoney(cents: MoneyCents, locale = 'tr-TR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function parseMoney(formatted: string): MoneyCents {
  const cleaned = formatted.replace(/[^\d,.-]/g, '').replace(',', '.');
  const value = parseFloat(cleaned);
  if (isNaN(value)) throw new TypeError(`parseMoney: cannot parse "${formatted}"`);
  return Math.round(value * 100) as MoneyCents;
}
