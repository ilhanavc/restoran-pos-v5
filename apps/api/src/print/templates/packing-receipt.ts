/**
 * Paket (kasa) fişi — ADR-032 Amendment 3 K4.
 *
 * ADR-004 §7 saf-render sözleşmesi: `params → Uint8Array`, IO yok.
 *
 * NE İŞE YARAR: paket siparişi girildiği anda KASA yazıcısından çıkar;
 * paketleyici ve kurye bu kâğıda bakar. İçeriği kasıtlı olarak mutfak fişinin
 * TERSİDİR — burada **fiyat, tutar, telefon, adres** vardır; mutfak fişinde
 * (Amd3 K3/K14) bunların hiçbiri yoktur.
 *
 * NEDEN AYRI ŞABLON (iki alternatif reddedildi, ADR K4):
 *  - Mevcut **adisyon fişini** (`bill-receipt.ts`) sipariş anında basmak
 *    reddedildi: o fiş bilinçli **PII-safe**'tir (müşteri verisi SELECT bile
 *    edilmez) ve ödeme dökümü + "Kalan" satırı basar → sipariş anında
 *    tahsil=0 olduğu için müşteriye anlamsız "kalan borç" izlenimi verir.
 *  - **Layout B'yi bir `show_prices` bayrağıyla** kasaya da göndermek
 *    reddedildi: K3 fiyatı YAPISAL olarak kaldırıyor; bayrak onu koşullu
 *    hale getirir — bayrak ters geçilirse mutfağa fiyat gider ve kimse fark
 *    etmez (fiş kâğıdı, test kapsamı dışı).
 *
 * `payload.kind='bill'` kullanılır (kasa agent'ı zaten `jobKinds:['bill']`)
 * → agent/exe/config/enum'a HİÇ dokunulmaz. Ayırt etme `meta.variant`'ladır.
 *
 * Kuyruk davranışı `bill-receipt` ile aynıdır: kasa yazıcısının **kesicisi
 * var**, o yüzden mutfağın koparma payı (`KITCHEN_TAIL_FEED_LINES`) burada
 * KULLANILMAZ — varsayılan besleme yeterlidir.
 */

import type { OrderType, PaymentType } from '@restoran-pos/shared-types';
import { ReceiptCanvas, SIZES } from '../raster/canvas-render.js';
import { encodeRaster, wrapPrintJob } from '../raster/raster-encode.js';
import {
  ORDER_TYPE_LABELS,
  PAYMENT_TYPE_LABELS,
  moneyDigits,
} from './receipt-layout.js';

/** Kalem girdisi — mutfak fişinden farkı: tutar BASILIR. */
export interface PackingReceiptItem {
  name: string;
  qty: number;
  /** Porsiyon (`order_items.variant_name_snapshot`) — null → yalnız adet. */
  variantName: string | null;
  /** Kalem tutarı (`order_items.total_cents`) — sağ kolonda basılır. */
  lineTotalCents: number;
  /** Seçenekler (`order_item_attributes.option_name_snapshot`). */
  modifiers: string[];
  /** Kalem notu — BÜYÜK HARF + bold ayrı satır. */
  note: string | null;
}

/** Input shape for {@link renderPackingReceipt}. */
export interface PackingReceiptParams {
  /** İşletme adı — ortalı başlık. */
  tenant_header: string;
  /** Sipariş kanalı etiketi için (`takeaway` | `delivery`). */
  order_type: OrderType;
  /** Günlük sıra numarası. */
  order_no: number;
  /** Siparişi giren çalışan — null → "-". */
  server_name: string | null;
  /** Pre-formatted yerel tarih-saat (K9 `formatReceiptDateTime` çıktısı). */
  created_at_local: string;
  items: PackingReceiptItem[];
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_note: string | null;
  planned_payment_type: PaymentType | null;
  /** Sipariş toplamı — "TUTAR" satırı. */
  total_cents: number;
}

/** "adet + porsiyon" ("5 Tam"); variant null → yalnız adet. */
function qtyLabel(item: PackingReceiptItem): string {
  const variant =
    item.variantName !== null && item.variantName.length > 0
      ? ` ${item.variantName}`
      : '';
  return `${item.qty}${variant}`;
}

/**
 * Paket fişini ESC/POS byte akışına render eder (raster; ADR-004 Amd9).
 *
 * Pure function: no IO, no clock, no randomness.
 */
export function renderPackingReceipt(params: PackingReceiptParams): Uint8Array {
  const rc = new ReceiptCanvas();

  // Başlık — işletme + "PAKET SİPARİŞ". İkinci satır kâğıt üzerinde bu fişi
  // adisyon fişinden ayırt eder (ikisi de aynı kasa yazıcısından çıkıyor).
  rc.centered(params.tenant_header, { size: SIZES.header, bold: true });
  rc.centered('PAKET SİPARİŞ', { size: SIZES.header, bold: true });
  rc.centered(params.created_at_local, { size: SIZES.small });
  rc.rule('solid');

  // Meta.
  rc.left(`Adisyon No: ${params.order_no}`, { size: SIZES.meta, bold: true });
  rc.left(params.server_name ?? '-', { size: SIZES.meta, bold: true });
  rc.left(`Sipariş Kanalı: ${ORDER_TYPE_LABELS[params.order_type]}`, {
    size: SIZES.meta,
    bold: true,
  });
  rc.rule('solid');

  // Müşteri/teslimat bloğu — YALNIZ dolu alanlar (müşterisiz paket çökmez).
  // Adres/Tarif uzun olabilir → left() otomatik kaydırır.
  let hasCustomerBlock = false;
  const label = (labelText: string, value: string): void => {
    rc.left(`${labelText}: ${value}`, { size: SIZES.meta, bold: true });
    hasCustomerBlock = true;
  };
  if (params.customer_name !== null && params.customer_name.length > 0) {
    label('Müşteri', params.customer_name);
  }
  if (params.customer_phone !== null && params.customer_phone.length > 0) {
    label('Telefon', params.customer_phone);
  }
  if (params.delivery_address !== null && params.delivery_address.length > 0) {
    label('Adres', params.delivery_address);
  }
  if (params.delivery_note !== null && params.delivery_note.length > 0) {
    label('Tarif', params.delivery_note);
  }
  if (params.planned_payment_type !== null) {
    label('Ödeme', PAYMENT_TYPE_LABELS[params.planned_payment_type]);
  }
  if (hasCustomerBlock) rc.rule('solid');

  // Kalemler — adet · ad · TUTAR (mutfak fişinin aksine fiyatlı).
  for (const item of params.items) {
    rc.itemRow(qtyLabel(item), item.name, moneyDigits(item.lineTotalCents), {
      size: SIZES.itemBig,
      bold: true,
    });
    if (item.modifiers.length > 0) {
      rc.left(`[${item.modifiers.join(', ')}]`, {
        size: SIZES.meta,
        indentPx: 24,
      });
    }
    if (item.note !== null && item.note.length > 0) {
      // Parantez (S104, ürün sahibi) — kasa/mutfak fişleriyle hizalı;
      // büyük harf + kalın vurgu KORUNUR.
      rc.left(`(${item.note.toLocaleUpperCase('tr-TR')})`, {
        size: SIZES.meta,
        bold: true,
        indentPx: 24,
      });
    }
  }

  rc.rule('solid');
  rc.leftRight('TUTAR', `${moneyDigits(params.total_cents)} ₺`, {
    size: SIZES.total,
    bold: true,
  });
  rc.rule('solid');

  rc.centered('AFİYET OLSUN', { size: SIZES.header, bold: true });

  // Kasa yazıcısının kesicisi var → varsayılan kuyruk beslemesi (mutfağın
  // koparma payı BURADA kullanılmaz; her fişte boşa kâğıt olurdu).
  return wrapPrintJob(encodeRaster(rc.build()));
}
