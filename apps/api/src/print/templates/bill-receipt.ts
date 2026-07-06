/**
 * Customer bill / adisyon receipt template (ADR-027 Faz A — on-demand baskı).
 *
 * ADR-004 §7 — pure render: BillReceiptParams -> Uint8Array of ESC/POS bytes.
 * Caller (enqueue-bill-job) queues the resulting buffer into a print job; this
 * module performs NO IO.
 *
 * Kitchen fişinden farkı: bu MÜŞTERİ adisyonu — kalem fiyatları + toplam basar
 * (mutfak fişi yalnız ad+adet). Para "TL" ile basılır: CP857 (1989) codepage'inde
 * ₺ (U+20BA, 2012) glyph'i YOK → fişte "1.234,56 TL".
 *
 * Layout (~40 sütun, kitchen template paritesi):
 *   ESC @ / ESC t <codepage> (bill → kasa POS-80: CODEPAGE_CP857_PAGE61 / ESC t 61; ADR-004 Amd3) / center
 *   tenant_header          (bold, çift yükseklik)
 *   "ADİSYON"              (bold)
 *   left:
 *   "<area - masa> or <masa> or PAKET"  (self-describing — no "Masa:" prefix)
 *   "Fis No: <order_no>"
 *   "Tarih: <created_at_local>"
 *   40x '-'
 *   per item:  "<qty>x <name>" ........ "<lineTotal> TL"   (2 sütun, sağa hizalı)
 *   40x '-'
 *   "TOPLAM:" ............... "<total> TL"   (bold)
 *   center "Tesekkur ederiz!"
 *   feed + cut
 */

import {
  encodeCP857,
  ESC_POS,
  align,
  printMode,
  concat,
  formatMoney,
} from '@restoran-pos/shared-domain';

const WIDTH = 40;

/** Input shape for {@link renderBillReceipt}. Money is integer kuruş. */
export interface BillReceiptParams {
  tenant_header: string;
  order_no: number;
  /**
   * Kanonik masa etiketi (ADR-009 Amendment 2026-06-30 Karar A) — "Masa 2" /
   * orphan code; paket sipariş için null geçilir ("PAKET" basılır).
   */
  table_label: string | null;
  /**
   * Bölge adı (`order.area_name_snapshot`) — per-bölge display_no çakışmasını
   * ayırt etmek için ön ek ("Bahçe · Masa 2"). null = bölgesiz/paket.
   */
  area_label: string | null;
  items: Array<{
    name: string;
    qty: number;
    lineTotalCents: number;
  }>;
  totalCents: number;
  /** Pre-formatted local time, rendered as-is. */
  created_at_local: string;
}

/** CP857-safe money: "1.234,56 TL" (₺ glyph CP857'de yok). */
function money(cents: number): string {
  // formatMoney → "₺1.234,56"; sembol + olası NBSP'yi at, "TL" ekle.
  const digits = formatMoney(cents).replace(/[^\d.,-]/g, '');
  return `${digits} TL`;
}

/** Helper: encode a text line and append LF. */
function line(text: string): Uint8Array {
  return concat(encodeCP857(text), ESC_POS.FEED_LINE);
}

/**
 * Two-column line: left text + right-aligned amount, padded to {@link WIDTH}.
 * Left text is truncated if it would collide with the amount.
 */
function twoCol(left: string, right: string): string {
  const maxLeft = WIDTH - right.length - 1;
  const leftFitted = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const gap = WIDTH - leftFitted.length - right.length;
  return `${leftFitted}${' '.repeat(gap > 0 ? gap : 1)}${right}`;
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

  // --- Header (centered, bold + double height) ---
  parts.push(ESC_POS.RESET);
  parts.push(codepage);
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true }));
  parts.push(line(params.tenant_header));
  parts.push(printMode()); // reset to normal
  parts.push(printMode({ bold: true }));
  parts.push(line('ADİSYON'));
  parts.push(printMode());

  // --- Meta block (left aligned) ---
  parts.push(align('left'));
  // Masa satırı self-describing (Karar A): etiket zaten "Masa 2" → "Masa: " ön
  // eki gereksiz. Bölge varsa ayırt etmek için ön ek ("Bahçe · Masa 2"). Mutfak
  // fişiyle birebir aynı kural.
  // Ayraç " - " (CP857-safe; "·" U+00B7 CP857'de YOK → encodeCP857 fırlatır).
  const tableText =
    params.table_label === null
      ? 'PAKET'
      : params.area_label !== null
        ? `${params.area_label} - ${params.table_label}`
        : params.table_label;
  parts.push(line(tableText));
  parts.push(line(`Fiş No: ${params.order_no}`));
  parts.push(line(`Tarih: ${params.created_at_local}`));
  parts.push(line('-'.repeat(WIDTH)));

  // --- Items (name + qty left, line total right) ---
  for (const item of params.items) {
    parts.push(line(twoCol(`${item.qty}x ${item.name}`, money(item.lineTotalCents))));
  }
  parts.push(line('-'.repeat(WIDTH)));

  // --- Total (bold) ---
  parts.push(printMode({ bold: true }));
  parts.push(line(twoCol('TOPLAM:', money(params.totalCents))));
  parts.push(printMode());

  // --- Footer ---
  parts.push(ESC_POS.FEED_LINE);
  parts.push(align('center'));
  parts.push(line('Teşekkür ederiz!'));
  parts.push(align('left'));
  parts.push(ESC_POS.FEED_LINE);
  parts.push(ESC_POS.FEED_LINE);
  parts.push(ESC_POS.CUT_FULL);

  return concat(...parts);
}
