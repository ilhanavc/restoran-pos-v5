import type { MoneyCents } from '@restoran-pos/shared-types';

// basis points: 1000 = %10, 2000 = %20
export const VAT_FOOD_BPS = 1000;
export const VAT_BEVERAGE_BPS = 2000;

const CATEGORY_VAT_MAP: Record<string, number> = {
  yemek: VAT_FOOD_BPS,
  içecek: VAT_BEVERAGE_BPS,
  alkol: VAT_BEVERAGE_BPS,
  tatlı: VAT_FOOD_BPS,
};

export function getCategoryVatRateBps(categoryName: string): number {
  // Turkish locale lowercase: "İ" → "i", "I" → "ı"
  const normalized = categoryName.toLocaleLowerCase('tr-TR').trim();
  return CATEGORY_VAT_MAP[normalized] ?? VAT_FOOD_BPS;
}

export function calculateVat(subtotalCents: MoneyCents, rateBps: number): MoneyCents {
  if (rateBps < 0) throw new RangeError('VAT rate cannot be negative');
  return Math.round((subtotalCents * rateBps) / 10000) as MoneyCents;
}

export function calculateVatInclusive(grossCents: MoneyCents, rateBps: number): MoneyCents {
  if (rateBps < 0) throw new RangeError('VAT rate cannot be negative');
  return Math.round((grossCents * rateBps) / (10000 + rateBps)) as MoneyCents;
}
