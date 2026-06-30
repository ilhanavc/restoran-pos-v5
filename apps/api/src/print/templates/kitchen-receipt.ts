/**
 * Kitchen receipt (mutfak fişi) template.
 *
 * ADR-004 §7 — pure render: KitchenReceiptParams -> Uint8Array of ESC/POS bytes.
 * Caller is responsible for selecting kitchen destination and queueing the
 * resulting buffer into a print job; this module performs NO IO.
 *
 * Layout (printer-notes.md domain reference):
 *   ESC @ (reset)
 *   ESC t 13 (CP857)
 *   ESC a 1 (center)
 *   ESC ! bold+doubleHeight  -> tenant_header
 *   LF
 *   ESC ! 0
 *   LF
 *   ESC a 0 (left)
 *   kitchen_dest_label                 LF
 *   "<area - masa> or <masa> or PAKET" LF  (self-describing — no "Masa:" prefix)
 *   "Garson: <server_name>"            LF
 *   "Saat: <created_at_local>"         LF
 *   "Fis No: <order_no>"               LF  (note: header text uses "Fiş No")
 *   40x '-'                            LF
 *   LF
 *   per item:
 *     ESC ! bold
 *     "<qty>x <name>"                  LF
 *     ESC ! 0
 *     per modifier:
 *       "  + <modifier>"               LF
 *     if note:
 *       "  ! Not: <note>"              LF
 *   LF LF LF
 *   GS V 66 0 (cut)
 */

import {
  encodeCP857,
  ESC_POS,
  align,
  printMode,
  concat,
} from '@restoran-pos/shared-domain';

/** Input shape for {@link renderKitchenReceipt}. */
export interface KitchenReceiptParams {
  tenant_header: string;
  order_no: number;
  /**
   * Kanonik masa etiketi (ADR-009 Amendment 2026-06-30 Karar A) — örn. "Masa 2"
   * ya da bölgesiz orphan'da ham code; paket sipariş için null geçilir ("PAKET").
   */
  table_label: string | null;
  /**
   * Bölge adı (`order.area_name_snapshot`); per-bölge display_no'da "Masa 2"
   * iki bölgede çakışabildiği için fişte bölgeyi ön ek yapar ("Bahçe · Masa 2").
   * null ise yalnız etiket basılır. Paket siparişte (table_label null) yok sayılır.
   */
  area_label: string | null;
  server_name: string;
  items: Array<{
    name: string;
    qty: number;
    modifiers?: string[];
    note?: string;
  }>;
  /** ISO string or pre-formatted local time. Rendered as-is. */
  created_at_local: string;
  kitchen_dest_label: string;
}

/** Helper: encode a text line and append LF. */
function line(text: string): Uint8Array {
  return concat(encodeCP857(text), ESC_POS.FEED_LINE);
}

/**
 * Render a kitchen receipt to an ESC/POS byte buffer.
 *
 * Pure function: no IO, no clock, no randomness.
 */
export function renderKitchenReceipt(
  params: KitchenReceiptParams,
): Uint8Array {
  const parts: Uint8Array[] = [];

  // --- Header (centered, bold + double height) ---
  parts.push(ESC_POS.RESET);
  parts.push(ESC_POS.CODEPAGE_CP857);
  parts.push(align('center'));
  parts.push(printMode({ bold: true, doubleHeight: true }));
  parts.push(line(params.tenant_header));
  parts.push(printMode()); // reset to normal
  parts.push(ESC_POS.FEED_LINE);

  // --- Meta block (left aligned) ---
  parts.push(align('left'));
  parts.push(line(params.kitchen_dest_label));

  // Masa satırı self-describing (ADR-009 Amendment 2026-06-30 Karar A): etiket
  // zaten "Masa 2" olduğu için "Masa: " ön eki gereksiz + yanıltıcı olurdu.
  // Bölge varsa ayırt etmek için ön ek yapılır ("Bahçe · Masa 2").
  // Ayraç " - " (CP857-safe; "·" U+00B7 CP857'de YOK → encodeCP857 fırlatır).
  const tableText =
    params.table_label === null
      ? 'PAKET'
      : params.area_label !== null
        ? `${params.area_label} - ${params.table_label}`
        : params.table_label;
  parts.push(line(tableText));
  parts.push(line(`Garson: ${params.server_name}`));
  parts.push(line(`Saat: ${params.created_at_local}`));
  parts.push(line(`Fiş No: ${params.order_no}`));
  parts.push(line('-'.repeat(40)));
  parts.push(ESC_POS.FEED_LINE);

  // --- Items ---
  for (const item of params.items) {
    parts.push(printMode({ bold: true }));
    parts.push(line(`${item.qty}x ${item.name}`));
    parts.push(printMode()); // reset

    if (item.modifiers && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        parts.push(line(`  + ${mod}`));
      }
    }

    if (item.note && item.note.length > 0) {
      parts.push(line(`  ! Not: ${item.note}`));
    }
  }

  // --- Footer feed + cut ---
  parts.push(ESC_POS.FEED_LINE);
  parts.push(ESC_POS.FEED_LINE);
  parts.push(ESC_POS.FEED_LINE);
  parts.push(ESC_POS.CUT_FULL);

  return concat(...parts);
}
