/**
 * Fiş metin yardımcıları (etiketler + para biçimi).
 *
 * ADR-027 Amd1'de bill-receipt.ts içinde doğdu; ADR-004 Amd5 K1 ile buraya
 * çıkarıldı. ADR-004 Amd9 (raster render) sonrası 48-kolon string-yerleşim
 * helper'ları (WIDTH/MAJOR/MINOR/twoCol/threeCol/threeColFit/centerLabel/moneyTL)
 * tüketicisiz kaldı ve kaldırıldı — hizalama artık canvas'ta measureText ile
 * (apps/api/src/print/raster/canvas-render.ts). Pure helpers: IO yapmaz.
 */

import { formatMoney } from '@restoran-pos/shared-domain';
import type { OrderType, PaymentType } from '@restoran-pos/shared-types';

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

/** Sembolsüz para: "1.234,56" (raster şablonları ₺'yi kendisi ekler). */
export function moneyDigits(cents: number): string {
  // formatMoney → "₺1.234,56"; sembol + olası NBSP'yi at.
  return formatMoney(cents).replace(/[^\d.,-]/g, '');
}
