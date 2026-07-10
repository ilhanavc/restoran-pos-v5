/**
 * 48-kolon fiş yerleşim yardımcıları (POS-80/JP80H Font A tam genişlik).
 *
 * ADR-027 Amd1'de bill-receipt.ts içinde doğdu; ADR-004 Amd5 K1 mutfak şablonu
 * da aynı disiplini kullandığı için buraya çıkarıldı — davranış birebir,
 * yalnız taşıma. Pure string helpers: ESC/POS baytı üretmez, IO yapmaz.
 */

import { formatMoney } from '@restoran-pos/shared-domain';
import type { OrderType, PaymentType } from '@restoran-pos/shared-types';

export const WIDTH = 48;
/** Majör ayraç (bloklar arası). */
export const MAJOR = '='.repeat(WIDTH);
/** Minör ayraç (kalem/toplam/döküm sınırı). */
export const MINOR = '-'.repeat(WIDTH);
/** 3-kolon kalem satırı kolon genişlikleri: ad · adet · tutar (toplam = WIDTH). */
export const AMT_W = 12;
export const QTY_W = 6;
export const NAME_W = WIDTH - QTY_W - AMT_W; // 30

/** "Sipariş Kanalı" satırı — order_type Türkçe etiketi. */
export const ORDER_TYPE_LABELS: Readonly<Record<OrderType, string>> = {
  dine_in: 'Masa Siparişi',
  takeaway: 'Paket / Gel-Al',
  delivery: 'Paket / Adrese Teslim',
};

/** Ödeme satırları — payment_type Türkçe etiketi. */
export const PAYMENT_TYPE_LABELS: Readonly<Record<PaymentType, string>> = {
  cash: 'Nakit',
  card: 'Kredi Kartı',
  transfer: 'Havale/EFT',
};

/** CP857-safe money digits: "1.234,56" (₺ glyph CP857'de yok). */
export function moneyDigits(cents: number): string {
  // formatMoney → "₺1.234,56"; sembol + olası NBSP'yi at.
  return formatMoney(cents).replace(/[^\d.,-]/g, '');
}

/** Toplam/özet satırları için "1.234,56 TL". */
export function moneyTL(cents: number): string {
  return `${moneyDigits(cents)} TL`;
}

/**
 * Two-column line: left text + right-aligned amount, padded to {@link WIDTH}.
 * Left text is truncated if it would collide with the amount.
 */
export function twoCol(left: string, right: string): string {
  const maxLeft = WIDTH - right.length - 1;
  const leftFitted = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const gap = WIDTH - leftFitted.length - right.length;
  return `${leftFitted}${' '.repeat(gap > 0 ? gap : 1)}${right}`;
}

/**
 * Generic fitted 3-column line: her alan kendi genişliğine kırpılır/doldurulur
 * (ad sola, adet+tutar sağa dayalı). Toplam genişlik = nameW + qtyW + amtW.
 * Adisyo paritesi: taşan alan kırpılır ("Bir buçuk" → "Bir buç").
 */
export function threeColFit(
  name: string,
  qty: string,
  amount: string,
  nameW: number,
  qtyW: number,
  amtW: number,
): string {
  const nameField = name.length > nameW ? name.slice(0, nameW) : name.padEnd(nameW);
  const qtyField = qty.length > qtyW ? qty.slice(0, qtyW) : qty.padStart(qtyW);
  const amtField =
    amount.length > amtW ? amount.slice(0, amtW) : amount.padStart(amtW);
  return `${nameField}${qtyField}${amtField}`;
}

/**
 * Three-column item line (bill varsayılan genişlikleri): name (left, kırpılır)
 * · qty (orta, sağa) · amount (sağa dayalı). Toplam daima {@link WIDTH}.
 */
export function threeCol(name: string, qty: string, amount: string): string {
  return threeColFit(name, qty, amount, NAME_W, QTY_W, AMT_W);
}

/**
 * Centered label inside a full-width dash rule: "----- Ödemeler -----".
 * Etiket " label " biçiminde ortalanır, kalan {@link WIDTH} '-' ile doldurulur.
 */
export function centerLabel(label: string): string {
  const text = ` ${label} `;
  const dashes = WIDTH - text.length;
  if (dashes <= 0) return text.slice(0, WIDTH);
  const left = Math.floor(dashes / 2);
  return `${'-'.repeat(left)}${text}${'-'.repeat(dashes - left)}`;
}
