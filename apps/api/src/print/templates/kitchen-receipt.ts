/**
 * Kitchen receipt (mutfak fişi) template.
 *
 * ADR-004 §7 — pure render: KitchenReceiptParams -> Uint8Array of ESC/POS bytes.
 * Caller selects kitchen destination and queues the buffer; NO IO here.
 *
 * ADR-004 Amendment 5 — İKİ yerleşim (K1): `order_type` dallanır — dine_in →
 * Layout A (masa kompakt), takeaway/delivery → Layout B (paket kurye fişi).
 *
 * ADR-004 Amendment 9 (2026-07-19) — RASTER render: `@napi-rs/canvas` 576px
 * bitmap → `GS v 0`. Alan İÇERİĞİ + 2-layout ayrımı AYNI; yalnız render
 * mekanizması text→raster. Yumuşak font + Türkçe doğrudan → `sanitizeForCP857`/
 * `encodeCP857`/ESC-t codepage GEREKMEZ (K3/K4). Ürün-adı+adet BÜYÜK punto
 * (uzaktan-okunur); günlük-sıra "- N -" ortalı büyük.
 *
 * Layout A (dine_in, kompakt — İŞLETME BAŞLIĞI/FİYAT YOK; K2/K3):
 *   tarih-saat (sol küçük) / bold "Adisyon No: N" ....... "Bölge | Masa N" /
 *   bold çalışan → çizgi → per item BÜYÜK "<ad> ...... <adet porsiyon>" +
 *   modifiye/not alt-satır → çizgi → ortalı büyük "- N -".
 *
 * Layout B (paket fişi — MÜŞTERİ/ADRES/ÖDEME var, FİYAT YOK; K2/K7/K8):
 *   ortalı büyük tenant +
 *   tarih → çizgi → meta (Adisyon No / çalışan / kanal) → çizgi → müşteri bloğu
 *   (yalnız dolu: Müşteri/Telefon/Adres-wrap/Tarif/Ödeme) → çizgi → per item
 *   (adet · ad-wrap) + modifiye/not → ortalı büyük "AFİYET OLSUN".
 *
 * ADR-032 Amendment 3 (2026-07-21): fiyat/TUTAR Layout B'den KALDIRILDI (K3 —
 * "mutfak fişinde tutar bilgisi olmasına gerek yok").
 *
 * ADR-032 Amd1 K16 (istasyon etiketi + "Fiş 1/2" parça göstergesi) 2026-07-21
 * kağıt-smoke'unda GERİ ALINDI. K16'nın gerekçesi "iki fiş yan yana gelirse
 * çift sipariş sanılır" idi; bu restoranın fiziksel yerleşiminde iki fiş ASLA
 * yan yana gelmiyor — ayrı istasyonlarda, ayrı yazıcılardan çıkıyorlar. Her
 * aşçı yalnız kendi yazıcısının fişini görüyor, dolayısıyla istasyon adı da
 * gereksiz tekrar. Ürün sahibi kağıda bakarak kaldırılmasını istedi.
 */

import type { OrderType, PaymentType } from '@restoran-pos/shared-types';
import { ReceiptCanvas, SIZES } from '../raster/canvas-render.js';
import {
  encodeRaster,
  wrapPrintJob,
  KITCHEN_TAIL_FEED_LINES,
} from '../raster/raster-encode.js';
import {
  ORDER_TYPE_LABELS,
  PAYMENT_TYPE_LABELS,
} from './receipt-layout.js';

/** Kalem girdisi — ADR-004 Amd5 K4/K5/K6. */
export interface KitchenReceiptItem {
  name: string;
  qty: number;
  /** Porsiyon (`order_items.variant_name_snapshot`) — null → yalnız adet (K4). */
  variantName: string | null;
  /** Seçenekler (`order_item_attributes.option_name_snapshot`) — K6. */
  modifiers: string[];
  /** Kalem notu — BÜYÜK HARF + bold ayrı satır basılır (K5). */
  note: string | null;
}

/** Input shape for {@link renderKitchenReceipt} — ADR-004 Amd5. */
export interface KitchenReceiptParams {
  /** Yerleşim seçici (K1): dine_in → A, takeaway/delivery → B. */
  order_type: OrderType;
  /** İşletme adı — yalnız Layout B basar (K3). */
  tenant_header: string;
  /** Günlük sıra (per-tenant per-store_date) — A'da altta büyük punto. */
  order_no: number;
  /**
   * Kanonik masa etiketi (ADR-009 Amendment Karar A) — "Masa 2"; paket için
   * null. Layout A sağ-üst "Bölge | Masa N" bloğunda kullanılır.
   */
  table_label: string | null;
  /** Bölge adı (`order.area_name_snapshot`) — null ise yalnız masa basılır. */
  area_label: string | null;
  /** Çalışan adı — null → "-". */
  server_name: string | null;
  /** Pre-formatted yerel tarih-saat (K9 formatReceiptDateTime çıktısı). */
  created_at_local: string;
  items: KitchenReceiptItem[];
  /** Layout B — müşteri adı (canlı `customers.full_name`); null → satır yok. */
  customer_name: string | null;
  /** Layout B — müşteri telefonu (primary); null → satır yok. */
  customer_phone: string | null;
  /** Layout B — `orders.delivery_address_snapshot`; null → blok yok (K8). */
  delivery_address: string | null;
  /** Layout B — `orders.delivery_note` (kurye/adres tarifi); null → yok. */
  delivery_note: string | null;
  /** Layout B — `orders.planned_payment_type` (kapıda tahsilat türü; K7). */
  planned_payment_type: PaymentType | null;
}

/** K4 — "adet + porsiyon" ("5 Tam"); variant null → yalnız adet. */
function qtyLabel(item: KitchenReceiptItem): string {
  const variant =
    item.variantName !== null && item.variantName.length > 0
      ? ` ${item.variantName}`
      : '';
  return `${item.qty}${variant}`;
}

/** Kalem alt-satırları: seçenekler (K6) + BÜYÜK HARF bold not (K5). */
function pushItemSubLines(rc: ReceiptCanvas, item: KitchenReceiptItem): void {
  if (item.modifiers.length > 0) {
    rc.left(`[${item.modifiers.join(', ')}]`, { size: SIZES.meta, indentPx: 24 });
  }
  if (item.note !== null && item.note.length > 0) {
    // Türkçe-doğru büyük harf (i→İ, ı→I) — mutfak dikkat çekmesi (K5).
    rc.left(item.note.toLocaleUpperCase('tr-TR'), {
      size: SIZES.meta,
      bold: true,
      indentPx: 24,
    });
  }
}

/**
 * Render a kitchen receipt to an ESC/POS byte buffer (raster; ADR-004 Amd9).
 *
 * Pure function: no IO, no clock, no randomness.
 */
export function renderKitchenReceipt(params: KitchenReceiptParams): Uint8Array {
  const rc =
    params.order_type === 'dine_in'
      ? buildLayoutA(params)
      : buildLayoutB(params);
  // Mutfak yazıcılarında otomatik kesici yok → koparma payı (ADR-032 Amd1).
  return wrapPrintJob(encodeRaster(rc.build()), KITCHEN_TAIL_FEED_LINES);
}

/** Layout A — masa (dine_in) kompakt fişi (K2). */
function buildLayoutA(params: KitchenReceiptParams): ReceiptCanvas {
  const rc = new ReceiptCanvas();

  rc.left(params.created_at_local, { size: SIZES.small });

  // Çapa satırı: "Adisyon No: N" + sağda "BÖLGE | MASA N" (Adisyo paritesi).
  // Aşçı fişe bakınca önce masayı arar → bu satır meta'dan büyük (headerAnchor)
  // ve masa etiketi Türkçe-doğru BÜYÜK harf (i→İ, ı→I) ile vurgulanır.
  // Ürün sahibi geri bildirimi 2026-07-20: üst-bilgi "daha görünür ve kaliteli".
  const tableText =
    params.table_label === null
      ? '-'
      : params.area_label !== null
        ? `${params.area_label} | ${params.table_label}`
        : params.table_label;
  rc.leftRight(
    `Adisyon No: ${params.order_no}`,
    tableText.toLocaleUpperCase('tr-TR'),
    { size: SIZES.headerAnchor, bold: true },
  );
  rc.left(`Garson: ${params.server_name ?? '-'}`, {
    size: SIZES.meta,
    bold: true,
  });
  rc.rule('solid');

  // Kalemler: ürün-adı + adet BÜYÜK (uzaktan-okunur) + alt-satırlar (K4/K5/K6).
  for (const item of params.items) {
    rc.leftRight(item.name, qtyLabel(item), { size: SIZES.itemBig, bold: true });
    pushItemSubLines(rc, item);
  }
  rc.rule('solid');

  // Günlük sıra — ortada büyük "- 109 -" (mutfak seslenişi).
  rc.centered(`- ${params.order_no} -`, { size: SIZES.callout, bold: true });
  return rc;
}

/** Layout B — paket (takeaway/delivery) kurye fişi (K2/K7/K8). */
function buildLayoutB(params: KitchenReceiptParams): ReceiptCanvas {
  const rc = new ReceiptCanvas();

  // İşletme adı (K3 — kurye/müşteriye giden fiş) + yerel saat.
  rc.centered(params.tenant_header, { size: SIZES.header, bold: true });
  rc.centered(params.created_at_local, { size: SIZES.small });
  rc.rule('solid');

  // Meta: adisyon no + çalışan + sipariş kanalı — hepsi bold (S99 kağıt-smoke:
  // üst-bilgi "daha belirgin").
  rc.left(`Adisyon No: ${params.order_no}`, { size: SIZES.meta, bold: true });
  rc.left(params.server_name ?? '-', { size: SIZES.meta, bold: true });
  rc.left(`Sipariş Kanalı: ${ORDER_TYPE_LABELS[params.order_type]}`, {
    size: SIZES.meta,
    bold: true,
  });
  rc.rule('solid');

  // Müşteri bloğu — YALNIZ dolu alanlar (K8; müşterisiz paket fişi çökmez).
  // Adres/Tarif uzun → left() otomatik kaydırır.
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

  // Kalemler — adet · ad (wrap). Ürün-adı BÜYÜK punto.
  //
  // ADR-032 Amd3 K3 — kalem tutarı ve TUTAR satırı KALDIRILDI. Ürün sahibi
  // (2026-07-21): "mutfak fişlerinde, paket veya masa farketmeksizin tutar
  // bilgisi olmasına gerek yok." Layout A zaten fiyat basmıyordu; bu, iki
  // yerleşimi aynı ilkede birleştirir: mutfak fişi NE PİŞECEĞİNİ söyler,
  // para bilgisi kasa/paket fişinin işidir.
  //
  // Bu K1'in (paket siparişin istasyona bölünmesi) ÖN KOŞULUdur: Amd1 K4b
  // bölünmeye tam olarak "her istasyon fişinde TUTAR tekrarlanır ve kalem
  // toplamıyla çelişir" diye karşı çıkmıştı. Tutar kalkınca o çelişki
  // yapısal olarak imkânsız hale gelir.
  for (const item of params.items) {
    rc.itemRow(qtyLabel(item), item.name, '', {
      size: SIZES.itemBig,
      bold: true,
    });
    pushItemSubLines(rc, item);
  }
  rc.rule('solid');

  // Footer — AFİYET OLSUN (Adisyo paket fişi paritesi).
  rc.centered('AFİYET OLSUN', { size: SIZES.header, bold: true });
  return rc;
}
