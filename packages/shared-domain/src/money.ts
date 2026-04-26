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
  if (!/\d/.test(cleaned)) throw new TypeError(`parseMoney: cannot parse "${formatted}"`);
  const negative = cleaned.startsWith('-');
  const abs = negative ? cleaned.slice(1) : cleaned;
  const dotIndex = abs.indexOf('.');
  const wholePart = dotIndex === -1 ? abs : abs.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? '' : abs.slice(dotIndex + 1);
  const whole = parseInt(wholePart || '0', 10);
  const frac = parseInt(fracPart.padEnd(2, '0').slice(0, 2), 10);
  if (isNaN(whole) || isNaN(frac)) throw new TypeError(`parseMoney: cannot parse "${formatted}"`);
  const cents = whole * 100 + frac;
  return (negative ? -cents : cents) as MoneyCents;
}
