/**
 * Kitchen receipt (mutfak fişi) template.
 *
 * ADR-004 §7 — pure render: KitchenReceiptParams -> Uint8Array of ESC/POS bytes.
 * Caller is responsible for selecting kitchen destination and queueing the
 * resulting buffer into a print job; this module performs NO IO.
 *
 * ADR-004 Amendment 5 — Adisyo-tarzı yeniden tasarım, İKİ yerleşim (K1):
 * `order_type` dallanır — dine_in → Layout A (masa kompakt), takeaway/delivery
 * → Layout B (paket kurye fişi). 48 kolon (JP80H Font A; receipt-layout
 * yardımcıları bill-receipt ile ortak). Tüm dinamik alanlar `sanitizeForCP857`
 * ile temizlenir (K10 — kontrol-bayt enjeksiyonu + em-dash throw kapanır).
 * "1. MARŞ" kurs başlığı BASILMAZ (v5'te kavram yok — kullanıcı kararı).
 *
 * Layout A (dine_in, kompakt — İŞLETME BAŞLIĞI/MUTFAK ETİKETİ/FİYAT YOK; K2/K3):
 *   ESC @ + ESC t 29 (CP857 JP80H — ADR-004 Amd3, DEĞİŞMEZ)
 *   "<dd.MM.yyyy HH:mm:ss>"                       (yerel tarih-saat, sol)
 *   bold: "Adisyon No: <no>" ....... "<Bölge | Masa N>"   (twoCol)
 *   bold: "<çalışan>"
 *   ------ 48x '-' ------
 *   per item (bold): "<ad>" ............ "<adet> <porsiyon>"  (twoCol; K4)
 *     "  [opt1, opt2]"                          (seçenekler; K6)
 *     bold: "<NOT BÜYÜK HARF>"                  (K5)
 *   ------ 48x '-' ------
 *   center dblW+dblH bold: "- <order_no> -"     (günlük sıra — mutfak seslenişi)
 *   feed(4) + CUT_FULL
 *
 * Layout B (paket kurye fişi — MÜŞTERİ/ADRES/ÖDEME + FİYAT VAR; K2/K7/K8):
 *   ESC @ + ESC t 29
 *   center dblW+dblH bold: <tenant_header>
 *   center: <dd.MM.yyyy HH:mm:ss>
 *   ====== 48x '=' ======
 *   "Adisyon No: <no>" / bold "<çalışan>" / "Sipariş Kanalı: <etiket>"
 *   ====== 48x '=' ======
 *   "Müşteri : <ad>" / "Telefon : <tel>" / "Adres : <word-wrap>" /
 *   "Tarif : <kurye notu>" / "Ödeme : <Nakit|Kredi Kartı>"   (yalnız dolular)
 *   ------ 48x '-' ------
 *   per item: "<ad>" · "<adet> <porsiyon>" · "<tutar>"   (threeColFit 24/12/12)
 *     "  [opt1, opt2]" + bold NOT satırı
 *   ====== 48x '=' ======
 *   dblH bold: "TUTAR" ................. "<toplam> TL"
 *   ====== 48x '=' ======
 *   center dblW+dblH bold: "AFİYET OLSUN"
 *   feed(4) + CUT_FULL
 */

import {
  encodeCP857,
  sanitizeForCP857,
  ESC_POS,
  align,
  printMode,
  boldOn,
  boldOff,
  doubleStrikeOn,
  buzzer,
  feed,
  concat,
} from '@restoran-pos/shared-domain';
import type { OrderType, PaymentType } from '@restoran-pos/shared-types';
import {
  MAJOR,
  MINOR,
  ORDER_TYPE_LABELS,
  PAYMENT_TYPE_LABELS,
  WIDTH,
  moneyDigits,
  moneyTL,
  threeColFit,
  twoCol,
} from './receipt-layout.js';

/** Layout B kalem kolonları: ad · "adet porsiyon" · tutar (Adisyo "1 Bir buç"). */
const B_NAME_W = 24;
const B_QTY_W = 12;
const B_AMT_W = WIDTH - B_NAME_W - B_QTY_W; // 12

/** Müşteri bloğu etiket kolonu: "Müşteri : " (8 + ': ' = 10). */
const LABEL_W = 8;

/** Kalem girdisi — ADR-004 Amd5 K4/K5/K6. */
export interface KitchenReceiptItem {
  name: string;
  qty: number;
  /** Porsiyon (`order_items.variant_name_snapshot`) — null → yalnız adet (K4). */
  variantName: string | null;
  /** Kalem tutarı (`order_items.total_cents`) — yalnız Layout B basar (K4). */
  lineTotalCents: number;
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
  /** Çalışan adı — null → ASCII "-" (em-dash CP857'de YOK; K10). */
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
  /** Layout B — sipariş toplamı ("TUTAR" satırı). */
  total_cents: number;
}

/** Helper: encode a text line and append LF. */
function line(text: string): Uint8Array {
  return concat(encodeCP857(text), ESC_POS.FEED_LINE);
}

/**
 * Etiketli + değer-kolonuna hizalı word-wrap satırları (Layout B müşteri bloğu):
 * "Adres   : Mahalle Mürefte Şarköy," / "          Sokak ..." biçiminde.
 * Uzun tek kelime (kolon genişliğini aşan) sert bölünür — satır taşmaz.
 */
function labeledLines(label: string, value: string): string[] {
  const prefix = `${label.padEnd(LABEL_W)}: `;
  const bodyW = WIDTH - prefix.length;
  const lines: string[] = [];
  let current = '';
  const push = (): void => {
    if (current !== '') {
      lines.push(current);
      current = '';
    }
  };
  for (let word of value.split(/\s+/)) {
    while (word.length > bodyW) {
      push();
      lines.push(word.slice(0, bodyW));
      word = word.slice(bodyW);
    }
    if (word === '') continue;
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= bodyW) current += ` ${word}`;
    else {
      push();
      current = word;
    }
  }
  push();
  if (lines.length === 0) lines.push('');
  return lines.map((l, i) =>
    i === 0 ? `${prefix}${l}` : `${' '.repeat(prefix.length)}${l}`,
  );
}

/** K4 — sağ kolon "adet + porsiyon" ("5 Tam"); variant null → yalnız adet. */
function qtyLabel(item: KitchenReceiptItem): string {
  const variant =
    item.variantName !== null && item.variantName.length > 0
      ? ` ${sanitizeForCP857(item.variantName)}`
      : '';
  return `${item.qty}${variant}`;
}

/** Kalem alt-satırları: seçenekler (K6) + BÜYÜK HARF bold not (K5). */
function pushItemSubLines(parts: Uint8Array[], item: KitchenReceiptItem): void {
  if (item.modifiers.length > 0) {
    // Seçenekler normal-boy + bold (Amd7 K3 — okunaklılık).
    parts.push(boldOn());
    parts.push(line(`  [${item.modifiers.map(sanitizeForCP857).join(', ')}]`));
    parts.push(boldOff());
  }
  if (item.note !== null && item.note.length > 0) {
    // Türkçe-doğru büyük harf (i→İ, ı→I) SONRA sanitize (K5). Normal-boy + bold.
    parts.push(boldOn());
    parts.push(line(sanitizeForCP857(item.note.toLocaleUpperCase('tr-TR'))));
    parts.push(boldOff());
  }
}

/**
 * Render a kitchen receipt to an ESC/POS byte buffer.
 *
 * Pure function: no IO, no clock, no randomness.
 */
export function renderKitchenReceipt(
  params: KitchenReceiptParams,
): Uint8Array {
  return params.order_type === 'dine_in'
    ? renderLayoutA(params)
    : renderLayoutB(params);
}

/** Layout A — masa (dine_in) kompakt fişi (K2). */
function renderLayoutA(params: KitchenReceiptParams): Uint8Array {
  const parts: Uint8Array[] = [];

  // RESET + codepage İLK baytlar olmalı (byte-level test sözleşmesi; Amd3).
  parts.push(ESC_POS.RESET);
  parts.push(ESC_POS.CODEPAGE_CP857);
  parts.push(doubleStrikeOn()); // KOYULUK global-açık (Amd7 K2)
  parts.push(buzzer()); // Bip/sesli-uyarı (Amd8 — Adisyo paritesi)
  parts.push(align('left'));

  // Yerel tarih-saat (K9 — RAW ISO bug'ı öldü).
  parts.push(line(params.created_at_local));

  // "Adisyon No: N" + sağda "Bölge | Masa N" (BOLD) — Adisyo paritesi.
  // Ayraç ' | ' ASCII (0x7C); dine_in'de table_label null olamaz (defansif '-').
  const tableText =
    params.table_label === null
      ? '-'
      : params.area_label !== null
        ? `${sanitizeForCP857(params.area_label)} | ${sanitizeForCP857(params.table_label)}`
        : sanitizeForCP857(params.table_label);
  parts.push(printMode({ bold: true }));
  parts.push(line(twoCol(`Adisyon No: ${params.order_no}`, tableText)));
  parts.push(line(sanitizeForCP857(params.server_name ?? '-')));
  parts.push(printMode());
  parts.push(line(MINOR));

  // Kalemler: çift-yükseklik + bold "ad ..... adet porsiyon" (K4) + alt-satırlar
  // (K5/K6). Çift-YÜKSEKLİK genişliği değiştirmez → twoCol 48-kolon korunur (Amd7 K3/K4).
  for (const item of params.items) {
    // ESC ! (printMode) — JP80H GS !'i render ETMİYOR, ESC !'i ediyor (S99
    // fiziksel-smoke: callout ESC!-ile büyük, ürün GS!-ile küçük çıktı). Çift-
    // yükseklik+bold tek ESC ! komutuyla; genişlik değişmez → 48-kolon korunur.
    parts.push(printMode({ bold: true, doubleHeight: true }));
    parts.push(line(twoCol(sanitizeForCP857(item.name), qtyLabel(item))));
    parts.push(printMode());
    pushItemSubLines(parts, item);
  }

  parts.push(line(MINOR));

  // Günlük sıra — ortada çift-boyut "- 109 -" (mutfak seslenişi, Adisyo paritesi).
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true, doubleWidth: true }));
  parts.push(line(`- ${params.order_no} -`));
  parts.push(printMode());
  parts.push(align('left'));

  parts.push(feed(4));
  parts.push(ESC_POS.CUT_FULL);
  return concat(...parts);
}

/** Layout B — paket (takeaway/delivery) kurye fişi (K2/K7/K8). */
function renderLayoutB(params: KitchenReceiptParams): Uint8Array {
  const parts: Uint8Array[] = [];

  parts.push(ESC_POS.RESET);
  parts.push(ESC_POS.CODEPAGE_CP857);
  parts.push(doubleStrikeOn()); // KOYULUK global-açık (Amd7 K2)
  parts.push(buzzer()); // Bip/sesli-uyarı (Amd8 — Adisyo paritesi)

  // İşletme adı (K3 — kurye/müşteriye giden fiş, kimlik anlamlı) + yerel saat.
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true, doubleWidth: true }));
  parts.push(line(sanitizeForCP857(params.tenant_header)));
  parts.push(printMode());
  parts.push(line(params.created_at_local));
  parts.push(align('left'));
  parts.push(line(MAJOR));

  // Meta: adisyon no + çalışan (bold) + sipariş kanalı.
  parts.push(line(`Adisyon No: ${params.order_no}`));
  parts.push(printMode({ bold: true }));
  parts.push(line(sanitizeForCP857(params.server_name ?? '-')));
  parts.push(printMode());
  parts.push(line(`Sipariş Kanalı: ${ORDER_TYPE_LABELS[params.order_type]}`));
  parts.push(line(MAJOR));

  // Müşteri bloğu — YALNIZ dolu alanlar (K8; müşterisiz paket fişi çökmez).
  const customerLines: string[] = [];
  if (params.customer_name !== null && params.customer_name.length > 0) {
    customerLines.push(
      ...labeledLines('Müşteri', sanitizeForCP857(params.customer_name)),
    );
  }
  if (params.customer_phone !== null && params.customer_phone.length > 0) {
    customerLines.push(
      ...labeledLines('Telefon', sanitizeForCP857(params.customer_phone)),
    );
  }
  if (params.delivery_address !== null && params.delivery_address.length > 0) {
    customerLines.push(
      ...labeledLines('Adres', sanitizeForCP857(params.delivery_address)),
    );
  }
  if (params.delivery_note !== null && params.delivery_note.length > 0) {
    customerLines.push(
      ...labeledLines('Tarif', sanitizeForCP857(params.delivery_note)),
    );
  }
  if (params.planned_payment_type !== null) {
    customerLines.push(
      ...labeledLines('Ödeme', PAYMENT_TYPE_LABELS[params.planned_payment_type]),
    );
  }
  for (const l of customerLines) parts.push(line(l));
  if (customerLines.length > 0) parts.push(line(MINOR));

  // Kalemler — 3 kolon: ad · "adet porsiyon" · tutar (K4; Adisyo "1 Bir buç").
  // Çift-yükseklik + bold (Amd7 K3); threeColFit genişliği etkilenmez → 24/12/12
  // hizalama korunur (K4).
  for (const item of params.items) {
    // ESC ! (printMode) — JP80H GS !'i render etmez (S99 smoke). Çift-yükseklik+
    // bold tek komut; genişlik değişmez → threeColFit 24/12/12 korunur.
    parts.push(printMode({ bold: true, doubleHeight: true }));
    parts.push(
      line(
        threeColFit(
          sanitizeForCP857(item.name),
          qtyLabel(item),
          moneyDigits(item.lineTotalCents),
          B_NAME_W,
          B_QTY_W,
          B_AMT_W,
        ),
      ),
    );
    parts.push(printMode());
    pushItemSubLines(parts, item);
  }

  // TUTAR (bill paritesi: dblH bold; doubleWidth twoCol hizasını bozar).
  parts.push(line(MAJOR));
  parts.push(printMode({ bold: true, doubleHeight: true }));
  parts.push(line(twoCol('TUTAR', moneyTL(params.total_cents))));
  parts.push(printMode());
  parts.push(line(MAJOR));

  // Footer — AFİYET OLSUN (Adisyo paket fişi paritesi).
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true, doubleWidth: true }));
  parts.push(line('AFİYET OLSUN'));
  parts.push(printMode());
  parts.push(align('left'));

  parts.push(feed(4));
  parts.push(ESC_POS.CUT_FULL);
  return concat(...parts);
}
