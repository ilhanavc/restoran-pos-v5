/**
 * Customer bill / adisyon receipt template (ADR-027 Faz A + Amendment 1).
 *
 * ADR-004 §7 — pure render: BillReceiptParams -> Uint8Array of ESC/POS bytes.
 * Caller (enqueue-bill-job) queues the resulting buffer into a print job; this
 * module performs NO IO / clock / randomness.
 *
 * ADR-027 Amendment 1 (Session 89) — Adisyo-tarzı yeniden tasarım: 48 sütun,
 * çift-boyut başlık/TUTAR/AFİYET OLSUN, 3-kolon kalem satırı (ad·adet·tutar),
 * kalem modifiye/not alt-satırları, ve parçalı/çok-türlü ödemede tahsil/kalan
 * dökümü. Para "TL" ile basılır: CP857 (1989) codepage'inde ₺ (U+20BA, 2012)
 * glyph'i YOK → "1.234,56 TL" (grafik ₺ = v5.1, kapsam kilidi).
 *
 * Layout (48 sütun, POS-80 CP857 tam genişlik):
 *   ESC @ / ESC t <codepage> (bill → kasa POS-80: CODEPAGE_CP857_PAGE61 / ESC t 61; ADR-004 Amd3)
 *   ====== 48x '=' (majör) ======
 *   center dblH+dblW  tenant_header
 *   center            created_at_local
 *   ====== 48x '=' (majör) ======
 *   "Adisyon No: <order_no>"
 *   "Garson: <server>" ............... "<area - masa> / PAKET"   (twoCol)
 *   "Sipariş Kanalı: <Masa Siparişi | Paket ...>"
 *   ------ 48x '-' (minör) ------
 *   per item:  "<name> ....... <qty> ....... <lineTotal>"   (3 kolon, tutar sağa)
 *     "  [modifier1, modifier2]"                             (modifiye alt-satır, varsa)
 *     "  (note)"                                             (not alt-satır, varsa)
 *   ====== 48x '=' (majör) ======
 *   dblH+bold  "TUTAR" .................. "<total> TL"
 *   --- koşullu döküm, YALNIZ payments.length > 1 ---
 *   ------ 48x '-' (minör) ------
 *   "Tahsil Edilen" .................... "<paidTotal> TL"
 *   ------------- Ödemeler -------------
 *   per payment:  "<tür>" ............... "<tutar>"          (twoCol, TL yok)
 *   "Kalan" ........................... "<remaining> TL"
 *   ====== 48x '=' (majör) ======
 *   center dblH+dblW  "AFİYET OLSUN"
 *   center            "Teşekkür ederiz!"
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
  feed,
  concat,
} from '@restoran-pos/shared-domain';
import type { OrderType, PaymentType } from '@restoran-pos/shared-types';
import {
  MAJOR,
  MINOR,
  ORDER_TYPE_LABELS,
  PAYMENT_TYPE_LABELS,
  centerLabel,
  moneyDigits,
  moneyTL,
  threeCol,
  twoCol,
} from './receipt-layout.js';

/** Input shape for {@link renderBillReceipt}. Money is integer kuruş. */
export interface BillReceiptParams {
  tenant_header: string;
  order_no: number;
  /** Sipariş kanalı — "Sipariş Kanalı" satırı (dine_in/takeaway/delivery). */
  order_type: OrderType;
  /**
   * Garson adı (`users.username` @ `orders.waiter_user_id`). null =
   * paket/atanmamış → ASCII "-" basılır (em-dash "—" CP857'de YOK → throw).
   */
  server_name: string | null;
  /**
   * Kanonik masa etiketi (ADR-009 Amendment 2026-06-30 Karar A) — "Masa 2" /
   * orphan code; paket sipariş için null geçilir ("PAKET" basılır).
   */
  table_label: string | null;
  /**
   * Bölge adı (`order.area_name_snapshot`) — per-bölge display_no çakışmasını
   * ayırt etmek için ön ek ("Bahçe - Masa 2"). null = bölgesiz/paket.
   */
  area_label: string | null;
  items: Array<{
    name: string;
    qty: number;
    lineTotalCents: number;
    /** Kalem notu (`order_items.note`) — varsa alt-satır "(note)". */
    note: string | null;
    /** Modifiye seçenekleri (`order_item_attributes.option_name_snapshot`). */
    modifiers: string[];
  }>;
  totalCents: number;
  /**
   * Ödeme dökümü kaynağı (`payments`). Yalnız `length > 1` iken tahsil/kalan
   * bloğu basılır (yalın adisyon = tek/ödemesiz senaryoda gürültü eklemez).
   */
  payments: Array<{ type: PaymentType; amountCents: number }>;
  /** Toplam tahsil edilen (Σ payments.amountCents). */
  paidTotalCents: number;
  /** Kalan (totalCents − paidTotalCents). */
  remainingCents: number;
  /** Pre-formatted local time, rendered as-is (ör. "08.07.2026  20:35"). */
  created_at_local: string;
}

/*
 * Serbest-metin sanitizasyonu artık paylaşılan `sanitizeForCP857` (shared-domain,
 * ADR-004 Amd5 K10) — eski yerel `clean()`'in superset'i: kontrol-bayt strip'ine
 * ek olarak em-dash/middot/bullet transliterasyonu + eşlenemez→'?' yapar.
 * Mutfak şablonu da aynı helper'ı kullanır (koruma boşluğu kapandı).
 */

/** Helper: encode a text line and append LF. */
function line(text: string): Uint8Array {
  return concat(encodeCP857(text), ESC_POS.FEED_LINE);
}

/**
 * Render a customer bill to an ESC/POS byte buffer.
 *
 * Pure function: no IO, no clock, no randomness.
 *
 * @param codepage ESC t codepage seçici (default `CODEPAGE_CP857` = ESC t 29,
 *   JP80H/mutfak — geriye-dönük). Kasa (POS-80) için `enqueueBillJob`
 *   `CODEPAGE_CP857_PAGE61` (ESC t 61) geçer; `payload.kind='bill'` kasa
 *   yazıcısına yönlenir (ADR-032 routing, ADR-004 Amd3).
 */
export function renderBillReceipt(
  params: BillReceiptParams,
  codepage: Uint8Array = ESC_POS.CODEPAGE_CP857,
): Uint8Array {
  const parts: Uint8Array[] = [];

  // RESET + codepage MUST be the first bytes (byte-level test sözleşmesi).
  parts.push(ESC_POS.RESET);
  parts.push(codepage);
  // KOYULUK global-açık (Amd7 K2): double-strike tüm fişte açık kalır (ESC @
  // init sıfırladığı için codepage'den SONRA açılır; kesim/bitişte kapatma gerekmez).
  parts.push(doubleStrikeOn());

  // --- Header block (majör ayraç + ortalı çift-boyut başlık + tarih) ---
  parts.push(align('left'));
  parts.push(line(MAJOR));
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true, doubleWidth: true }));
  parts.push(line(sanitizeForCP857(params.tenant_header)));
  parts.push(printMode()); // normal'e dön
  // Gövde (tarih + meta + kalemler) normal-boy + BOLD (Amd7 K3 — asıl "ince"
  // düzeltmesi). BOYUT AYNI (dblW/dblH YOK) → 48-kolon hizalama BOZULMAZ (K4).
  parts.push(boldOn());
  parts.push(line(params.created_at_local));
  parts.push(align('left'));
  parts.push(line(MAJOR));

  // --- Meta block (adisyon no + garson/masa + sipariş kanalı) ---
  parts.push(line(`Adisyon No: ${params.order_no}`));
  // Masa satırı self-describing (Karar A): etiket zaten "Masa 2" → ön ek yok.
  // Bölge varsa ayırt etmek için ön ek ("Bahçe - Masa 2"). Ayraç " - "
  // (CP857-safe; "·" U+00B7 CP857'de YOK → encodeCP857 fırlatır).
  const tableText =
    params.table_label === null
      ? 'PAKET'
      : params.area_label !== null
        ? `${params.area_label} - ${params.table_label}`
        : params.table_label;
  // server_name null → ASCII "-" (em-dash "—" U+2014 CP857'de YOK → throw).
  parts.push(
    line(twoCol(`Garson: ${sanitizeForCP857(params.server_name ?? '-')}`, sanitizeForCP857(tableText))),
  );
  parts.push(line(`Sipariş Kanalı: ${ORDER_TYPE_LABELS[params.order_type]}`));
  parts.push(line(MINOR));

  // --- Items (3 kolon: ad · adet · tutar; + modifiye/not alt-satırları) ---
  for (const item of params.items) {
    parts.push(
      line(
        threeCol(sanitizeForCP857(item.name), String(item.qty), moneyDigits(item.lineTotalCents)),
      ),
    );
    if (item.modifiers.length > 0) {
      parts.push(line(`  [${item.modifiers.map(sanitizeForCP857).join(', ')}]`));
    }
    if (item.note !== null && item.note.length > 0) {
      parts.push(line(`  (${sanitizeForCP857(item.note)})`));
    }
  }
  // Gövde bold biter (TUTAR/AFİYET kendi printMode vurgusunu kurar; Amd7 K3).
  parts.push(boldOff());

  // --- Total (majór ayraç + çift-yükseklik bold TUTAR) ---
  // doubleWidth KULLANILMAZ: twoCol hizasını 24-kolona bozar (her karakter 2×).
  parts.push(line(MAJOR));
  parts.push(printMode({ bold: true, doubleHeight: true }));
  parts.push(line(twoCol('TUTAR', moneyTL(params.totalCents))));
  parts.push(printMode());

  // --- Koşullu ödeme dökümü (YALNIZ parçalı/çok-türlü: payments.length > 1) ---
  if (params.payments.length > 1) {
    // Ödeme dökümü + ara-toplam normal-boy + BOLD (Amd7 K3).
    parts.push(boldOn());
    parts.push(line(MINOR));
    parts.push(line(twoCol('Tahsil Edilen', moneyTL(params.paidTotalCents))));
    parts.push(line(centerLabel('Ödemeler')));
    for (const p of params.payments) {
      parts.push(line(twoCol(PAYMENT_TYPE_LABELS[p.type], moneyDigits(p.amountCents))));
    }
    parts.push(line(twoCol('Kalan', moneyTL(params.remainingCents))));
    parts.push(boldOff());
  }

  // --- Footer (majór ayraç + ortalı çift-boyut AFİYET OLSUN + teşekkür) ---
  parts.push(line(MAJOR));
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true, doubleWidth: true }));
  parts.push(line('AFİYET OLSUN'));
  parts.push(printMode());
  parts.push(line('Teşekkür ederiz!'));
  parts.push(align('left'));

  // Kesim öncesi 4 satır besleme (kağıt koparma payı) + tam kesim.
  parts.push(feed(4));
  parts.push(ESC_POS.CUT_FULL);

  return concat(...parts);
}
